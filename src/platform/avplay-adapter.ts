import { parseAvPlayTracks } from "../domain/tracks"
import type { PlayerSettings } from "../domain/settings"
import type { TrackDescriptor, TrackType } from "../domain/types"
import type { PlaybackEngine, PlaybackEngineEvent } from "./playback-engine"

export type AvPlayEvent = PlaybackEngineEvent

export class AvPlayAdapter implements PlaybackEngine {
  readonly name = "Samsung AVPlay" as const
  readonly exactBufferedRanges = false
  private avplay: SamsungAVPlay
  private listeners = new Set<(event: AvPlayEvent) => void>()
  private opened = false

  constructor(avplay = window.webapis?.avplay) {
    if (!avplay) throw new Error("Samsung AVPlay is unavailable. Run this application on a Samsung TV.")
    this.avplay = avplay
    this.avplay.setListener({
      onbufferingstart: () => this.emit({ type: "buffering", percent: 0 }),
      onbufferingprogress: percent => this.emit({ type: "buffering", percent }),
      onbufferingcomplete: () => this.emit({ type: "buffering", percent: 100 }),
      oncurrentplaytime: milliseconds => this.emit({ type: "time", milliseconds }),
      onstreamcompleted: () => this.emit({ type: "complete" }),
      onerror: type => this.emit({ type: "error", message: friendlyAvPlayError(type) }),
      onerrormsg: (type, message) => this.emit({ type: "error", message: friendlyAvPlayError(`${type}: ${message}`) }),
      onsubtitlechange: (duration, text) => this.emit({ type: "subtitle", duration, text }),
    })
  }

  subscribe(listener: (event: AvPlayEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(event: AvPlayEvent) { this.listeners.forEach(listener => listener(event)) }

  load(url: string, settings: PlayerSettings) {
    if (this.opened) this.stop()
    this.avplay.open(url)
    this.configureBuffering(settings)
    this.avplay.setDisplayRect(0, 0, 1920, 1080)
    this.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_FULL_SCREEN")
    this.opened = true
  }
  private configureBuffering(settings: PlayerSettings) {
    // AVPlay owns this transient buffer; this is not a persistent file cache.
    // These must be set in IDLE, after open() and before prepareAsync().
    try { this.avplay.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", settings.avplayInitialBufferSeconds) } catch { /* Older firmware may use its default. */ }
    try { this.avplay.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", settings.avplayRecoveryBufferSeconds) } catch { /* Older firmware may use its default. */ }
    try { this.avplay.setTimeoutForBuffering(settings.avplayBufferTimeoutSeconds) } catch { /* Preserve firmware default if unsupported. */ }
  }
  prepare() { return new Promise<void>((resolve, reject) => this.avplay.prepareAsync(resolve, error => reject(new Error(friendlyAvPlayError(String(error)))))) }
  play() { this.avplay.play() }
  pause() { this.avplay.pause() }
  seek(milliseconds: number) { return new Promise<void>((resolve, reject) => this.avplay.seekTo(Math.max(0, milliseconds), resolve, reject)) }
  seekBy(milliseconds: number) { milliseconds >= 0 ? this.avplay.jumpForward(milliseconds) : this.avplay.jumpBackward(Math.abs(milliseconds)) }
  stop() { try { this.avplay.stop() } catch { /* already stopped */ } try { this.avplay.close() } catch { /* already closed */ } this.opened = false }
  get duration() { return this.avplay.getDuration() }
  get currentTime() { return this.avplay.getCurrentTime() }
  get state() { return this.avplay.getState() }
  waitForState(expected: string, timeoutMilliseconds = 2_000) {
    return new Promise<void>((resolve, reject) => {
      const startedAt = Date.now()
      const check = () => {
        if (this.state === expected) { resolve(); return }
        if (Date.now() - startedAt >= timeoutMilliseconds) {
          reject(new Error(`AVPlay did not enter ${expected} state (current state: ${this.state}).`))
          return
        }
        window.setTimeout(check, 25)
      }
      check()
    })
  }
  getTracks(): TrackDescriptor[] { return parseAvPlayTracks(this.avplay.getTotalTrackInfo()) }
  getCurrentTracks(): TrackDescriptor[] { try { return parseAvPlayTracks(this.avplay.getCurrentStreamInfo?.() ?? []) } catch { return [] } }
  getBandwidthBitsPerSecond(): number | null {
    try {
      const value = Number(this.avplay.getStreamingProperty?.("CURRENT_BANDWIDTH"))
      return Number.isFinite(value) && value > 0 ? value : null
    } catch { return null }
  }
  getBufferedRanges() { return [] }
  selectTrack(type: TrackType, index: number) { this.avplay.setSelectTrack(type, index) }
  setSubtitlesEnabled(enabled: boolean) { this.avplay.setSilentSubtitle(!enabled) }
}

export function friendlyAvPlayError(code: string) {
  const normalized = code.toLocaleLowerCase()
  if (normalized.includes("unsupported") || normalized.includes("not_supported")) return "This container or codec is not supported by this TV. Seanime TV does not transcode files."
  if (normalized.includes("network") || normalized.includes("connection")) return "The connection to the Seanime server was lost."
  if (normalized.includes("invalid_state")) return "The TV player entered an unexpected state. Return to the episode and try again."
  return `Playback error: ${code}`
}
