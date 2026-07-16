import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SeanimeClient } from "../api/seanime-client"
import type { PlayerSettings } from "../domain/settings"
import { isComplete, nextAvailableEpisode, resumePosition, shouldOfferAutoNext } from "../domain/playback"
import { cueAt, parseSubtitleFile } from "../domain/subtitles"
import { selectTrack } from "../domain/tracks"
import type { MediaContainer, PlaybackSource, SubtitleCue, TrackDescriptor, TrackPreference } from "../domain/types"
import { storage } from "../lib/storage"
import { AvPlayAdapter, type AvPlayEvent } from "../platform/avplay-adapter"
import { RemoteKey } from "../platform/remote"
import { Focusable } from "../ui/Focusable"

type TrackState = { audio?: TrackPreference; subtitle?: TrackPreference; subtitlesOff?: boolean }

export function PlayerScreen({ initialSource, client, settings, onExit, onSourceChange }: { initialSource: PlaybackSource; client: SeanimeClient; settings: PlayerSettings; onExit: () => void; onSourceChange: (source: PlaybackSource) => void }) {
  const [source, setSource] = useState(initialSource)
  const [adapter, setAdapter] = useState<AvPlayAdapter | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffering, setBuffering] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [mediaContainer, setMediaContainer] = useState<MediaContainer | null>(null)
  const [networkTest, setNetworkTest] = useState<string>("Not tested")
  const [testingNetwork, setTestingNetwork] = useState(false)
  const [runtimeBandwidth, setRuntimeBandwidth] = useState<number | null>(null)
  const [avTracks, setAvTracks] = useState<TrackDescriptor[]>([])
  const [serverSubtitleTracks, setServerSubtitleTracks] = useState<TrackDescriptor[]>([])
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([])
  const [trackPanel, setTrackPanel] = useState<"audio" | "subtitle" | "episodes" | "diagnostics" | null>(null)
  const [overlay, setOverlay] = useState(true)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [nativeSubtitle, setNativeSubtitle] = useState("")
  const [eof, setEof] = useState(false)
  const completed = useRef(false)
  const nativeSubtitleTimer = useRef<number | null>(null)
  const seekTarget = useRef<number | null>(null)
  const seekInFlight = useRef(false)
  const currentRef = useRef({ time: 0, duration: 0 })
  const { ref, focusKey } = useFocusable({ focusKey: "PLAYER", trackChildren: true })
  const tracks = useMemo(() => [
    ...avTracks.filter(track => track.type !== "TEXT" || serverSubtitleTracks.length === 0),
    ...serverSubtitleTracks,
  ], [avTracks, serverSubtitleTracks])
  const subtitle = useMemo(() => cueAt(subtitleCues, time)?.text ?? nativeSubtitle, [nativeSubtitle, subtitleCues, time])

  const flush = useCallback(() => {
    const state = currentRef.current
    if (state.duration <= 0) return Promise.resolve()
    return client.updateContinuity({ currentTime: state.time, duration: state.duration, mediaId: source.mediaId, episodeNumber: source.episode.progressNumber, filepath: source.localFile.path, kind: "mediastream" }).catch(() => undefined)
  }, [client, source])

  const applyTracks = useCallback((instance: AvPlayAdapter) => {
    let all: TrackDescriptor[] = []
    try { all = instance.getTracks().map(track => ({ ...track, source: "avplay" as const })); setAvTracks(all) } catch { return }
    const saved = storage.getTrackState() as TrackState
    const audio = selectTrack(all.filter(track => track.type === "AUDIO"), saved.audio, settings.preferredAudio)
    // Track selection is optional. A malformed/unsupported embedded track must
    // never abort playback of an otherwise supported video stream.
    try { if (audio) instance.selectTrack("AUDIO", audio.index) } catch { /* Keep AVPlay's default audio track. */ }
    const subtitlesOff = saved.subtitlesOff ?? !settings.subtitlesEnabled
    if (!subtitlesOff) {
      const text = selectTrack(all.filter(track => track.type === "TEXT"), saved.subtitle, settings.preferredSubtitles)
      try { if (text) instance.selectTrack("TEXT", text.index) } catch { /* Keep AVPlay's default subtitle track. */ }
    }
    // Some Samsung firmware ignores subtitle unmute before a TEXT track has
    // been selected during the READY -> PLAYING transition.
    try { instance.setSubtitlesEnabled(!subtitlesOff) } catch { /* Keep AVPlay's default subtitle state. */ }
  }, [settings])

  useEffect(() => {
    let cancelled = false
    setServerSubtitleTracks([])
    setSubtitleCues([])
    setMediaContainer(null)
    void client.getMediaContainer(source.localFile.path).then(container => {
      if (cancelled) return
      setMediaContainer(container)
      const extracted = (container.mediaInfo?.subtitles ?? [])
        .filter(track => track.link)
        .map<TrackDescriptor>(track => ({
          index: track.index,
          type: "TEXT",
          language: track.language || "unknown",
          title: track.title || `Subtitle ${track.index + 1}`,
          codec: track.codec,
          source: "server",
          url: track.link,
          raw: track,
        }))
      setServerSubtitleTracks(extracted)
    }).catch(() => {
      // Native AVPlay tracks remain available when Seanime cannot extract a
      // text track, such as an unsupported bitmap subtitle format.
    })
    return () => { cancelled = true }
  }, [client, source.localFile.path])

  useEffect(() => {
    if (!adapter || serverSubtitleTracks.length === 0) return
    const saved = storage.getTrackState() as TrackState
    const subtitlesOff = saved.subtitlesOff ?? !settings.subtitlesEnabled
    if (subtitlesOff) { setSubtitleCues([]); return }
    const selected = selectTrack(serverSubtitleTracks, saved.subtitle, settings.preferredSubtitles)
    if (!selected?.url) return
    let cancelled = false
    void client.getExtractedSubtitle(selected.url).then(content => {
      if (cancelled) return
      const cues = parseSubtitleFile(content, selected.codec)
      if (!cues.length) return
      setSubtitleCues(cues)
      setNativeSubtitle("")
      try { adapter.setSubtitlesEnabled(false) } catch { /* The cue renderer is active. */ }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [adapter, client, serverSubtitleTracks, settings.preferredSubtitles, settings.subtitlesEnabled])

  useEffect(() => {
    let instance: AvPlayAdapter
    try { instance = new AvPlayAdapter(); setAdapter(instance) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return }
    const unsubscribe = instance.subscribe((event: AvPlayEvent) => {
      if (event.type === "time" && seekTarget.current === null) { const seconds = event.milliseconds / 1000; setTime(seconds); currentRef.current.time = seconds }
      if (event.type === "buffering") setBuffering(event.percent >= 100 ? null : event.percent)
      if (event.type === "error") setError(event.message)
      if (event.type === "subtitle") {
        if (nativeSubtitleTimer.current !== null) window.clearTimeout(nativeSubtitleTimer.current)
        setNativeSubtitle(event.text)
        nativeSubtitleTimer.current = window.setTimeout(() => setNativeSubtitle(""), event.duration)
      }
      if (event.type === "complete") { setEof(true); setPlaying(false); setTime(currentRef.current.duration) }
    })
    instance.load(source.url, settings.bufferPolicy)
    instance.prepare().then(async () => {
      const seconds = instance.duration / 1000; setDuration(seconds); currentRef.current.duration = seconds
      if (source.resumePosition > 0) await instance.seek(source.resumePosition * 1000)
      instance.play(); setPlaying(true)
      // Samsung only permits setSelectTrack/setSilentSubtitle reliably in
      // PLAYING when prepareAsync() was used. READY is reserved for synchronous
      // prepare (and, for audio selection, Smooth Streaming).
      await instance.waitForState("PLAYING")
      applyTracks(instance)
      setFocus("PLAYER_PLAY")
      void client.startTracking(source.mediaId, source.episode.progressNumber).catch(() => undefined)
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    completed.current = false; setEof(false); setNativeSubtitle("")
    return () => {
      if (nativeSubtitleTimer.current !== null) window.clearTimeout(nativeSubtitleTimer.current)
      unsubscribe(); void flush(); void client.cancelTracking().catch(() => undefined); instance.stop()
    }
  }, [applyTracks, client, source, flush])

  useEffect(() => { currentRef.current = { time, duration } }, [time, duration])
  useEffect(() => {
    if (!playing) return
    const interval = window.setInterval(() => void flush(), 15_000)
    return () => clearInterval(interval)
  }, [flush, playing])
  useEffect(() => {
    if (!completed.current && isComplete(time, duration, eof)) {
      completed.current = true
      void client.updateProgress(source.mediaId, source.episode.progressNumber, source.media.episodes ?? source.queue.length).catch(() => undefined)
    }
    if (settings.autoplayNext && countdown === null && nextAvailableEpisode(source.queue, source.episode) && shouldOfferAutoNext(time, duration)) setCountdown(5)
  }, [client, countdown, duration, eof, settings.autoplayNext, source, time])
  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) { playNext(); return }
    const timeout = window.setTimeout(() => setCountdown(value => value === null ? null : value - 1), 1000)
    return () => clearTimeout(timeout)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown])

  const togglePlay = () => { if (!adapter) return; if (playing) { adapter.pause(); setPlaying(false); void flush() } else { adapter.play(); setPlaying(true) }; setOverlay(true) }
  const commitQueuedSeek = () => {
    if (!adapter || seekInFlight.current || seekTarget.current === null) return
    const target = seekTarget.current
    seekInFlight.current = true
    void adapter.seek(target * 1000).catch(() => undefined).then(() => {
      seekInFlight.current = false
      if (seekTarget.current !== target) { commitQueuedSeek(); return }
      seekTarget.current = null
      const actual = adapter.currentTime / 1000
      currentRef.current.time = actual
      setTime(actual)
    })
  }
  const seek = (seconds: number, revealControls = true) => {
    if (!adapter) return
    const base = seekTarget.current ?? currentRef.current.time
    const target = Math.max(0, duration > 0 ? Math.min(duration, base + seconds) : base + seconds)
    seekTarget.current = target
    currentRef.current.time = target
    setTime(target)
    if (revealControls) setOverlay(true)
    commitQueuedSeek()
  }
  const exit = () => { void flush().then(onExit, onExit) }
  const openEpisode = async (episode: PlaybackSource["episode"]) => {
    if (!episode.localFile) return
    let saved = 0
    try {
      const history = await client.getHistoryItem(source.mediaId)
      if (history.item?.episodeNumber === episode.progressNumber) saved = resumePosition(history.item, settings.resumeEnabled)
    } catch { /* Resume is optional. */ }
    void flush()
    const nextSource = { ...source, episode, localFile: episode.localFile, url: client.mediaUrl(episode.localFile.path), resumePosition: saved }
    setTrackPanel(null); setCountdown(null); setSource(nextSource); onSourceChange(nextSource)
  }
  const playNext = () => {
    const next = nextAvailableEpisode(source.queue, source.episode)
    if (!next?.localFile) { setCountdown(null); return }
    void openEpisode(next)
  }

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (trackPanel) { if (event.keyCode === RemoteKey.Back) { event.preventDefault(); setTrackPanel(null); setFocus("PLAYER_PLAY") }; return }
      if (!overlay && (event.keyCode === RemoteKey.Left || event.keyCode === RemoteKey.Right)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        seek(event.keyCode === RemoteKey.Left ? -settings.seekStepSeconds : settings.seekStepSeconds, false)
        return
      }
      if (!overlay && event.keyCode === RemoteKey.Enter) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        if (playing) { adapter?.pause(); setPlaying(false); void flush() }
        setOverlay(true)
        return
      }
      if (event.keyCode === RemoteKey.Back) { event.preventDefault(); exit() }
      else if ([RemoteKey.Play, RemoteKey.Pause, RemoteKey.PlayPause].includes(event.keyCode as never)) togglePlay()
      else if (event.keyCode === RemoteKey.Stop) exit()
      else if (event.keyCode === RemoteKey.Rewind) seek(-settings.seekStepSeconds)
      else if (event.keyCode === RemoteKey.FastForward) seek(settings.seekStepSeconds)
      else setOverlay(true)
    }
    window.addEventListener("keydown", handle, true)
    return () => window.removeEventListener("keydown", handle, true)
  })
  useEffect(() => {
    const visibility = () => { if (document.hidden) void flush() }
    document.addEventListener("visibilitychange", visibility); window.addEventListener("beforeunload", flush)
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("beforeunload", flush) }
  }, [flush])
  useEffect(() => {
    document.body.classList.add("player-active")
    document.documentElement.classList.add("player-active")
    return () => {
      document.body.classList.remove("player-active")
      document.documentElement.classList.remove("player-active")
    }
  }, [])
  useEffect(() => {
    if (!overlay || !playing || trackPanel || countdown !== null) return
    const timeout = window.setTimeout(() => setOverlay(false), 5_000)
    return () => clearTimeout(timeout)
  }, [countdown, overlay, playing, trackPanel])
  useEffect(() => {
    if (!trackPanel) return
    window.setTimeout(() => setFocus("PLAYER_MODAL_FIRST"), 0)
  }, [trackPanel])
  useEffect(() => {
    if (trackPanel !== "diagnostics" || !adapter) return
    const update = () => setRuntimeBandwidth(adapter.getBandwidthBitsPerSecond())
    update()
    const interval = window.setInterval(update, 1_000)
    return () => window.clearInterval(interval)
  }, [adapter, trackPanel])
  useEffect(() => {
    if (!error) return
    window.setTimeout(() => setFocus("PLAYER_ERROR_BACK"), 0)
  }, [error])
  useEffect(() => {
    // Auto-hide unmounts the focused controls. Restore a deterministic target
    // when any remote key makes the overlay visible again.
    if (!overlay || error || trackPanel) return
    window.setTimeout(() => setFocus("PLAYER_PLAY"), 0)
  }, [error, overlay, trackPanel])

  const chooseTrack = (track: TrackDescriptor) => {
    const saved = storage.getTrackState() as TrackState
    const preference = { language: track.language, title: track.title }
    storage.setTrackState({ ...saved, [track.type === "AUDIO" ? "audio" : "subtitle"]: preference, ...(track.type === "TEXT" ? { subtitlesOff: false } : {}) })
    if (track.type === "TEXT" && track.source === "server" && track.url) {
      void client.getExtractedSubtitle(track.url).then(content => {
        const cues = parseSubtitleFile(content, track.codec)
        if (!cues.length) return
        setSubtitleCues(cues)
        setNativeSubtitle("")
        adapter?.setSubtitlesEnabled(false)
      }).catch(() => undefined)
    } else {
      adapter?.selectTrack(track.type, track.index)
      if (track.type === "TEXT") { setSubtitleCues([]); adapter?.setSubtitlesEnabled(true) }
    }
    setTrackPanel(null)
  }
  const subtitlesOff = () => { adapter?.setSubtitlesEnabled(false); setSubtitleCues([]); setNativeSubtitle(""); storage.setTrackState({ ...(storage.getTrackState() as TrackState), subtitlesOff: true }); setTrackPanel(null) }
  const testConnection = () => {
    setTestingNetwork(true); setNetworkTest("Testing…")
    void client.measureMediaSpeed(source.url).then(result => {
      setNetworkTest(`${result.megabitsPerSecond.toFixed(1)} Mbps`); setTestingNetwork(false)
    }, reason => {
      setNetworkTest(reason instanceof Error ? reason.message : String(reason)); setTestingNetwork(false)
    })
  }
  const percent = duration > 0 ? Math.min(100, time / duration * 100) : 0
  return <FocusContext.Provider value={focusKey}><div ref={ref} className="player-screen" onMouseMove={() => setOverlay(true)}>
    <object id="av-player" className="video-surface" type="application/avplayer" aria-label="Video playback surface" />
    {subtitle && <div className="subtitle" style={{ fontSize: settings.subtitleFontSize, bottom: `${settings.subtitleBottomPercent}%` }}>{subtitle}</div>}
    {buffering !== null && <div className="player-state"><div className="spinner" /><strong>Buffering {buffering}%</strong></div>}
    {error && <div className="player-error"><h2>Unable to play this file</h2><p>{error}</p><Focusable focusKey="PLAYER_ERROR_BACK" onEnter={exit}>Back to episodes</Focusable></div>}
    {overlay && !error && <div className="player-overlay"><div className="player-top"><div><strong>{source.media.title?.userPreferred || source.media.title?.english || source.media.title?.romaji}</strong><small>{source.episode.displayTitle} · {source.episode.episodeTitle}</small></div><Focusable onEnter={exit}>✕ Close</Focusable></div>
      <div className="player-bottom"><div className="timeline"><div className="timeline-fill" style={{ width: `${percent}%` }} /></div><div className="time-row"><span>{formatTime(time)}</span><span>{formatTime(duration)}</span></div>
        <div className="player-actions"><Focusable onEnter={() => seek(-settings.seekStepSeconds)}>↶ {settings.seekStepSeconds}s</Focusable><Focusable focusKey="PLAYER_PLAY" className="play-control" onEnter={togglePlay}>{playing ? "Ⅱ" : "▶"}</Focusable><Focusable onEnter={() => seek(settings.seekStepSeconds)}>{settings.seekStepSeconds}s ↷</Focusable><Focusable onEnter={() => setTrackPanel("audio")}>♬ Audio</Focusable><Focusable onEnter={() => setTrackPanel("subtitle")}>CC Subtitles</Focusable><Focusable onEnter={() => setTrackPanel("episodes")}>☷ Episodes</Focusable><Focusable onEnter={() => setTrackPanel("diagnostics")}>ⓘ Stream</Focusable></div>
      </div></div>}
    {countdown !== null && <div className="next-countdown"><strong>Next episode in {countdown}</strong><div><Focusable onEnter={() => setCountdown(null)}>Cancel</Focusable><Focusable className="primary" onEnter={playNext}>Play now</Focusable></div></div>}
    {trackPanel && <FocusBoundary><div className="modal-backdrop"><div className="track-panel"><h2>{trackPanel === "audio" ? "Audio tracks" : trackPanel === "subtitle" ? "Subtitles" : trackPanel === "diagnostics" ? "Stream diagnostics" : "Episodes"}</h2>
      {trackPanel === "subtitle" && <Focusable focusKey="PLAYER_MODAL_FIRST" onEnter={subtitlesOff}>Off</Focusable>}
      {trackPanel === "diagnostics" ? <div className="diagnostics-panel">
        <dl>
          <div><dt>AVPlay state</dt><dd>{adapter?.state ?? "Unavailable"}</dd></div>
          <div><dt>Buffer policy</dt><dd>{settings.bufferPolicy}</dd></div>
          <div><dt>Runtime bandwidth</dt><dd>{runtimeBandwidth ? formatBitrate(runtimeBandwidth) : "Not reported for this stream"}</dd></div>
          <div><dt>TV-to-server test</dt><dd>{networkTest}</dd></div>
          <div><dt>Container</dt><dd>{mediaContainer?.mediaInfo?.container || mediaContainer?.mediaInfo?.extension || "Unknown"}</dd></div>
          <div><dt>Video</dt><dd>{formatVideo(mediaContainer)}</dd></div>
          <div><dt>Source bitrate</dt><dd>{mediaContainer?.mediaInfo?.video?.bitrate ? formatBitrate(mediaContainer.mediaInfo.video.bitrate) : "Unknown"}</dd></div>
          <div><dt>File size</dt><dd>{mediaContainer?.mediaInfo?.size ? formatBytes(mediaContainer.mediaInfo.size) : "Unknown"}</dd></div>
          <div><dt>Audio</dt><dd>{mediaContainer?.mediaInfo?.audios?.map(audio => `${audio.codec.toUpperCase()} ${audio.channels}ch ${audio.language || ""}`).join(", ") || "Unknown"}</dd></div>
          <div><dt>Subtitle renderer</dt><dd>{subtitleCues.length ? "Seanime extracted text / CSS" : "Samsung AVPlay native"}</dd></div>
        </dl>
        <Focusable focusKey="PLAYER_MODAL_FIRST" disabled={testingNetwork} onEnter={testConnection}>{testingNetwork ? "Testing connection…" : "Test TV-to-server speed"}</Focusable>
      </div> : trackPanel === "episodes" ? source.queue.map((ep, index) => <Focusable focusKey={index === 0 ? "PLAYER_MODAL_FIRST" : undefined} key={`${ep.type}-${ep.episodeNumber}`} disabled={!ep.localFile} onEnter={() => {
        void openEpisode(ep)
      }}>{ep.displayTitle}<small>{ep.localFile ? ep.episodeTitle : "Unavailable on server"}</small></Focusable>)
      : tracks.filter(track => track.type === (trackPanel === "audio" ? "AUDIO" : "TEXT")).map((track, index) => <Focusable focusKey={trackPanel === "audio" && index === 0 ? "PLAYER_MODAL_FIRST" : undefined} key={`${track.source ?? "avplay"}-${track.type}-${track.index}`} onEnter={() => chooseTrack(track)}>{track.title}<small>{track.language}{track.codec ? ` · ${track.codec}` : ""}</small></Focusable>)}
      <Focusable className="modal-close" onEnter={() => setTrackPanel(null)}>Close</Focusable>
    </div></div></FocusBoundary>}
  </div></FocusContext.Provider>
}

function FocusBoundary({ children }: { children: ReactNode }) {
  const { ref, focusKey } = useFocusable({ focusKey: "PLAYER_MODAL", trackChildren: true, isFocusBoundary: true })
  return <FocusContext.Provider value={focusKey}><div ref={ref}>{children}</div></FocusContext.Provider>
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00"
  const total = Math.max(0, Math.round(seconds)); const h = Math.floor(total / 3600); const m = Math.floor(total % 3600 / 60); const s = total % 60
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`
}

function formatBitrate(bitsPerSecond: number) {
  return bitsPerSecond >= 1_000_000 ? `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bitsPerSecond / 1_000)} Kbps`
}

function formatBytes(bytes: number) {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(2)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`
}

function formatVideo(container: MediaContainer | null) {
  const video = container?.mediaInfo?.video
  if (!video) return "Unknown"
  return `${video.codec.toUpperCase()} · ${video.width}×${video.height} · ${video.pixFmt}`
}
