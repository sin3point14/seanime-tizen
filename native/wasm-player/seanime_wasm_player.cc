#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <list>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include <emscripten/emscripten.h>
#include <emscripten/fetch.h>
#include <emscripten/threading.h>

#include <samsung/html/html_media_element.h>
#include <samsung/html/html_media_element_listener.h>
#include <samsung/wasm/elementary_audio_track_config.h>
#include <samsung/wasm/elementary_media_packet.h>
#include <samsung/wasm/elementary_media_stream_source.h>
#include <samsung/wasm/elementary_media_stream_source_listener.h>
#include <samsung/wasm/elementary_media_track.h>
#include <samsung/wasm/elementary_media_track_listener.h>
#include <samsung/wasm/elementary_video_track_config.h>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
}

namespace {
using samsung::html::HTMLMediaElement;
using samsung::wasm::ChannelLayout;
using samsung::wasm::ElementaryAudioTrackConfig;
using samsung::wasm::ElementaryMediaPacket;
using samsung::wasm::ElementaryMediaStreamSource;
using samsung::wasm::ElementaryMediaTrack;
using samsung::wasm::ElementaryVideoTrackConfig;
using samsung::wasm::OperationResult;
using samsung::wasm::SampleFormat;
using samsung::wasm::Seconds;
using samsung::wasm::SessionId;

void Emit(const char* type, double value = 0, const char* message = "") {
  MAIN_THREAD_EM_ASM({
    if (Module.onSeanimePlayerEvent) {
      Module.onSeanimePlayerEvent(UTF8ToString($0), $1, UTF8ToString($2));
    }
  }, type, value, message);
}

std::string FfmpegError(int code) {
  char buffer[AV_ERROR_MAX_STRING_SIZE]{};
  av_strerror(code, buffer, sizeof(buffer));
  return buffer;
}

class RangeReader {
 public:
  static constexpr int64_t kSegmentBytes = 4 * 1024 * 1024;

  RangeReader(std::string url, int64_t size, int cache_mib)
      : url_(std::move(url)), size_(size), max_segments_(std::max(2, cache_mib / 4)) {}

  int Read(uint8_t* destination, int requested) {
    if (position_ >= size_) return AVERROR_EOF;
    int copied = 0;
    while (copied < requested && position_ < size_) {
      const int64_t index = position_ / kSegmentBytes;
      auto* segment = Get(index);
      if (!segment) return copied > 0 ? copied : AVERROR(EIO);
      const int64_t offset = position_ - index * kSegmentBytes;
      const int available = static_cast<int>(segment->data.size() - offset);
      if (available <= 0) break;
      const int amount = std::min(requested - copied, available);
      std::memcpy(destination + copied, segment->data.data() + offset, amount);
      copied += amount;
      position_ += amount;
    }
    return copied > 0 ? copied : AVERROR_EOF;
  }

  int64_t Seek(int64_t offset, int whence) {
    if ((whence & ~AVSEEK_FORCE) == AVSEEK_SIZE) return size_;
    whence &= ~AVSEEK_FORCE;
    int64_t next = offset;
    if (whence == SEEK_CUR) next = position_ + offset;
    else if (whence == SEEK_END) next = size_ + offset;
    if (next < 0 || next > size_) return AVERROR(EINVAL);
    position_ = next;
    return position_;
  }

  double Bandwidth() const { return bandwidth_bps_.load(); }

 private:
  struct Segment { std::vector<uint8_t> data; std::list<int64_t>::iterator lru; };

