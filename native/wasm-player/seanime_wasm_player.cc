#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <functional>
#include <list>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
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

  RangeReader(std::string url, std::string cache_id, int64_t size, int cache_mib, int disk_cache_mib)
      : url_(std::move(url)), size_(size), max_segments_(std::max(2, cache_mib / 4)),
        disk_cache_enabled_(disk_cache_mib >= 4), cache_prefix_("seanime-session/" + std::to_string(std::hash<std::string>{}(cache_id)) + "/") {}

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
    const size_t expected = static_cast<size_t>(end - start + 1);
    std::string range = "bytes=" + std::to_string(start) + "-" + std::to_string(end);
    std::string cache_path = cache_prefix_ + std::to_string(index);
    const char* headers[] = {"Range", range.c_str(), nullptr};
    emscripten_fetch_t* fetch = nullptr;
    bool disk_hit = false;
    bool disk_stored = false;
    const auto began = std::chrono::steady_clock::now();
    if (disk_cache_enabled_) {
      emscripten_fetch_attr_t cached;
      emscripten_fetch_attr_init(&cached);
      std::strcpy(cached.requestMethod, "GET");
      cached.attributes = EMSCRIPTEN_FETCH_LOAD_TO_MEMORY | EMSCRIPTEN_FETCH_SYNCHRONOUS | EMSCRIPTEN_FETCH_NO_DOWNLOAD;
      cached.destinationPath = cache_path.c_str();
      fetch = emscripten_fetch(&cached, url_.c_str());
      disk_hit = fetch && fetch->status == 200 && fetch->numBytes == expected;
      if (!disk_hit && fetch) { emscripten_fetch_close(fetch); fetch = nullptr; }
    }
    if (!fetch) {
      emscripten_fetch_attr_t network;
      emscripten_fetch_attr_init(&network);
      std::strcpy(network.requestMethod, "GET");
      network.attributes = EMSCRIPTEN_FETCH_LOAD_TO_MEMORY | EMSCRIPTEN_FETCH_SYNCHRONOUS |
        (disk_cache_enabled_ ? EMSCRIPTEN_FETCH_PERSIST_FILE | EMSCRIPTEN_FETCH_REPLACE : 0);
      network.destinationPath = disk_cache_enabled_ ? cache_path.c_str() : nullptr;
      network.requestHeaders = headers;
      fetch = emscripten_fetch(&network, url_.c_str());
      disk_stored = disk_cache_enabled_ && fetch && (fetch->status == 200 || fetch->status == 206) && fetch->numBytes == expected;
    }
    bool valid = fetch && (fetch->status == 206 || fetch->status == 200) && fetch->numBytes == expected;
    if (!valid && disk_cache_enabled_) {
      if (fetch) emscripten_fetch_close(fetch);
      emscripten_fetch_attr_t fallback;
      emscripten_fetch_attr_init(&fallback);
      std::strcpy(fallback.requestMethod, "GET");
      fallback.attributes = EMSCRIPTEN_FETCH_LOAD_TO_MEMORY | EMSCRIPTEN_FETCH_SYNCHRONOUS | EMSCRIPTEN_FETCH_REPLACE;
      fallback.requestHeaders = headers;
      fetch = emscripten_fetch(&fallback, url_.c_str());
      valid = fetch && fetch->status == 206 && fetch->numBytes == expected;
      disk_stored = false;
      Emit("disk-cache-fallback", static_cast<double>(expected), cache_path.c_str());
    }
    const auto elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
    if (!valid) {
      if (fetch) emscripten_fetch_close(fetch);
      return nullptr;
    }
    Segment segment;
    const auto* fetched_data = reinterpret_cast<const uint8_t*>(fetch->data);
    const size_t received = std::min(expected, static_cast<size_t>(fetch->numBytes));
    segment.data.assign(fetched_data, fetched_data + received);
    if (!disk_hit) bandwidth_bps_.store(segment.data.size() * 8.0 / std::max(0.001, elapsed));
    if (disk_hit || disk_stored) Emit(disk_hit ? "disk-cache-hit" : "disk-cache-write", static_cast<double>(received), cache_path.c_str());
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
  bool disk_cache_enabled_;
  std::string cache_prefix_;
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
  void OnTrackClosed(ElementaryMediaTrack::CloseReason) override;
  void OnSeek(Seconds time) override;
  void OnSessionIdChanged(SessionId id) override;

  ElementaryMediaTrack track;
  Player* owner;
  std::atomic<bool> open{false};
  std::atomic<int> session{0};
};

