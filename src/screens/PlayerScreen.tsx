import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SeanimeClient } from "../api/seanime-client"
import { effectiveCachePolicy, type SystemResources } from "../domain/cache"
import { isComplete, nextAvailableEpisode, resumePosition, shouldOfferAutoNext } from "../domain/playback"
import { QueuedSeekController } from "../domain/seeking"
import type { PlayerSettings } from "../domain/settings"
import { cueAt, parseSubtitleFile } from "../domain/subtitles"
import { selectTrack } from "../domain/tracks"
import type { MediaContainer, PlaybackSource, SubtitleCue, TrackDescriptor, TrackPreference } from "../domain/types"
import { storage } from "../lib/storage"
import { AssSubtitleRenderer, videoViewport } from "../platform/ass-subtitle-renderer"
import { AvPlayAdapter } from "../platform/avplay-adapter"
import { createPlaybackEngine } from "../platform/engine-factory"
import type { PlaybackEngine, PlaybackEngineEvent } from "../platform/playback-engine"
import { RemoteKey } from "../platform/remote"
import { emptyResources, getSystemResources } from "../platform/system-info"
import { diagnostic } from "../platform/diagnostics"
import { Focusable } from "../ui/Focusable"

type TrackState = { audio?: TrackPreference; subtitle?: TrackPreference; subtitlesOff?: boolean }
type Panel = "audio" | "subtitle" | "subtitleAppearance" | "playbackSettings" | "episodes" | "diagnostics" | null

