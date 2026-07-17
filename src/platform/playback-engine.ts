import type { PlayerSettings } from "../domain/settings"
import type { TrackDescriptor, TrackType } from "../domain/types"

export type PlaybackEngineEvent =
  | { type: "buffering"; percent: number }
  | { type: "time"; milliseconds: number }
  | { type: "complete" }
  | { type: "error"; message: string }
  | { type: "warning"; message: string }
  | { type: "subtitle"; text: string; duration: number }

export interface BufferedRange { start: number; end: number }
export interface CacheStatus { usedBytes: number; capacityBytes: number; sourceBytes: number; byteRanges: BufferedRange[]; timeRanges?: BufferedRange[] }

export interface PlaybackEngine {
  readonly name: "Samsung AVPlay" | "FFmpeg + Samsung WASM Player"
  readonly duration: number
  readonly currentTime: number
  readonly state: string
  readonly exactBufferedRanges: boolean
  subscribe(listener: (event: PlaybackEngineEvent) => void): () => void
  load(url: string, settings: PlayerSettings): void
  prepare(): Promise<void>
  play(): void
  pause(): void
  seek(milliseconds: number): Promise<void>
  stop(): Promise<void>
  getTracks(): TrackDescriptor[]
  getCurrentTracks(): TrackDescriptor[]
  getBandwidthBitsPerSecond(): number | null
  getBufferedRanges(): BufferedRange[]
  getCacheStatus(): CacheStatus | null
  selectTrack(type: TrackType, index: number): void
  setSubtitlesEnabled(enabled: boolean): void
}