class Player final : public samsung::wasm::ElementaryMediaStreamSourceListener,
                     public samsung::html::HTMLMediaElementListener {
 public:
  void Open(std::string url, std::string cache_id, int64_t file_size, std::string video_mime,
            std::string audio_mime, std::string element_id, int audio_index,
            int hot_cache_mib, int disk_cache_mib, int forward_buffer_seconds) {
    if (closing_.load() || source_ || media_element_) {
      Snapshot("open-rejected-existing-pipeline");
      Emit("error", 0, "Previous Samsung media source has not finished closing.");
      return;
    }
    generation_.fetch_add(1);
    url_ = std::move(url); cache_id_ = std::move(cache_id); file_size_ = file_size; video_mime_ = std::move(video_mime);
    audio_mime_ = std::move(audio_mime); element_id_ = std::move(element_id);
    requested_audio_index_ = audio_index; hot_cache_mib_ = hot_cache_mib; disk_cache_mib_ = disk_cache_mib;
    forward_buffer_seconds_ = std::max(3, forward_buffer_seconds);
    Emit("log", file_size, "native open requested");
    stopped_.store(false);
    desired_playing_.store(false);
    ready_emitted_.store(false);
    play_request_pending_.store(false);
    resume_after_seek_.store(false);
    seek_pending_.store(false);
    seek_callback_handled_.store(false);
    seek_demux_ready_.store(false);
    seek_ready_emitted_.store(false);
    buffer_full_logged_.store(false);
    seek_time_.store(0);
    current_time_.store(0);
    target_time_.store(forward_buffer_seconds_);
    buffered_start_.store(-1);
    buffered_end_.store(-1);
    seek_video_session_.store(-1);
    seek_audio_session_.store(-1);
    video_stream_ = -1;
    audio_stream_ = -1;
    duration_ = 0;
    { std::lock_guard<std::mutex> lock(byte_time_mutex_); byte_time_anchors_.clear(); }
    { std::lock_guard<std::mutex> lock(media_segment_mutex_); media_segments_.clear(); }
    state_.store(1);
    Snapshot("open-start");
    demux_thread_ = std::thread([this] { Demux(); });
  }

  void Stop() {
    if (closing_.exchange(true)) { Snapshot("stop-duplicate"); return; }
    Snapshot("stop-begin");
    stopped_.store(true); desired_playing_.store(false);
    wake_.notify_all();
    if (demux_thread_.joinable()) demux_thread_.join();
    Snapshot("stop-demux-joined");
    if (format_) { avformat_close_input(&format_); format_ = nullptr; }
    if (avio_) { av_freep(&avio_->buffer); avio_context_free(&avio_); }
    reader_.reset();
    if (media_element_) {
      media_element_->Pause();
      media_element_->SetListener(nullptr);
    }
    if (!source_) { Snapshot("stop-no-source"); FinalizeStop(OperationResult::kSuccess); return; }
    source_->SetListener(nullptr);
    Emit("log", 0, "closing elementary media source");
    auto result = source_->Close([this](OperationResult close_result) { FinalizeStop(close_result); });
    Emit("log", static_cast<double>(result.operation_result), "elementary media source close requested");
    Snapshot("stop-close-requested");
    if (!result) FinalizeStop(result.operation_result);
  }

  void Play() {
    desired_playing_.store(true);
    Snapshot("play-request");
    if (!media_element_) { Emit("play-rejected", -1, "HTML media element is missing"); return; }
    if (play_request_pending_.exchange(true)) {
      Snapshot("play-request-skipped-pending");
      return;
    }
    const int request_generation = generation_.load();
    auto request = media_element_->Play([this, request_generation](OperationResult result) {
      if (generation_.load() != request_generation) return;
      play_request_pending_.store(false);
      Emit("log", static_cast<double>(result), "HTML media play request completed");
      Snapshot("play-callback");
      // Play requests are routinely superseded by a seek/pause on Tizen. In
      // particular kAborted (20) is not a media failure and the pipeline often
      // becomes playable immediately afterwards. Pipeline errors are reported
      // separately through HTMLMediaElementListener::OnError.
      if (result != OperationResult::kSuccess) Emit("play-rejected", static_cast<double>(result), "play request was superseded");
    });
    Emit("log", static_cast<double>(request.operation_result), "HTML media play request accepted");
    if (!request) play_request_pending_.store(false);
    Snapshot("play-dispatched");
  }
  void Pause() {
    desired_playing_.store(false);
    auto result = media_element_ ? media_element_->Pause() : samsung::wasm::Result<void>{};
    Emit("log", media_element_ ? static_cast<double>(result.operation_result) : -1, "HTML media pause request");
    Snapshot("pause-request");
  }
  void Seek(double seconds) {
    Emit("log", seconds, "HTML media seek requested");
    resume_after_seek_.store(desired_playing_.load());
    seek_demux_ready_.store(false);
    seek_ready_emitted_.store(false);
    buffer_full_logged_.store(false);
    seek_callback_handled_.store(false);
    seek_video_session_.store(video_sink_ ? video_sink_->session.load() : -1);
    seek_audio_session_.store(audio_sink_ ? audio_sink_->session.load() : -1);
    auto result = media_element_ ? media_element_->SetCurrentTime(Seconds{std::max(0.0, seconds)}) : samsung::wasm::Result<void>{};
    Emit("log", media_element_ ? static_cast<double>(result.operation_result) : -1, "HTML media seek dispatch result");
    Snapshot("seek-dispatched");
  }
  double CurrentTime() const { auto value = media_element_ ? media_element_->GetCurrentTime() : samsung::wasm::Result<Seconds>{}; return value ? value.value.count() : current_time_.load(); }
  double Duration() const { return duration_; }
  int State() const { return state_.load(); }
  double Bandwidth() const { return reader_ ? reader_->Bandwidth() : 0; }
  double BufferedStart() const { return buffered_start_.load(); }
  double BufferedEnd() const { return buffered_end_.load(); }
  double TimeForByte(double offset) const {
    std::lock_guard<std::mutex> lock(byte_time_mutex_);
    if (byte_time_anchors_.size() < 2 || duration_ <= 0) return -1;
    if (offset <= byte_time_anchors_.front().first) return 0;
    if (offset >= byte_time_anchors_.back().first) {
      // Prefetched bytes have not passed through the demuxer yet. Estimate
      // their timestamp from the most recent keyframe span, anchored to real
      // packet positions. This is intentionally local rather than a whole-file
      // average, which is badly wrong for VBR Matroska files.
      const auto& right = byte_time_anchors_.back();
      auto left = byte_time_anchors_.end() - 2;
      while (left != byte_time_anchors_.begin() && right.first - left->first < 4 * 1024 * 1024) --left;
      const double byte_span = static_cast<double>(right.first - left->first);
      const double time_span = right.second - left->second;
      if (byte_span <= 0 || time_span <= 0) return -1;
      return std::max(0.0, std::min(duration_, right.second + (offset - right.first) * time_span / byte_span));
    }
    auto upper = std::upper_bound(byte_time_anchors_.begin(), byte_time_anchors_.end(), offset,
      [](double value, const std::pair<int64_t, double>& anchor) { return value < static_cast<double>(anchor.first); });
    if (upper == byte_time_anchors_.begin() || upper == byte_time_anchors_.end()) return -1;
    const auto& right = *upper;
    const auto& left = *(upper - 1);
    const double span = static_cast<double>(right.first - left.first);
    if (span <= 0 || right.second < left.second) return left.second;
    const double fraction = (offset - static_cast<double>(left.first)) / span;
    return std::max(0.0, std::min(duration_, left.second + fraction * (right.second - left.second)));
  }
  bool ByteRangeHasMedia(double start, double end) const {
    if (end <= start) return false;
    const int64_t first = static_cast<int64_t>(std::max(0.0, start)) / RangeReader::kSegmentBytes;
    const int64_t last = static_cast<int64_t>(std::max(0.0, end - 1)) / RangeReader::kSegmentBytes;
    std::lock_guard<std::mutex> lock(media_segment_mutex_);
    for (int64_t index = first; index <= last; ++index) if (media_segments_.count(index)) return true;
    return false;
  }
  void AddByteTimeAnchor(int64_t position, double time) {
    if (position < 0 || !std::isfinite(time) || time < 0 || time > duration_ + 1) return;
    std::lock_guard<std::mutex> lock(byte_time_mutex_);
    auto found = std::lower_bound(byte_time_anchors_.begin(), byte_time_anchors_.end(), position,
      [](const std::pair<int64_t, double>& anchor, int64_t value) { return anchor.first < value; });
    if (found != byte_time_anchors_.end() && found->first == position) return;
    byte_time_anchors_.insert(found, {position, time});
  }
  void RefreshIndexAnchors() {
    if (!format_ || video_stream_ < 0) return;
    AVStream* video = format_->streams[video_stream_];
    for (int i = 0; i < video->nb_index_entries; ++i) {
      const AVIndexEntry& entry = video->index_entries[i];
      if (entry.timestamp != AV_NOPTS_VALUE) AddByteTimeAnchor(entry.pos, entry.timestamp * av_q2d(video->time_base));
    }
  }
  void Snapshot(const char* reason) {
    int source_ready = -1, media_ready = -1, media_paused = -1;
    double media_time = -1;
    if (source_) { auto value = source_->GetReadyState(); if (value) source_ready = static_cast<int>(value.value); }
    if (media_element_) {
      auto ready = media_element_->GetReadyState(); if (ready) media_ready = static_cast<int>(ready.value);
      auto paused = media_element_->IsPaused(); if (paused) media_paused = paused.value ? 1 : 0;
      auto time = media_element_->GetCurrentTime(); if (time) media_time = time.value.count();
    }
    std::ostringstream out;
    out << "reason=" << reason << " gen=" << generation_.load()
        << " stopped=" << stopped_.load() << " closing=" << closing_.load()
        << " playPending=" << play_request_pending_.load()
        << " desired=" << desired_playing_.load() << " state=" << state_.load()
        << " source=" << (source_ ? 1 : 0) << " sourceReady=" << source_ready
        << " media=" << (media_element_ ? 1 : 0) << " mediaReady=" << media_ready
        << " mediaPaused=" << media_paused << " mediaTime=" << media_time
        << " current=" << current_time_.load() << " target=" << target_time_.load()
        << " buffered=" << buffered_start_.load() << "-" << buffered_end_.load()
        << " seekPending=" << seek_pending_.load() << " seekDemux=" << seek_demux_ready_.load()
        << " seekReady=" << seek_ready_emitted_.load() << " seekTime=" << seek_time_.load()
        << " videoOpen=" << (video_sink_ && video_sink_->open.load())
        << " videoSession=" << (video_sink_ ? video_sink_->session.load() : -1)
        << " audioOpen=" << (audio_stream_ < 0 || (audio_sink_ && audio_sink_->open.load()))
        << " audioSession=" << (audio_sink_ ? audio_sink_->session.load() : -1)
        << " format=" << (format_ ? 1 : 0) << " reader=" << (reader_ ? 1 : 0);
    Emit("snapshot", media_time * 1000.0, out.str().c_str());
  }

  void OnSourceClosed() override {
    Snapshot("source-closed-event");
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
    auto opening = source_->Open([this](OperationResult result) {
      Emit("log", static_cast<double>(result), "elementary media source open callback");
      Snapshot("source-open-callback");
      if (result != OperationResult::kSuccess) Emit("error", 0, "Samsung could not open the elementary media source.");
    });
    Emit("log", static_cast<double>(opening.operation_result), "elementary media source open requested");
    Snapshot("source-open-requested");
  }
  void OnSourceOpen() override {
    Emit("log", 0, "media source open");
    Snapshot("source-open-event");
    // Some Samsung firmware does not emit OnCanPlay until Play() has first
    // been requested. JavaScript waits for prepare() before calling Play(),
    // so using OnCanPlay as the sole readiness event creates a deadlock.
    // An open source means both configured tracks are accepted and the demux
    // thread may feed them; playback can safely be requested from this point.
    EmitReady();
  }
  void OnPlaybackPositionChanged(Seconds time) override {
    current_time_.store(time.count()); Emit("time", time.count() * 1000.0);
    if (buffered_start_.load() >= 0 && buffered_start_.load() < time.count()) buffered_start_.store(time.count());
    target_time_.store(time.count() + forward_buffer_seconds_); wake_.notify_one();
  }
  void OnPipelineError(samsung::wasm::MediaPipelineError error, const char* message) override { Snapshot("pipeline-error"); Emit("error", static_cast<double>(error), message ? message : "Samsung media pipeline error."); }
  void OnCanPlay() override {
    state_.store(2); Emit("log", desired_playing_.load() ? 1 : 0, "HTML media can play"); EmitReady();
    Snapshot("can-play-event");
    if (desired_playing_.load()) {
      resume_after_seek_.store(false);
      auto paused = media_element_ ? media_element_->IsPaused() : samsung::wasm::Result<bool>{};
      if (!paused || paused.value) Play();
    }
  }
  void OnPlaying() override { state_.store(3); Snapshot("playing-event"); Emit("playing"); }
  void OnPause() override {
    state_.store(4); Snapshot("pause-event"); Emit("paused");
  }
  void OnWaiting() override { Snapshot("waiting-event"); Emit("buffering", 0); }
  void OnEnded() override { desired_playing_.store(false); state_.store(5); Snapshot("ended-event"); Emit("complete"); }
  void OnError(samsung::html::MediaError error, const char* message) override { Snapshot("media-error"); Emit("error", static_cast<double>(error), message ? message : "HTML media element error."); }

  void Wake() { wake_.notify_one(); }
  void RequestSeek(double time) {
    if (seek_callback_handled_.exchange(true)) { Emit("log", time, "duplicate track seek callback ignored"); return; }
    seek_time_.store(time); seek_pending_.store(true); wake_.notify_one();
  }

 private:
  void FinalizeStop(OperationResult result) {
    Snapshot("stop-close-callback");
    Emit("log", static_cast<double>(result), "elementary media source closed");
    video_sink_.reset();
    audio_sink_.reset();
    // Samsung requires the source to be destroyed before its associated
    // HTMLMediaElement controller.
    source_.reset();
    media_element_.reset();
    state_.store(0);
    closing_.store(false);
    Snapshot("stop-finalized");
    Emit("stopped");
  }
  void EmitReady() {
    if (!ready_emitted_.exchange(true)) Emit("ready");
  }
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
  static void ResumeMain(Player* self) {
    if (!self->stopped_.load() && self->desired_playing_.load()) {
      Emit("log", self->seek_time_.load(), "seek buffer ready; restarting playback state");
      if (self->media_element_) self->media_element_->Pause();
    }
  }
  void Setup() {
    if (stopped_.load()) return;
    Emit("log", 0, "creating HTML media element");
    media_element_ = std::make_unique<HTMLMediaElement>(element_id_.c_str());
    Snapshot("media-element-created");
    if (!media_element_->IsValid()) { Emit("error", 0, "WASM video element is unavailable."); return; }
    media_element_->SetListener(this);
    source_ = std::make_unique<ElementaryMediaStreamSource>(samsung::wasm::EmssLatencyMode::kNormal, samsung::wasm::EmssRenderingMode::kMediaElement);
    Snapshot("source-created");
    if (!source_->IsValid()) { Emit("error", 0, "Samsung elementary media source is unavailable."); return; }
    source_->SetListener(this);
    auto attached = media_element_->SetSrc(source_.get());
    Emit("log", static_cast<double>(attached.operation_result), "elementary media source attachment result");
    Snapshot("source-attached");
    if (!attached) { Emit("error", static_cast<double>(attached.operation_result), "Samsung rejected the elementary media source attachment."); return; }
    Emit("log", 0, "elementary media source attached");
  }

  void Demux() {
    Emit("log", file_size_, "FFmpeg demux starting");
    reader_ = std::make_unique<RangeReader>(url_, cache_id_, file_size_, hot_cache_mib_, disk_cache_mib_);
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
    { std::lock_guard<std::mutex> lock(byte_time_mutex_); byte_time_anchors_.clear(); }
    { std::lock_guard<std::mutex> lock(media_segment_mutex_); media_segments_.clear(); }
    RefreshIndexAnchors();
    size_t anchor_count = 0;
    { std::lock_guard<std::mutex> lock(byte_time_mutex_); anchor_count = byte_time_anchors_.size(); }
    Emit("log", static_cast<double>(anchor_count), "FFmpeg byte/time index ready");
    Emit("log", duration_, "FFmpeg stream metadata ready");
    frame_rate_ = av_guess_frame_rate(format_, format_->streams[video_stream_], nullptr);
    target_time_.store(forward_buffer_seconds_);
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
        buffered_start_.store(-1); buffered_end_.store(-1);
        const auto session_deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
        bool sessions_changed = false;
        while (!stopped_.load() && std::chrono::steady_clock::now() < session_deadline) {
          const bool video_changed = video_sink_ && video_sink_->session.load() != seek_video_session_.load();
          const bool audio_changed = audio_stream_ < 0 || (audio_sink_ && audio_sink_->session.load() != seek_audio_session_.load());
          if (video_changed && audio_changed) { sessions_changed = true; break; }
          std::unique_lock<std::mutex> lock(wake_mutex_);
          wake_.wait_for(lock, std::chrono::milliseconds(10));
        }
        Emit("log", sessions_changed ? 1 : 0, sessions_changed ? "seek track sessions ready" : "seek track session wait timed out");
        const int seek_result = av_seek_frame(format_, video_stream_, static_cast<int64_t>(time / av_q2d(format_->streams[video_stream_]->time_base)), AVSEEK_FLAG_BACKWARD);
        Emit("log", seek_result, seek_result >= 0 ? "FFmpeg seek completed" : "FFmpeg seek failed");
        if (seek_result >= 0) RefreshIndexAnchors();
        avformat_flush(format_); target_time_.store(time + forward_buffer_seconds_); seek_demux_ready_.store(seek_result >= 0);
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
      if (packet.stream_index != video_stream_ && packet.stream_index != audio_stream_) {
        av_packet_unref(&packet); has_packet = false; continue;
      }
      AVStream* stream = format_->streams[packet.stream_index];
      const double pts = packet.pts == AV_NOPTS_VALUE ? 0 : packet.pts * av_q2d(stream->time_base);
      const double packet_duration = packet.duration > 0 ? packet.duration * av_q2d(stream->time_base) : 0;
      if (packet.pos >= 0) {
        std::lock_guard<std::mutex> lock(media_segment_mutex_);
        media_segments_.insert(packet.pos / RangeReader::kSegmentBytes);
      }
      if (packet.stream_index == video_stream_ && (packet.flags & AV_PKT_FLAG_KEY) != 0) AddByteTimeAnchor(packet.pos, pts);
      if (seek_demux_ready_.load() && packet.stream_index == audio_stream_ && pts + std::max(0.0, packet_duration) < seek_time_.load() - 0.05) {
        av_packet_unref(&packet); has_packet = false; continue;
      }
      if (pts > target_time_.load()) {
        std::unique_lock<std::mutex> lock(wake_mutex_); wake_.wait_for(lock, std::chrono::milliseconds(100)); continue;
      }
      TrackSink* sink = packet.stream_index == video_stream_ ? video_sink_.get() : packet.stream_index == audio_stream_ ? audio_sink_.get() : nullptr;
      if (sink) {
        const double dts = packet.dts == AV_NOPTS_VALUE ? pts : packet.dts * av_q2d(stream->time_base);
        const double duration = packet_duration;
        ElementaryMediaPacket media_packet{Seconds{pts}, Seconds{dts}, Seconds{duration}, (packet.flags & AV_PKT_FLAG_KEY) != 0,
          static_cast<size_t>(packet.size), packet.data, 0, 0, 0, 0, sink->session.load()};
        auto appended = sink->track.AppendPacket(media_packet);
        if (appended && packet.stream_index == video_stream_) {
          const double end = pts + std::max(0.0, duration);
          if (buffered_start_.load() < 0 || pts < buffered_start_.load()) buffered_start_.store(pts);
          if (end > buffered_end_.load()) buffered_end_.store(end);
          if (seek_demux_ready_.load() && end >= seek_time_.load() && !seek_ready_emitted_.exchange(true)) {
            Emit("seek-ready", seek_time_.load() * 1000.0);
            if (resume_after_seek_.exchange(false)) emscripten_async_run_in_main_runtime_thread(EM_FUNC_SIG_VI, ResumeMain, this);
          }
        }
        if (!appended && appended.operation_result == OperationResult::kAppendBufferFull) {
          if (!buffer_full_logged_.exchange(true)) Emit("log", pts, packet.stream_index == video_stream_ ? "video packet buffer full" : "audio packet buffer full");
          std::unique_lock<std::mutex> lock(wake_mutex_); wake_.wait_for(lock, std::chrono::milliseconds(20)); continue;
        }
        if (!appended && appended.operation_result != OperationResult::kAppendIgnored) Emit("log", static_cast<double>(appended.operation_result), "packet append was rejected");
      }
      av_packet_unref(&packet); has_packet = false;
    }
    if (has_packet) av_packet_unref(&packet);
  }

  std::string url_, cache_id_, video_mime_, audio_mime_, element_id_;
  int64_t file_size_ = 0;
  int requested_audio_index_ = -1, hot_cache_mib_ = 64, disk_cache_mib_ = 0, forward_buffer_seconds_ = 3;
  std::thread demux_thread_;
  std::atomic<bool> stopped_{true}, closing_{false}, seek_pending_{false}, desired_playing_{false}, ready_emitted_{false}, play_request_pending_{false}, resume_after_seek_{false}, seek_callback_handled_{false}, seek_demux_ready_{false}, seek_ready_emitted_{false}, buffer_full_logged_{false};
  std::atomic<double> seek_time_{0}, current_time_{0}, target_time_{3};
  std::atomic<double> buffered_start_{-1}, buffered_end_{-1};
  std::atomic<int> seek_video_session_{-1}, seek_audio_session_{-1};
  std::atomic<int> state_{0}, generation_{0};
  std::mutex wake_mutex_; std::condition_variable wake_;
  std::unique_ptr<RangeReader> reader_;
  AVFormatContext* format_ = nullptr; AVIOContext* avio_ = nullptr;
  int video_stream_ = -1, audio_stream_ = -1; double duration_ = 0; AVRational frame_rate_{24, 1};
  std::unique_ptr<HTMLMediaElement> media_element_;
  std::unique_ptr<ElementaryMediaStreamSource> source_;
  std::unique_ptr<TrackSink> video_sink_, audio_sink_;
  mutable std::mutex byte_time_mutex_;
  std::vector<std::pair<int64_t, double>> byte_time_anchors_;
  mutable std::mutex media_segment_mutex_;
  std::unordered_set<int64_t> media_segments_;
};