export function PlayerScreen({ initialSource, client, settings, onSettings, onExit, onSourceChange }: { initialSource: PlaybackSource; client: SeanimeClient; settings: PlayerSettings; onSettings: (settings: PlayerSettings) => void; onExit: () => void; onSourceChange: (source: PlaybackSource) => void }) {
  const [source, setSource] = useState(initialSource)
  const [engine, setEngine] = useState<PlaybackEngine | null>(null)
  const [engineName, setEngineName] = useState("Starting player…")
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffering, setBuffering] = useState<number | null>(null)
  const [bufferedRanges, setBufferedRanges] = useState<Array<{ start: number; end: number }>>([])
  const [error, setError] = useState("")
  const [mediaContainer, setMediaContainer] = useState<MediaContainer | null>(null)
  const [resources, setResources] = useState<SystemResources>(emptyResources)
  const [networkTest, setNetworkTest] = useState("Not tested")
  const [testingNetwork, setTestingNetwork] = useState(false)
  const [runtimeBandwidth, setRuntimeBandwidth] = useState<number | null>(null)
  const [avTracks, setAvTracks] = useState<TrackDescriptor[]>([])
  const [serverSubtitleTracks, setServerSubtitleTracks] = useState<TrackDescriptor[]>([])
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([])
  const [subtitleRenderer, setSubtitleRenderer] = useState<"libass" | "text" | "avplay" | "off">("off")
  const [subtitleStatus, setSubtitleStatus] = useState("No subtitle track loaded")
  const [panel, setPanel] = useState<Panel>(null)
  const [overlay, setOverlay] = useState(true)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [nativeSubtitle, setNativeSubtitle] = useState("")
  const [eof, setEof] = useState(false)
  const completed = useRef(false)
  const nativeSubtitleTimer = useRef<number | null>(null)
  const seekTarget = useRef<number | null>(null)
  const seekQueueRef = useRef<QueuedSeekController | null>(null)
  const currentRef = useRef({ time: 0, duration: 0 })
  const engineRef = useRef<PlaybackEngine | null>(null)
  const settingsRef = useRef(settings)
  const resourcesRef = useRef<SystemResources>(emptyResources())
  const mediaRef = useRef<MediaContainer | null>(null)
  const serverSubtitleTracksRef = useRef<TrackDescriptor[]>([])
  const playingRef = useRef(false)
  const assCanvasRef = useRef<HTMLCanvasElement>(null)
  const assRendererRef = useRef<AssSubtitleRenderer | null>(null)
  const activeSubtitleTrackRef = useRef<TrackDescriptor | null>(null)
  const playbackGeneration = useRef(0)
  const { ref, focusKey } = useFocusable({ focusKey: "PLAYER", trackChildren: true })
  const tracks = useMemo(() => [...avTracks.filter(track => track.type !== "TEXT" || serverSubtitleTracks.length === 0), ...serverSubtitleTracks], [avTracks, serverSubtitleTracks])
  const subtitle = useMemo(() => cueAt(subtitleCues, time)?.text ?? nativeSubtitle, [nativeSubtitle, subtitleCues, time])
  const cachePolicy = useMemo(() => effectiveCachePolicy(settings, resources), [resources, settings])

  useEffect(() => { settingsRef.current = settings; assRendererRef.current?.setSettings(settings) }, [settings])
  useEffect(() => { void getSystemResources().then(value => { resourcesRef.current = value; setResources(value) }) }, [])

  const flush = useCallback(() => {
    const state = currentRef.current
    if (state.duration <= 0) return Promise.resolve()
    return client.updateContinuity({ currentTime: state.time, duration: state.duration, mediaId: source.mediaId, episodeNumber: source.episode.progressNumber, filepath: source.localFile.path, kind: "mediastream" }).catch(() => undefined)
  }, [client, source])

  const applyTracks = useCallback((instance: PlaybackEngine) => {
    let all: TrackDescriptor[] = []
    try { all = instance.getTracks().map(track => ({ ...track, source: "avplay" as const })); setAvTracks(all) } catch { return }
    const saved = storage.getTrackState() as TrackState
    const audio = selectTrack(all.filter(track => track.type === "AUDIO"), saved.audio, settingsRef.current.preferredAudio)
    try { if (audio) instance.selectTrack("AUDIO", audio.index) } catch { /* Keep the player's default audio track. */ }
    const subtitlesOff = saved.subtitlesOff ?? !settingsRef.current.subtitlesEnabled
    if (!subtitlesOff && serverSubtitleTracksRef.current.length === 0) {
      const text = selectTrack(all.filter(track => track.type === "TEXT"), saved.subtitle, settingsRef.current.preferredSubtitles)
      try { if (text) instance.selectTrack("TEXT", text.index) } catch { /* Keep the player's default subtitle. */ }
      try { instance.setSubtitlesEnabled(true); setSubtitleRenderer("avplay") } catch { /* Subtitle support is optional. */ }
    } else try { instance.setSubtitlesEnabled(false) } catch { /* No-op. */ }
  }, [])

  const loadSubtitle = useCallback(async (track: TrackDescriptor, instance = engineRef.current) => {
    if (!track.url || !instance) return
    activeSubtitleTrackRef.current = track
    diagnostic("subtitle.load", { title: track.title, codec: track.codec, url: track.url, engine: instance.name, useLibass: settingsRef.current.subtitleUseAssStyles })
    setSubtitleStatus(`Loading ${track.title}…`)
    const content = await client.getExtractedSubtitle(track.url)
    const ass = track.codec?.toLocaleLowerCase().includes("ass") || track.codec?.toLocaleLowerCase().includes("ssa") || /^\s*\[Script Info\]/im.test(content)
    diagnostic("subtitle.detected", { ass, contentBytes: content.length })
    instance.setSubtitlesEnabled(false)
    setNativeSubtitle("")
    if (ass && assCanvasRef.current && settingsRef.current.subtitleUseAssStyles) {
      const fallbackCues = parseSubtitleFile(content, "ass")
      const fontNames = mediaRef.current?.mediaInfo?.fonts ?? []
      const loaded = await Promise.all(fontNames.map(name => client.getExtractedAttachment(name).catch(() => null)))
      const fonts = loaded.filter((font): font is Uint8Array => font !== null)
      diagnostic("subtitle.fonts-complete", { requested: fontNames.length, loaded: fonts.length, bytes: fonts.reduce((total, font) => total + font.byteLength, 0) })
      const renderer = assRendererRef.current ?? new AssSubtitleRenderer(
        assCanvasRef.current,
        () => seekTarget.current ?? (engineRef.current ? engineRef.current.currentTime / 1000 : currentRef.current.time),
        () => {
          const video = mediaRef.current?.mediaInfo?.video
          return { width: video?.width || 1920, height: video?.height || 1080 }
        },
        settingsRef.current,
      )
      assRendererRef.current = renderer
      try {
        await renderer.load(content, fonts)
        renderer.setPlaying(playingRef.current)
        setSubtitleCues([])
        setSubtitleRenderer("libass")
        setSubtitleStatus(`libass active · ${fonts.length}/${fontNames.length} embedded fonts loaded`)
        diagnostic("subtitle.renderer-active", { renderer: "libass", fonts: fonts.length })
        return
      } catch (reason) {
        diagnostic("subtitle.libass-fallback", { message: reason instanceof Error ? reason.message : String(reason), cues: fallbackCues.length }, "error")
        await renderer.destroy()
        assRendererRef.current = null
        if (!fallbackCues.length) throw reason
        setSubtitleCues(fallbackCues)
        setSubtitleRenderer("text")
        setSubtitleStatus(`libass failed; using plain-text ASS fallback · ${reason instanceof Error ? reason.message : String(reason)}`)
        return
      }
    }
    assRendererRef.current?.setPlaying(false)
    const cues = parseSubtitleFile(content, track.codec)
    if (!cues.length) throw new Error("The selected subtitle track contains no renderable text.")
    setSubtitleCues(cues)
    setSubtitleRenderer("text")
    setSubtitleStatus(`Text renderer active · ${cues.length} cues`)
    diagnostic("subtitle.renderer-active", { renderer: "text", cues: cues.length, sourceWasAss: ass })
  }, [client])

  useEffect(() => {
    const generation = ++playbackGeneration.current
    let disposed = false
    let active: PlaybackEngine | null = null
    let unsubscribe: (() => void) | null = null
    setError(""); setBuffering(null); setBufferedRanges([]); setTime(0); setDuration(0); setMediaContainer(null); setServerSubtitleTracks([]); serverSubtitleTracksRef.current = []; setSubtitleCues([]); setNativeSubtitle(""); setSubtitleRenderer("off"); setSubtitleStatus("No subtitle track loaded"); setFallbackReason(null)

    const attach = (instance: PlaybackEngine) => {
      unsubscribe?.()
      active = instance
      engineRef.current = instance
      seekQueueRef.current?.reset()
      seekQueueRef.current = new QueuedSeekController(async target => {
        await instance.seek(target * 1000)
        return instance.currentTime / 1000
      }, (seconds, committed) => {
        seekTarget.current = committed ? null : seconds
        currentRef.current.time = seconds; setTime(seconds)
        void assRendererRef.current?.seek(seconds)
      })
      setEngine(instance)
      setEngineName(instance.name)
      unsubscribe = instance.subscribe((event: PlaybackEngineEvent) => {
        if (disposed || generation !== playbackGeneration.current) return
        if (event.type !== "time") diagnostic("player.event", { engine: instance.name, ...event }, event.type === "error" ? "error" : "info")
        if (event.type === "time" && seekTarget.current === null) {
          const seconds = event.milliseconds / 1000
          setTime(seconds); currentRef.current.time = seconds
          if (instance.exactBufferedRanges) setBufferedRanges(instance.getBufferedRanges())
        }
        if (event.type === "buffering") setBuffering(event.percent >= 100 ? null : event.percent)
        if (event.type === "error") setError(event.message)
        if (event.type === "subtitle") {
          if (nativeSubtitleTimer.current !== null) window.clearTimeout(nativeSubtitleTimer.current)
          setNativeSubtitle(event.text)
          nativeSubtitleTimer.current = window.setTimeout(() => setNativeSubtitle(""), event.duration)
        }
        if (event.type === "complete") { setEof(true); setPlaying(false); setTime(currentRef.current.duration) }
      })
    }

    const start = async () => {
      let container: MediaContainer | null = null
      try { container = await client.getMediaContainer(source.localFile.path) } catch { /* AVPlay can still attempt direct playback. */ }
      if (disposed) return
      mediaRef.current = container; setMediaContainer(container)
      const extracted = (container?.mediaInfo?.subtitles ?? []).filter(track => track.link).map<TrackDescriptor>(track => ({
        index: track.index, type: "TEXT", language: track.language || "unknown", title: track.title || `Subtitle ${track.index + 1}`, codec: track.extension || track.codec, source: "server", url: track.link, raw: track,
      }))
      serverSubtitleTracksRef.current = extracted; setServerSubtitleTracks(extracted)
      const selection = createPlaybackEngine(settingsRef.current, container, resourcesRef.current)
      diagnostic("player.engine-selected", { requested: settingsRef.current.playbackBackend, selected: selection.engine.name, fallback: selection.fallbackReason, mediaInfo: container?.mediaInfo })
      setFallbackReason(selection.fallbackReason)
      attach(selection.engine)
      const prepareEngine = async (instance: PlaybackEngine, resumeAt: number) => {
        diagnostic("player.prepare-start", { engine: instance.name, resumeAt })
        instance.load(source.url, settingsRef.current)
        await instance.prepare()
        diagnostic("player.prepare-ready", { engine: instance.name, duration: instance.duration })
        const seconds = instance.duration / 1000
        setDuration(seconds); currentRef.current.duration = seconds
        if (resumeAt > 0) await instance.seek(resumeAt * 1000)
        instance.play(); setPlaying(true)
        if (instance instanceof AvPlayAdapter) await instance.waitForState("PLAYING")
        applyTracks(instance)
      }
      try { await prepareEngine(selection.engine, source.resumePosition) }
      catch (reason) {
        diagnostic("player.prepare-failed", { engine: selection.engine.name, message: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined }, "error")
        if (selection.engine.name !== "FFmpeg + Samsung WASM Player") throw reason
        const position = Math.max(source.resumePosition, currentRef.current.time)
        selection.engine.stop()
        const fallback = new AvPlayAdapter()
        setError("")
        setFallbackReason(`Experimental playback failed; AVPlay resumed automatically: ${reason instanceof Error ? reason.message : String(reason)}`)
        attach(fallback)
        await prepareEngine(fallback, position)
      }
      if (disposed) return
      setFocus("PLAYER_PLAY")
      void client.startTracking(source.mediaId, source.episode.progressNumber).catch(() => undefined)
      const saved = storage.getTrackState() as TrackState
      const subtitlesOff = saved.subtitlesOff ?? !settingsRef.current.subtitlesEnabled
      if (!subtitlesOff && extracted.length) {
        const selected = selectTrack(extracted, saved.subtitle, settingsRef.current.preferredSubtitles)
        if (selected) void loadSubtitle(selected, active).catch(reason => {
          setSubtitleRenderer("off")
          setSubtitleStatus(`Subtitle load failed · ${reason instanceof Error ? reason.message : String(reason)}`)
        })
      }
    }
    void start().catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    completed.current = false; setEof(false)
    return () => {
      disposed = true
      if (nativeSubtitleTimer.current !== null) window.clearTimeout(nativeSubtitleTimer.current)
      unsubscribe?.(); void flush(); void client.cancelTracking().catch(() => undefined); active?.stop()
      engineRef.current = null
      seekQueueRef.current?.reset(); seekQueueRef.current = null
    }
  // Buffer settings apply to the next playback session; changing subtitle appearance does not restart video.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyTracks, client, flush, loadSubtitle, source, settings.playbackBackend])

  useEffect(() => () => { void assRendererRef.current?.destroy(); assRendererRef.current = null }, [])

  useEffect(() => { currentRef.current = { time, duration } }, [time, duration])
  useEffect(() => { playingRef.current = playing; assRendererRef.current?.setPlaying(playing) }, [playing])
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

  const togglePlay = () => {
    const instance = engineRef.current
    if (!instance) return
    if (playing) { instance.pause(); setPlaying(false); void flush() } else { instance.play(); setPlaying(true) }
    setOverlay(true)
  }
  const seek = (seconds: number, revealControls = true) => {
    if (!seekQueueRef.current) return
    seekQueueRef.current.enqueue(seconds, currentRef.current.time, duration)
    if (revealControls) setOverlay(true)
  }
  const exit = () => { void flush().then(onExit, onExit) }
  const openEpisode = async (episode: PlaybackSource["episode"]) => {
    if (!episode.localFile) return
    let saved = 0
    try { const history = await client.getHistoryItem(source.mediaId); if (history.item?.episodeNumber === episode.progressNumber) saved = resumePosition(history.item, settings.resumeEnabled) } catch { /* Resume is optional. */ }
    void flush()
    const nextSource = { ...source, episode, localFile: episode.localFile, url: client.mediaUrl(episode.localFile.path), resumePosition: saved }
    setPanel(null); setCountdown(null); setSource(nextSource); onSourceChange(nextSource)
  }
  const playNext = () => { const next = nextAvailableEpisode(source.queue, source.episode); if (!next?.localFile) { setCountdown(null); return }; void openEpisode(next) }

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (panel) { if (event.keyCode === RemoteKey.Back) { event.preventDefault(); setPanel(parentPanel(panel)); setFocus("PLAYER_PLAY") }; return }
      if (!overlay && (event.keyCode === RemoteKey.Left || event.keyCode === RemoteKey.Right)) {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
        seek(event.keyCode === RemoteKey.Left ? -settings.seekStepSeconds : settings.seekStepSeconds, false); return
      }
      if (!overlay && event.keyCode === RemoteKey.Enter) {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
        if (playing) { engineRef.current?.pause(); setPlaying(false); void flush() }
        setOverlay(true); return
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
  useEffect(() => { const visibility = () => { if (document.hidden) void flush() }; document.addEventListener("visibilitychange", visibility); window.addEventListener("beforeunload", flush); return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("beforeunload", flush) } }, [flush])
  useEffect(() => { document.body.classList.add("player-active"); document.documentElement.classList.add("player-active"); return () => { document.body.classList.remove("player-active"); document.documentElement.classList.remove("player-active") } }, [])
  useEffect(() => { if (!overlay || !playing || panel || countdown !== null) return; const timeout = window.setTimeout(() => setOverlay(false), 5_000); return () => clearTimeout(timeout) }, [countdown, overlay, panel, playing])
  useEffect(() => { if (panel) window.setTimeout(() => setFocus("PLAYER_MODAL_FIRST"), 0) }, [panel])
  useEffect(() => {
    if (panel !== "diagnostics" || !engineRef.current) return
    const update = () => setRuntimeBandwidth(engineRef.current?.getBandwidthBitsPerSecond() ?? null)
    update(); const interval = window.setInterval(update, 1_000); return () => window.clearInterval(interval)
  }, [panel])
  useEffect(() => { if (error) window.setTimeout(() => setFocus("PLAYER_ERROR_BACK"), 0) }, [error])
  useEffect(() => { if (overlay && !error && !panel) window.setTimeout(() => setFocus("PLAYER_PLAY"), 0) }, [error, overlay, panel])

  const chooseTrack = (track: TrackDescriptor) => {
    const saved = storage.getTrackState() as TrackState
    const preference = { language: track.language, title: track.title }
    storage.setTrackState({ ...saved, [track.type === "AUDIO" ? "audio" : "subtitle"]: preference, ...(track.type === "TEXT" ? { subtitlesOff: false } : {}) })
    if (track.type === "TEXT" && track.source === "server") void loadSubtitle(track).catch(reason => {
      setSubtitleRenderer("off")
      setSubtitleStatus(`Subtitle load failed · ${reason instanceof Error ? reason.message : String(reason)}`)
    })
    else { engineRef.current?.selectTrack(track.type, track.index); if (track.type === "TEXT") { setSubtitleCues([]); engineRef.current?.setSubtitlesEnabled(true); setSubtitleRenderer("avplay") } }
    setPanel(null)
  }
  const subtitlesOff = () => {
    activeSubtitleTrackRef.current = null
    engineRef.current?.setSubtitlesEnabled(false); setSubtitleCues([]); setNativeSubtitle(""); setSubtitleRenderer("off"); setSubtitleStatus("Subtitles disabled")
    storage.setTrackState({ ...(storage.getTrackState() as TrackState), subtitlesOff: true }); setPanel(null)
  }
  const testConnection = () => {
    setTestingNetwork(true); setNetworkTest("Testing…")
    void client.measureMediaSpeed(source.url).then(result => { setNetworkTest(`${result.megabitsPerSecond.toFixed(1)} Mbps`); setTestingNetwork(false) }, reason => { setNetworkTest(reason instanceof Error ? reason.message : String(reason)); setTestingNetwork(false) })
  }
  const updateSettings = (partial: Partial<PlayerSettings>) => {
    const next = { ...settingsRef.current, ...partial }
    settingsRef.current = next
    onSettings(next)
  }
  const setAssRenderer = (enabled: boolean) => {
    updateSettings({ subtitleUseAssStyles: enabled })
    const track = activeSubtitleTrackRef.current
    if (track) void loadSubtitle(track).catch(reason => {
      setSubtitleRenderer("off")
      setSubtitleStatus(`Subtitle reload failed · ${reason instanceof Error ? reason.message : String(reason)}`)
    })
  }
  const percent = duration > 0 ? Math.min(100, time / duration * 100) : 0
  const video = mediaContainer?.mediaInfo?.video
  const viewport = videoViewport(video?.width || 1920, video?.height || 1080)

  return <FocusContext.Provider value={focusKey}><div ref={ref} className="player-screen" onMouseMove={() => setOverlay(true)}>
    {engineName === "FFmpeg + Samsung WASM Player" ? <video id="wasm-video" className="video-surface" /> : <object id="av-player" className="video-surface" type="application/avplayer" aria-label="Video playback surface" />}
    <canvas ref={assCanvasRef} className={`ass-canvas ${subtitleRenderer === "libass" ? "active" : ""}`} style={{ left: viewport.x, top: viewport.y, width: viewport.width, height: viewport.height }} />
    {subtitleRenderer === "text" && subtitle && <div className="subtitle" style={{ fontSize: `${Math.round(42 * settings.subtitleFontScale / 100)}px`, bottom: `${settings.subtitleBottomPercent}%` }}>{subtitle}</div>}
    {buffering !== null && <div className="player-state"><div className="spinner" /><strong>Buffering {buffering}%</strong></div>}
    {error && <div className="player-error"><h2>Unable to play this file</h2><p>{error}</p><Focusable focusKey="PLAYER_ERROR_BACK" onEnter={exit}>Back to episodes</Focusable></div>}
    {overlay && !error && <div className="player-overlay"><div className="player-top"><div><strong>{source.media.title?.userPreferred || source.media.title?.english || source.media.title?.romaji}</strong><small>{source.episode.displayTitle} · {source.episode.episodeTitle}</small></div><Focusable onEnter={exit}>✕ Close</Focusable></div>
      <div className="player-bottom"><div className="timeline">{engine?.exactBufferedRanges && bufferedRanges.map(range => <i key={`${range.start}-${range.end}`} className="timeline-buffered" style={{ left: `${range.start / duration * 100}%`, width: `${(range.end - range.start) / duration * 100}%` }} />)}<div className="timeline-fill" style={{ width: `${percent}%` }} /></div><div className="time-row"><span>{formatTime(time)}</span><span>{formatTime(duration)}</span></div>
        <div className="player-actions"><Focusable onEnter={() => seek(-settings.seekStepSeconds)}>↶ {settings.seekStepSeconds}s</Focusable><Focusable focusKey="PLAYER_PLAY" className="play-control" onEnter={togglePlay}>{playing ? "Ⅱ" : "▶"}</Focusable><Focusable onEnter={() => seek(settings.seekStepSeconds)}>{settings.seekStepSeconds}s ↷</Focusable><Focusable onEnter={() => setPanel("audio")}>♫ Audio</Focusable><Focusable onEnter={() => setPanel("subtitle")}>CC Subtitles</Focusable><Focusable onEnter={() => setPanel("episodes")}>☷ Episodes</Focusable><Focusable onEnter={() => setPanel("diagnostics")}>ⓘ Stream</Focusable></div>
      </div></div>}
    {countdown !== null && <div className="next-countdown"><strong>Next episode in {countdown}</strong><div><Focusable onEnter={() => setCountdown(null)}>Cancel</Focusable><Focusable className="primary" onEnter={playNext}>Play now</Focusable></div></div>}
    {panel && <FocusBoundary><div className="modal-backdrop"><div className="track-panel"><h2>{panel === "audio" ? "Audio tracks" : panel === "subtitle" ? "Subtitles" : panel === "subtitleAppearance" ? "Subtitle appearance" : panel === "playbackSettings" ? "Playback buffering" : panel === "diagnostics" ? "Stream diagnostics" : "Episodes"}</h2>
      {panel === "subtitle" && <><Focusable focusKey="PLAYER_MODAL_FIRST" onEnter={subtitlesOff}>Off</Focusable><Focusable onEnter={() => setPanel("subtitleAppearance")}>Appearance<small>ASS style, size, position, and renderer quality</small></Focusable></>}
      {panel === "subtitleAppearance" ? <div className="appearance-panel">
        <Focusable focusKey="PLAYER_MODAL_FIRST" className={settings.subtitleUseAssStyles ? "selected" : ""} onEnter={() => setAssRenderer(!settings.subtitleUseAssStyles)}>ASS/libass renderer: {settings.subtitleUseAssStyles ? "On" : "Off"}<small>On preserves authored fonts, positioning, signs, and karaoke. Off uses simple TV text subtitles.</small></Focusable>
        <Stepper label="Override scale" value={settings.subtitleFontScale} unit="%" minimum={50} maximum={200} step={10} disabled={settings.subtitleUseAssStyles} onChange={value => updateSettings({ subtitleFontScale: value })} />
        <Stepper label="Bottom offset" value={settings.subtitleBottomPercent} unit="%" minimum={0} maximum={30} step={1} disabled={settings.subtitleUseAssStyles} onChange={value => updateSettings({ subtitleBottomPercent: value })} />
        {(["performance", "balanced", "quality"] as const).map(quality => <Focusable key={quality} className={settings.subtitleQuality === quality ? "selected" : ""} onEnter={() => updateSettings({ subtitleQuality: quality })}>{quality}</Focusable>)}
      </div> : panel === "playbackSettings" ? <div className="appearance-panel">
        <p className="panel-note">AVPlay applies these thresholds the next time an episode starts. They do not control a retained cache.</p>
        <Stepper focusKey="PLAYER_MODAL_FIRST" label="Initial playable buffer" value={settings.avplayInitialBufferSeconds} unit="s" minimum={4} maximum={120} step={1} onChange={value => updateSettings({ avplayInitialBufferSeconds: value })} />
        <Stepper label="Recovery playable buffer" value={settings.avplayRecoveryBufferSeconds} unit="s" minimum={4} maximum={120} step={1} onChange={value => updateSettings({ avplayRecoveryBufferSeconds: value })} />
        <Stepper label="Buffering timeout" value={settings.avplayBufferTimeoutSeconds} unit="s" minimum={3} maximum={120} step={1} onChange={value => updateSettings({ avplayBufferTimeoutSeconds: value })} />
      </div> : panel === "diagnostics" ? <div className="diagnostics-panel"><dl>
        <Diagnostic label="Engine" value={engineName} /><Diagnostic label="State" value={engine?.state ?? "Unavailable"} /><Diagnostic label="Fallback" value={fallbackReason ?? "None"} />
        <Diagnostic label="AVPlay startup / recovery" value={`${settings.avplayInitialBufferSeconds}s / ${settings.avplayRecoveryBufferSeconds}s`} /><Diagnostic label="Exact buffered ranges" value={engine?.exactBufferedRanges ? `${bufferedRanges.length}` : "Unavailable from AVPlay"} />
        <Diagnostic label="Runtime bandwidth" value={runtimeBandwidth ? formatBitrate(runtimeBandwidth) : "Not reported for this stream"} /><Diagnostic label="TV-to-server test" value={networkTest} />
        <Diagnostic label="Container" value={mediaContainer?.mediaInfo?.container || mediaContainer?.mediaInfo?.extension || "Unknown"} /><Diagnostic label="Video" value={formatVideo(mediaContainer)} />
        <Diagnostic label="Source bitrate" value={video?.bitrate ? formatBitrate(video.bitrate) : "Unknown"} /><Diagnostic label="File size" value={mediaContainer?.mediaInfo?.size ? formatBytes(mediaContainer.mediaInfo.size) : "Unknown"} />
        <Diagnostic label="Audio" value={mediaContainer?.mediaInfo?.audios?.map(audio => `${audio.codec.toUpperCase()} ${audio.channels}ch ${audio.language || ""}`).join(", ") || "Unknown"} /><Diagnostic label="Subtitle renderer" value={subtitleRenderer} /><Diagnostic label="Subtitle status" value={subtitleStatus} />
        <Diagnostic label="Available / total RAM" value={`${formatOptionalBytes(resources.availableMemoryBytes)} / ${formatOptionalBytes(resources.totalMemoryBytes)}`} /><Diagnostic label="Available / total storage" value={`${formatOptionalBytes(resources.availableStorageBytes)} / ${formatOptionalBytes(resources.totalStorageBytes)}`} />
        <Diagnostic label="Experimental cache" value={`${formatBytes(cachePolicy.hotRamBytes)} active hot RAM · disk tier not enabled`} />
      </dl><Focusable focusKey="PLAYER_MODAL_FIRST" onEnter={() => setPanel("playbackSettings")}>Playback buffering settings<small>Initial, recovery, and timeout thresholds</small></Focusable><Focusable disabled={testingNetwork} onEnter={testConnection}>{testingNetwork ? "Testing connection…" : "Test TV-to-server speed"}</Focusable></div>
      : panel === "episodes" ? source.queue.map((episode, index) => <Focusable focusKey={index === 0 ? "PLAYER_MODAL_FIRST" : undefined} key={`${episode.type}-${episode.episodeNumber}`} disabled={!episode.localFile} onEnter={() => void openEpisode(episode)}>{episode.displayTitle}<small>{episode.localFile ? episode.episodeTitle : "Unavailable on server"}</small></Focusable>)
      : tracks.filter(track => track.type === (panel === "audio" ? "AUDIO" : "TEXT")).map((track, index) => <Focusable focusKey={panel === "audio" && index === 0 ? "PLAYER_MODAL_FIRST" : undefined} key={`${track.source ?? "avplay"}-${track.type}-${track.index}`} onEnter={() => chooseTrack(track)}>{track.title}<small>{track.language}{track.codec ? ` · ${track.codec}` : ""}</small></Focusable>)}
      <Focusable className="modal-close" onEnter={() => setPanel(parentPanel(panel))}>Close</Focusable>
    </div></div></FocusBoundary>}
  </div></FocusContext.Provider>
}

function FocusBoundary({ children }: { children: ReactNode }) { const { ref, focusKey } = useFocusable({ focusKey: "PLAYER_MODAL", trackChildren: true, isFocusBoundary: true }); return <FocusContext.Provider value={focusKey}><div ref={ref}>{children}</div></FocusContext.Provider> }
function Diagnostic({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div> }
function Stepper({ label, value, unit, minimum, maximum, step, disabled, focusKey, onChange }: { label: string; value: number; unit: string; minimum: number; maximum: number; step: number; disabled?: boolean; focusKey?: string; onChange: (value: number) => void }) { return <div className={`panel-stepper ${disabled ? "disabled" : ""}`}><strong>{label}: {value}{unit}</strong><div><Focusable focusKey={focusKey && value > minimum ? focusKey : undefined} disabled={disabled || value <= minimum} onEnter={() => onChange(Math.max(minimum, value - step))}>−</Focusable><Focusable focusKey={focusKey && value <= minimum ? focusKey : undefined} disabled={disabled || value >= maximum} onEnter={() => onChange(Math.min(maximum, value + step))}>+</Focusable></div></div> }
function parentPanel(panel: Panel): Panel { return panel === "subtitleAppearance" ? "subtitle" : panel === "playbackSettings" ? "diagnostics" : null }
function formatTime(seconds: number) { if (!Number.isFinite(seconds)) return "0:00"; const total = Math.max(0, Math.round(seconds)); const h = Math.floor(total / 3600); const m = Math.floor(total % 3600 / 60); const s = total % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}` }
function formatBitrate(bitsPerSecond: number) { return bitsPerSecond >= 1_000_000 ? `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bitsPerSecond / 1_000)} Kbps` }
function formatBytes(bytes: number) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${Math.round(bytes / 1024 ** 2)} MiB` }
function formatOptionalBytes(bytes: number | null) { return bytes === null ? "Not reported" : formatBytes(bytes) }
function formatVideo(container: MediaContainer | null) { const video = container?.mediaInfo?.video; return video ? `${video.codec.toUpperCase()} · ${video.width}×${video.height} · ${video.pixFmt}` : "Unknown" }
