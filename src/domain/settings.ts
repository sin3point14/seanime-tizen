export type PlaybackBackend = "avplay" | "wasm-experimental"
export type CacheMode = "automatic" | "custom"
export type SubtitleQuality = "performance" | "balanced" | "quality"

export interface PlayerSettings {
  version: 3
  resumeEnabled: boolean
  autoplayNext: boolean
  subtitlesEnabled: boolean
  preferredAudio: string[]
  preferredSubtitles: string[]
  seekStepSeconds: number
  playbackBackend: PlaybackBackend
  avplayInitialBufferSeconds: number
  avplayRecoveryBufferSeconds: number
  avplayBufferTimeoutSeconds: number
  subtitleUseAssStyles: boolean
  subtitleFontScale: number
  subtitleBottomPercent: number
  subtitleQuality: SubtitleQuality
  cacheMode: CacheMode
  cacheSecondsEnabled: boolean
  cacheSeconds: number
  cacheBytesEnabled: boolean
  cacheForwardMiB: number
  cacheBackMiB: number
  cacheHotRamMiB: number
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  version: 3,
  resumeEnabled: true,
  autoplayNext: true,
  subtitlesEnabled: true,
  preferredAudio: ["jpn", "ja", "jp", "japanese"],
  preferredSubtitles: ["eng", "en", "english"],
  seekStepSeconds: 10,
  playbackBackend: "avplay",
  avplayInitialBufferSeconds: 15,
  avplayRecoveryBufferSeconds: 30,
  avplayBufferTimeoutSeconds: 30,
  subtitleUseAssStyles: true,
  subtitleFontScale: 100,
  subtitleBottomPercent: 8,
  subtitleQuality: "balanced",
  cacheMode: "automatic",
  cacheSecondsEnabled: true,
  cacheSeconds: 300,
  cacheBytesEnabled: true,
  cacheForwardMiB: 820,
  cacheBackMiB: 204,
  cacheHotRamMiB: 64,
}

type LegacySettings = Partial<PlayerSettings> & {
  seekStep?: number
  bufferPolicy?: "fast" | "balanced" | "stable"
  subtitleFontSize?: number
}

export function migrateSettings(value: unknown): PlayerSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS }
  const input = value as LegacySettings
  const legacyBuffer = input.bufferPolicy === "fast"
    ? { avplayInitialBufferSeconds: 4, avplayRecoveryBufferSeconds: 8 }
    : input.bufferPolicy === "balanced"
      ? { avplayInitialBufferSeconds: 8, avplayRecoveryBufferSeconds: 15 }
      : input.bufferPolicy === "stable"
        ? { avplayInitialBufferSeconds: 15, avplayRecoveryBufferSeconds: 30 }
        : {}
  const legacyScale = typeof input.subtitleFontSize === "number"
    ? Math.round(input.subtitleFontSize / 42 * 100)
    : DEFAULT_SETTINGS.subtitleFontScale
  const secondsEnabled = typeof input.cacheSecondsEnabled === "boolean" ? input.cacheSecondsEnabled : DEFAULT_SETTINGS.cacheSecondsEnabled
  const bytesEnabled = typeof input.cacheBytesEnabled === "boolean" ? input.cacheBytesEnabled : DEFAULT_SETTINGS.cacheBytesEnabled

  return {
    ...DEFAULT_SETTINGS,
    ...legacyBuffer,
    ...input,
    version: 3,
    preferredAudio: strings(input.preferredAudio, DEFAULT_SETTINGS.preferredAudio),
    preferredSubtitles: strings(input.preferredSubtitles, DEFAULT_SETTINGS.preferredSubtitles),
    seekStepSeconds: clamp(input.seekStepSeconds ?? input.seekStep, 5, 60, DEFAULT_SETTINGS.seekStepSeconds),
    playbackBackend: input.playbackBackend === "wasm-experimental" ? input.playbackBackend : "avplay",
    avplayInitialBufferSeconds: clamp(input.avplayInitialBufferSeconds ?? legacyBuffer.avplayInitialBufferSeconds, 4, 120, DEFAULT_SETTINGS.avplayInitialBufferSeconds),
    avplayRecoveryBufferSeconds: clamp(input.avplayRecoveryBufferSeconds ?? legacyBuffer.avplayRecoveryBufferSeconds, 4, 120, DEFAULT_SETTINGS.avplayRecoveryBufferSeconds),
    avplayBufferTimeoutSeconds: clamp(input.avplayBufferTimeoutSeconds, 3, 120, DEFAULT_SETTINGS.avplayBufferTimeoutSeconds),
    subtitleUseAssStyles: typeof input.subtitleUseAssStyles === "boolean" ? input.subtitleUseAssStyles : true,
    subtitleFontScale: clamp(input.subtitleFontScale ?? legacyScale, 50, 200, DEFAULT_SETTINGS.subtitleFontScale),
    subtitleBottomPercent: clamp(input.subtitleBottomPercent, 0, 30, DEFAULT_SETTINGS.subtitleBottomPercent),
    subtitleQuality: input.subtitleQuality === "performance" || input.subtitleQuality === "quality" ? input.subtitleQuality : "balanced",
    cacheMode: input.cacheMode === "custom" ? "custom" : "automatic",
    cacheSecondsEnabled: secondsEnabled || !bytesEnabled,
    cacheSeconds: clamp(input.cacheSeconds, 30, 7200, DEFAULT_SETTINGS.cacheSeconds),
    cacheBytesEnabled: bytesEnabled || !secondsEnabled,
    cacheForwardMiB: clamp(input.cacheForwardMiB, 32, 8192, DEFAULT_SETTINGS.cacheForwardMiB),
    cacheBackMiB: clamp(input.cacheBackMiB, 16, 2048, DEFAULT_SETTINGS.cacheBackMiB),
    cacheHotRamMiB: clamp(input.cacheHotRamMiB, 16, 256, DEFAULT_SETTINGS.cacheHotRamMiB),
  }
}

function strings(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback
}