void TrackSink::OnTrackOpen() { open.store(true); Emit("log", session.load(), "elementary media track open"); owner->Snapshot("track-open"); owner->Wake(); }
void TrackSink::OnTrackClosed(ElementaryMediaTrack::CloseReason reason) { open.store(false); Emit("log", static_cast<double>(reason), "elementary media track closed"); owner->Snapshot("track-closed"); owner->Wake(); }
void TrackSink::OnSeek(Seconds time) { Emit("log", time.count(), "elementary media track seek callback"); owner->Snapshot("track-seek"); owner->RequestSeek(time.count()); }
void TrackSink::OnSessionIdChanged(SessionId id) { session.store(id); Emit("log", id, "elementary media track session changed"); owner->Snapshot("track-session-changed"); owner->Wake(); }

Player player;
}  // namespace

extern "C" {
EMSCRIPTEN_KEEPALIVE void seanime_open(const char* url, const char* cache_id, double file_size, const char* video_mime,
                                       const char* audio_mime, const char* element_id,
                                       int audio_index, int hot_cache_mib, int disk_cache_mib, int forward_buffer_seconds) {
  player.Open(url ? url : "", cache_id ? cache_id : (url ? url : ""), static_cast<int64_t>(file_size), video_mime ? video_mime : "",
              audio_mime ? audio_mime : "", element_id ? element_id : "wasm-video",
              audio_index, hot_cache_mib, disk_cache_mib, forward_buffer_seconds);
}
EMSCRIPTEN_KEEPALIVE void seanime_play() { player.Play(); }
EMSCRIPTEN_KEEPALIVE void seanime_pause() { player.Pause(); }
EMSCRIPTEN_KEEPALIVE void seanime_seek(double seconds) { player.Seek(seconds); }
EMSCRIPTEN_KEEPALIVE void seanime_stop() { player.Stop(); }
EMSCRIPTEN_KEEPALIVE double seanime_duration() { return player.Duration(); }
EMSCRIPTEN_KEEPALIVE double seanime_current_time() { return player.CurrentTime(); }
EMSCRIPTEN_KEEPALIVE int seanime_state() { return player.State(); }
EMSCRIPTEN_KEEPALIVE double seanime_bandwidth() { return player.Bandwidth(); }
EMSCRIPTEN_KEEPALIVE double seanime_buffered_start() { return player.BufferedStart(); }
EMSCRIPTEN_KEEPALIVE double seanime_buffered_end() { return player.BufferedEnd(); }
EMSCRIPTEN_KEEPALIVE double seanime_time_for_byte(double offset) { return player.TimeForByte(offset); }
EMSCRIPTEN_KEEPALIVE int seanime_byte_range_has_media(double start, double end) { return player.ByteRangeHasMedia(start, end) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE void seanime_debug_snapshot() { player.Snapshot("poll"); }
}

int main() { EM_ASM(noExitRuntime = true); }