  Segment* Get(int64_t index) {
    auto found = segments_.find(index);
    if (found != segments_.end()) {
      lru_.erase(found->second.lru);
      lru_.push_front(index);
      found->second.lru = lru_.begin();
      return &found->second;
    }
    const int64_t start = index * kSegmentBytes;
    const int64_t end = std::min(size_ - 1, start + kSegmentBytes - 1);
    std::string range = "bytes=" + std::to_string(start) + "-" + std::to_string(end);
    const char* headers[] = {"Range", range.c_str(), nullptr};
    emscripten_fetch_attr_t attributes;
    emscripten_fetch_attr_init(&attributes);
    std::strcpy(attributes.requestMethod, "GET");
    attributes.attributes = EMSCRIPTEN_FETCH_LOAD_TO_MEMORY | EMSCRIPTEN_FETCH_SYNCHRONOUS;
    attributes.requestHeaders = headers;
    const auto began = std::chrono::steady_clock::now();
    emscripten_fetch_t* fetch = emscripten_fetch(&attributes, url_.c_str());
    const auto elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
    if (!fetch || (fetch->status != 206 && !(fetch->status == 200 && start == 0)) || fetch->numBytes <= 0) {
      if (fetch) emscripten_fetch_close(fetch);
      return nullptr;
    }
    Segment segment;
    const auto* fetched_data = reinterpret_cast<const uint8_t*>(fetch->data);
    const size_t expected = static_cast<size_t>(end - start + 1);
    const size_t received = std::min(expected, static_cast<size_t>(fetch->numBytes));
    segment.data.assign(fetched_data, fetched_data + received);
    bandwidth_bps_.store(segment.data.size() * 8.0 / std::max(0.001, elapsed));
    emscripten_fetch_close(fetch);
    while (segments_.size() >= static_cast<size_t>(max_segments_) && !lru_.empty()) {
      segments_.erase(lru_.back());
      lru_.pop_back();
    }
    lru_.push_front(index);
    segment.lru = lru_.begin();
    auto inserted = segments_.emplace(index, std::move(segment));
    return &inserted.first->second;
  }

  std::string url_;
  int64_t size_;
  int64_t position_ = 0;
  int max_segments_;
  std::unordered_map<int64_t, Segment> segments_;
  std::list<int64_t> lru_;
  std::atomic<double> bandwidth_bps_{0};
};

int ReadPacket(void* opaque, uint8_t* buffer, int size) {
  return static_cast<RangeReader*>(opaque)->Read(buffer, size);
}
int64_t SeekPacket(void* opaque, int64_t offset, int whence) {
  return static_cast<RangeReader*>(opaque)->Seek(offset, whence);
}

class Player;

class TrackSink final : public samsung::wasm::ElementaryMediaTrackListener {
 public:
  TrackSink(ElementaryMediaTrack&& track, Player* owner) : track(std::move(track)), owner(owner) {
    auto initial = this->track.GetSessionId();
    if (initial) session.store(initial.value);
    this->track.SetListener(this);
  }
  void OnTrackOpen() override;
  void OnTrackClosed(ElementaryMediaTrack::CloseReason) override { open.store(false); }
  void OnSeek(Seconds time) override;
  void OnSessionIdChanged(SessionId id) override { session.store(id); }

