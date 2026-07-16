import { effectiveCachePolicy, type SystemResources } from "../domain/cache"
import type { PlayerSettings } from "../domain/settings"
import type { MediaContainer } from "../domain/types"
import { AvPlayAdapter } from "./avplay-adapter"
import type { PlaybackEngine } from "./playback-engine"
import { WasmPlayerAdapter } from "./wasm-player-adapter"

export interface EngineSelection { engine: PlaybackEngine; fallbackReason: string | null }

export function createPlaybackEngine(settings: PlayerSettings, media: MediaContainer | null, resources: SystemResources): EngineSelection {
  if (settings.playbackBackend !== "wasm-experimental") return { engine: new AvPlayAdapter(), fallbackReason: null }
  const eligibility = wasmEligibility(media)
  if (!eligibility.eligible) return { engine: new AvPlayAdapter(), fallbackReason: eligibility.reason }
  if (!window.SeanimeWasmPlayer) {
    return { engine: new AvPlayAdapter(), fallbackReason: "Experimental WASM module is not installed in this build." }
  }
  const cache = effectiveCachePolicy(settings, resources)
  if (cache.warnings.some(warning => warning.includes("Insufficient") || warning.includes("too low"))) {
    return { engine: new AvPlayAdapter(), fallbackReason: cache.warnings.join(" ") }
  }
  try { return { engine: new WasmPlayerAdapter(window.SeanimeWasmPlayer.create(), cache, media!), fallbackReason: null } }
  catch (reason) {
    return { engine: new AvPlayAdapter(), fallbackReason: `WASM initialization failed: ${reason instanceof Error ? reason.message : String(reason)}` }
  }
}

export function wasmEligibility(media: MediaContainer | null): { eligible: boolean; reason: string } {
  if (!media?.mediaInfo) return { eligible: false, reason: "Media metadata is unavailable for experimental playback." }
  const container = (media.mediaInfo.container || media.mediaInfo.extension || "").toLocaleLowerCase()
  if (!["mkv", "matroska", "mp4", "mov"].some(value => container.includes(value))) {
    return { eligible: false, reason: `Container ${container || "unknown"} has not been verified with the experimental player.` }
  }
  const codec = (media.mediaInfo.video?.codec || "").toLocaleLowerCase()
  if (!/^(h264|avc|avc1|hevc|h265|hev1|hvc1)$/.test(codec)) {
    return { eligible: false, reason: `Video codec ${codec || "unknown"} is not in the verified hardware-decoder set.` }
  }
  const unsupportedAudio = media.mediaInfo.audios?.find(audio => /^(dts|truehd)$/.test(audio.codec.toLocaleLowerCase()))
  if (unsupportedAudio) return { eligible: false, reason: `${unsupportedAudio.codec.toUpperCase()} audio is unsupported on this 2025 Samsung TV.` }
  return { eligible: true, reason: "" }
}
