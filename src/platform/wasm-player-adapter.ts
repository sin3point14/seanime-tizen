import type { EffectiveCachePolicy } from "../domain/cache"
import type { PlayerSettings } from "../domain/settings"
import type { MediaContainer, TrackDescriptor, TrackType } from "../domain/types"
import type { BufferedRange, CacheStatus, PlaybackEngine, PlaybackEngineEvent } from "./playback-engine"

export interface WasmPlayerBridge {
  onEvent(listener: (event: PlaybackEngineEvent) => void): () => void
  open(url: string, cache: EffectiveCachePolicy, media: MediaContainer): void
  prepare(): Promise<void>
  play(): void
  pause(): void
  seek(milliseconds: number): Promise<void>
  stop(): Promise<void>
  duration(): number
  currentTime(): number
  state(): string
  tracks(): TrackDescriptor[]
  currentTracks(): TrackDescriptor[]
  bandwidth(): number | null
  buffered(): BufferedRange[]
  cacheStatus(): CacheStatus
  selectTrack(type: TrackType, index: number): void
  setSubtitlesEnabled(enabled: boolean): void
}

export class WasmPlayerAdapter implements PlaybackEngine {
  readonly name = "FFmpeg + Samsung WASM Player" as const
  readonly exactBufferedRanges = true
  constructor(private bridge: WasmPlayerBridge, private cache: EffectiveCachePolicy, private media: MediaContainer) {}
  subscribe(listener: (event: PlaybackEngineEvent) => void) { return this.bridge.onEvent(listener) }
  load(url: string, _settings: PlayerSettings) { this.bridge.open(url, this.cache, this.media) }
  prepare() { return this.bridge.prepare() }
  play() { this.bridge.play() }
  pause() { this.bridge.pause() }
  seek(milliseconds: number) { return this.bridge.seek(milliseconds) }
  stop() { return this.bridge.stop() }
  get duration() { return this.bridge.duration() }
  get currentTime() { return this.bridge.currentTime() }
  get state() { return this.bridge.state() }
  getTracks() { return this.bridge.tracks() }
  getCurrentTracks() { return this.bridge.currentTracks() }
  getBandwidthBitsPerSecond() { return this.bridge.bandwidth() }
  getBufferedRanges() { return this.bridge.buffered() }
  getCacheStatus() { return this.bridge.cacheStatus() }
  selectTrack(type: TrackType, index: number) { this.bridge.selectTrack(type, index) }
  setSubtitlesEnabled(enabled: boolean) { this.bridge.setSubtitlesEnabled(enabled) }
}

declare global {
  interface Window {
    SeanimeWasmPlayer?: { create(): WasmPlayerBridge }
  }
}