  ElementaryMediaTrack track;
  Player* owner;
  std::atomic<bool> open{false};
  std::atomic<int> session{0};
};

class Player final : public samsung::wasm::ElementaryMediaStreamSourceListener,
                     public samsung::html::HTMLMediaElementListener {
 public:
  void Open(std::string url, int64_t file_size, std::string video_mime,
            std::string audio_mime, std::string element_id, int audio_index,
            int hot_cache_mib) {
    Stop();
    url_ = std::move(url); file_size_ = file_size; video_mime_ = std::move(video_mime);
    audio_mime_ = std::move(audio_mime); element_id_ = std::move(element_id);
    requested_audio_index_ = audio_index; hot_cache_mib_ = hot_cache_mib;
    Emit("log", file_size, "native open requested");
    stopped_.store(false); state_.store(1);
    demux_thread_ = std::thread([this] { Demux(); });
  }

  void Stop() {
    stopped_.store(true);
    wake_.notify_all();
    if (demux_thread_.joinable()) demux_thread_.join();
    video_sink_.reset(); audio_sink_.reset(); source_.reset(); media_element_.reset();
    if (format_) { avformat_close_input(&format_); format_ = nullptr; }
    if (avio_) { av_freep(&avio_->buffer); avio_context_free(&avio_); }
    reader_.reset(); state_.store(0);
  }

  void Play() {
    if (!media_element_) return;
    media_element_->Play([](OperationResult result) { if (result != OperationResult::kSuccess) Emit("error", 0, "WASM Player could not start playback."); });
  }
  void Pause() { if (media_element_) media_element_->Pause(); }
  void Seek(double seconds) { if (media_element_) media_element_->SetCurrentTime(Seconds{std::max(0.0, seconds)}); }
  double CurrentTime() const { auto value = media_element_ ? media_element_->GetCurrentTime() : samsung::wasm::Result<Seconds>{}; return value ? value.value.count() : current_time_.load(); }
  double Duration() const { return duration_; }
  int State() const { return state_.load(); }
  double Bandwidth() const { return reader_ ? reader_->Bandwidth() : 0; }

  void OnSourceClosed() override {
    if (!source_ || stopped_.load()) return;
    Emit("log", duration_, "media source closed; configuring tracks");
    source_->SetDuration(Seconds{duration_});
    if (video_stream_ >= 0) {
      auto* parameters = format_->streams[video_stream_]->codecpar;
      ElementaryVideoTrackConfig config(video_mime_, Extradata(parameters), parameters->width, parameters->height,
                                         frame_rate_.num > 0 ? frame_rate_.num : 24, frame_rate_.den > 0 ? frame_rate_.den : 1);
      auto result = source_->AddTrack(config);
      if (!result) { Emit("error", 0, "Samsung rejected the video track configuration."); return; }
      video_sink_ = std::make_unique<TrackSink>(std::move(result.value), this);
    }
    if (audio_stream_ >= 0) {
      auto* parameters = format_->streams[audio_stream_]->codecpar;
      ElementaryAudioTrackConfig config(audio_mime_, Extradata(parameters), SampleFormat::kPlanarF32,
                                         Layout(parameters->channels), parameters->sample_rate);
      auto result = source_->AddTrack(config);
      if (!result) { Emit("error", 0, "Samsung rejected the audio track configuration."); return; }
      audio_sink_ = std::make_unique<TrackSink>(std::move(result.value), this);
    }
    source_->Open([](OperationResult result) { if (result != OperationResult::kSuccess) Emit("error", 0, "Samsung could not open the elementary media source."); });
  }
  void OnSourceOpen() override { Emit("log", 0, "media source open"); }
  void OnPlaybackPositionChanged(Seconds time) override {
    current_time_.store(time.count()); Emit("time", time.count() * 1000.0);
    target_time_.store(time.count() + 3.0); wake_.notify_one();
  }
  void OnPipelineError(samsung::wasm::MediaPipelineError, const char* message) override { Emit("error", 0, message ? message : "Samsung media pipeline error."); }
  void OnCanPlay() override { state_.store(2); Emit("ready"); }
  void OnPlaying() override { state_.store(3); Emit("playing"); }
  void OnPause() override { state_.store(4); Emit("paused"); }
  void OnWaiting() override { Emit("buffering", 0); }
  void OnEnded() override { state_.store(5); Emit("complete"); }
  void OnError(samsung::html::MediaError, const char* message) override { Emit("error", 0, message ? message : "HTML media element error."); }

  void Wake() { wake_.notify_one(); }
  void RequestSeek(double time) { seek_time_.store(time); seek_pending_.store(true); wake_.notify_one(); }

 private:
  static std::vector<uint8_t> Extradata(const AVCodecParameters* parameters) {
    return parameters->extradata && parameters->extradata_size > 0
      ? std::vector<uint8_t>(parameters->extradata, parameters->extradata + parameters->extradata_size)
      : std::vector<uint8_t>{};
  }
  static ChannelLayout Layout(int channels) {
    if (channels == 1) return ChannelLayout::kMono;
    if (channels == 2) return ChannelLayout::kStereo;
    if (channels == 6) return ChannelLayout::k5_1;
    if (channels == 8) return ChannelLayout::k7_1;
    return ChannelLayout::kDiscrete;
  }
  static void SetupMain(Player* self) { self->Setup(); }
  void Setup() {
    if (stopped_.load()) return;
    Emit("log", 0, "creating HTML media element");
    media_element_ = std::make_unique<HTMLMediaElement>(element_id_.c_str());
    if (!media_element_->IsValid()) { Emit("error", 0, "WASM video element is unavailable."); return; }
    media_element_->SetListener(this);
    source_ = std::make_unique<ElementaryMediaStreamSource>(samsung::wasm::EmssLatencyMode::kNormal, samsung::wasm::EmssRenderingMode::kMediaElement);
    if (!source_->IsValid()) { Emit("error", 0, "Samsung elementary media source is unavailable."); return; }
    source_->SetListener(this);
    auto attached = media_element_->SetSrc(source_.get());
    if (!attached) { Emit("error", static_cast<double>(attached.operation_result), "Samsung rejected the elementary media source attachment."); return; }
    Emit("log", 0, "elementary media source attached");
  }

  void Demux() {
    Emit("log", file_size_, "FFmpeg demux starting");
    reader_ = std::make_unique<RangeReader>(url_, file_size_, hot_cache_mib_);
    auto* buffer = static_cast<uint8_t*>(av_malloc(64 * 1024));
    avio_ = avio_alloc_context(buffer, 64 * 1024, 0, reader_.get(), ReadPacket, nullptr, SeekPacket);
    format_ = avformat_alloc_context(); format_->pb = avio_; format_->flags |= AVFMT_FLAG_CUSTOM_IO;
    int result = avformat_open_input(&format_, nullptr, nullptr, nullptr);
    if (result >= 0) result = avformat_find_stream_info(format_, nullptr);
    if (result < 0) { auto message = "FFmpeg could not open the stream: " + FfmpegError(result); Emit("error", 0, message.c_str()); return; }
    video_stream_ = av_find_best_stream(format_, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
    audio_stream_ = requested_audio_index_ >= 0 ? FindAudio(requested_audio_index_) : av_find_best_stream(format_, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
    if (video_stream_ < 0) { Emit("error", 0, "FFmpeg found no playable video stream."); return; }
    duration_ = format_->duration > 0 ? format_->duration / static_cast<double>(AV_TIME_BASE) : 0;
    Emit("log", duration_, "FFmpeg stream metadata ready");
    frame_rate_ = av_guess_frame_rate(format_, format_->streams[video_stream_], nullptr);
    target_time_.store(3.0);
    emscripten_async_run_in_main_runtime_thread(EM_FUNC_SIG_VI, SetupMain, this);
    FeedLoop();
  }

  int FindAudio(int ordinal) const {
    int seen = 0;
    for (unsigned i = 0; i < format_->nb_streams; ++i) if (format_->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
      if (seen++ == ordinal) return static_cast<int>(i);
    }
    return av_find_best_stream(format_, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
  }

  void FeedLoop() {
    AVPacket packet; av_init_packet(&packet);
    bool has_packet = false;
    while (!stopped_.load()) {
      if (seek_pending_.exchange(false)) {
        if (has_packet) { av_packet_unref(&packet); has_packet = false; }
        const double time = seek_time_.load();
        av_seek_frame(format_, video_stream_, static_cast<int64_t>(time / av_q2d(format_->streams[video_stream_]->time_base)), AVSEEK_FLAG_BACKWARD);
        avformat_flush(format_); target_time_.store(time + 3.0);
      }
      const bool video_open = video_sink_ && video_sink_->open.load();
      const bool audio_open = audio_stream_ < 0 || (audio_sink_ && audio_sink_->open.load());
      if (!video_open || !audio_open) { std::unique_lock<std::mutex> lock(wake_mutex_); wake_.wait_for(lock, std::chrono::milliseconds(100)); continue; }
      if (!has_packet) {
        int result = av_read_frame(format_, &packet);
        if (result < 0) {
          if (video_sink_) video_sink_->track.AppendEndOfTrack(video_sink_->session.load());
          if (audio_sink_) audio_sink_->track.AppendEndOfTrack(audio_sink_->session.load());
          break;
        }
        has_packet = true;
      }
      AVStream* stream = format_->streams[packet.stream_index];
      const double pts = packet.pts == AV_NOPTS_VALUE ? 0 : packet.pts * av_q2d(stream->time_base);
      if (pts > target_time_.load()) {
        std::unique_lock<std::mutex> lock(wake_mutex_); wake_.wait_for(lock, std::chrono::milliseconds(100)); continue;
      }
      TrackSink* sink = packet.stream_index == video_stream_ ? video_sink_.get() : packet.stream_index == audio_stream_ ? audio_sink_.get() : nullptr;
      if (sink) {
        const double dts = packet.dts == AV_NOPTS_VALUE ? pts : packet.dts * av_q2d(stream->time_base);
        const double duration = packet.duration > 0 ? packet.duration * av_q2d(stream->time_base) : 0;
        ElementaryMediaPacket media_packet{Seconds{pts}, Seconds{dts}, Seconds{duration}, (packet.flags & AV_PKT_FLAG_KEY) != 0,
          static_cast<size_t>(packet.size), packet.data, 0, 0, 0, 0, sink->session.load()};
        auto appended = sink->track.AppendPacket(media_packet);
        if (!appended && appended.operation_result != OperationResult::kAppendIgnored) Emit("buffering", 0, "Packet append was rejected.");
      }
      av_packet_unref(&packet); has_packet = false;
    }
    if (has_packet) av_packet_unref(&packet);
  }

  std::string url_, video_mime_, audio_mime_, element_id_;
  int64_t file_size_ = 0;
  int requested_audio_index_ = -1, hot_cache_mib_ = 64;
  std::thread demux_thread_;
  std::atomic<bool> stopped_{true}, seek_pending_{false};
  std::atomic<double> seek_time_{0}, current_time_{0}, target_time_{3};
  std::atomic<int> state_{0};
  std::mutex wake_mutex_; std::condition_variable wake_;
  std::unique_ptr<RangeReader> reader_;
  AVFormatContext* format_ = nullptr; AVIOContext* avio_ = nullptr;
  int video_stream_ = -1, audio_stream_ = -1; double duration_ = 0; AVRational frame_rate_{24, 1};
  std::unique_ptr<HTMLMediaElement> media_element_;
  std::unique_ptr<ElementaryMediaStreamSource> source_;
  std::unique_ptr<TrackSink> video_sink_, audio_sink_;
};

void TrackSink::OnTrackOpen() { open.store(true); Emit("log", session.load(), "elementary media track open"); owner->Wake(); }
void TrackSink::OnSeek(Seconds time) { owner->RequestSeek(time.count()); }

Player player;
}  // namespace

extern "C" {
EMSCRIPTEN_KEEPALIVE void seanime_open(const char* url, double file_size, const char* video_mime,
                                       const char* audio_mime, const char* element_id,
                                       int audio_index, int hot_cache_mib) {
  player.Open(url ? url : "", static_cast<int64_t>(file_size), video_mime ? video_mime : "",
              audio_mime ? audio_mime : "", element_id ? element_id : "wasm-video",
              audio_index, hot_cache_mib);
}
EMSCRIPTEN_KEEPALIVE void seanime_play() { player.Play(); }
EMSCRIPTEN_KEEPALIVE void seanime_pause() { player.Pause(); }
EMSCRIPTEN_KEEPALIVE void seanime_seek(double seconds) { player.Seek(seconds); }
EMSCRIPTEN_KEEPALIVE void seanime_stop() { player.Stop(); }
EMSCRIPTEN_KEEPALIVE double seanime_duration() { return player.Duration(); }
EMSCRIPTEN_KEEPALIVE double seanime_current_time() { return player.CurrentTime(); }
EMSCRIPTEN_KEEPALIVE int seanime_state() { return player.State(); }
EMSCRIPTEN_KEEPALIVE double seanime_bandwidth() { return player.Bandwidth(); }
}

int main() { EM_ASM(noExitRuntime = true); }
