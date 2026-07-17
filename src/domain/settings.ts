export type PlaybackBackend = "avplay" | "wasm-experimental"
export type CacheMode = "automatic" | "custom"
export type CacheTimelineDisplay = "playable" | "network-cache"
export type SubtitleQuality = "performance" | "balanced" | "quality"

export interface PlayerSettings {
  version: 6
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
  cacheTotalMiB: number
  cacheForwardPercent: number
  cacheMinimumFreeMiB: number
  cacheTimelineDisplay: CacheTimelineDisplay
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  version: 6,
  resumeEnabled: true,
  autoplayNext: true,
  subtitlesEnabled: true,
  preferredAudio: ["jpn", "ja", "jp", "japanese"],
  preferredSubtitles: ["eng", "en", "english"],
  seekStepSeconds: 10,
  playbackBackend: "wasm-experimental",
  avplayInitialBufferSeconds: 15,
  avplayRecoveryBufferSeconds: 30,
  avplayBufferTimeoutSeconds: 30,
  subtitleUseAssStyles: true,
  subtitleFontScale: 100,
  subtitleBottomPercent: 8,
  subtitleQuality: "balanced",
  cacheMode: "custom",
  cacheSecondsEnabled: true,
  cacheSeconds: 300,
  cacheBytesEnabled: true,
  cacheTotalMiB: 1024,
  cacheForwardPercent: 80,
  cacheMinimumFreeMiB: 1024,
  cacheTimelineDisplay: "network-cache",
}

type LegacySettings = Partial<PlayerSettings> & {
  seekStep?: number
  bufferPolicy?: "fast" | "balanced" | "stable"
  subtitleFontSize?: number
  cacheForwardMiB?: number
  cacheBackMiB?: number
  cacheHotRamMiB?: number
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
  const legacyForwardMiB = clamp(input.cacheForwardMiB, 0, 8192, 0)
  const legacyBackMiB = clamp(input.cacheBackMiB, 0, 8192, 0)
  const legacyTotalMiB = legacyForwardMiB + legacyBackMiB
  const migratedForwardPercent = legacyTotalMiB > 0 ? Math.round(legacyForwardMiB / legacyTotalMiB * 100) : DEFAULT_SETTINGS.cacheForwardPercent

  return {
    ...DEFAULT_SETTINGS,
    ...legacyBuffer,
    ...input,
    version: 6,
    preferredAudio: strings(input.preferredAudio, DEFAULT_SETTINGS.preferredAudio),
    preferredSubtitles: strings(input.preferredSubtitles, DEFAULT_SETTINGS.preferredSubtitles),
    seekStepSeconds: clamp(input.seekStepSeconds ?? input.seekStep, 5, 60, DEFAULT_SETTINGS.seekStepSeconds),
    playbackBackend: input.playbackBackend === "wasm-experimental" || input.playbackBackend === "avplay" ? input.playbackBackend : DEFAULT_SETTINGS.playbackBackend,
    avplayInitialBufferSeconds: clamp(input.avplayInitialBufferSeconds ?? legacyBuffer.avplayInitialBufferSeconds, 4, 120, DEFAULT_SETTINGS.avplayInitialBufferSeconds),
    avplayRecoveryBufferSeconds: clamp(input.avplayRecoveryBufferSeconds ?? legacyBuffer.avplayRecoveryBufferSeconds, 4, 120, DEFAULT_SETTINGS.avplayRecoveryBufferSeconds),
    avplayBufferTimeoutSeconds: clamp(input.avplayBufferTimeoutSeconds, 3, 120, DEFAULT_SETTINGS.avplayBufferTimeoutSeconds),
    subtitleUseAssStyles: typeof input.subtitleUseAssStyles === "boolean" ? input.subtitleUseAssStyles : true,
    subtitleFontScale: clamp(input.subtitleFontScale ?? legacyScale, 50, 200, DEFAULT_SETTINGS.subtitleFontScale),
    subtitleBottomPercent: clamp(input.subtitleBottomPercent, 0, 30, DEFAULT_SETTINGS.subtitleBottomPercent),
    subtitleQuality: input.subtitleQuality === "performance" || input.subtitleQuality === "quality" ? input.subtitleQuality : "balanced",
    cacheMode: input.cacheMode === "custom" || input.cacheMode === "automatic" ? input.cacheMode : DEFAULT_SETTINGS.cacheMode,
    cacheSecondsEnabled: secondsEnabled || !bytesEnabled,
    cacheSeconds: clamp(input.cacheSeconds, 30, 7200, DEFAULT_SETTINGS.cacheSeconds),
    cacheBytesEnabled: bytesEnabled || !secondsEnabled,
    cacheTotalMiB: clamp(input.cacheTotalMiB ?? (legacyTotalMiB || undefined), 32, 10240, DEFAULT_SETTINGS.cacheTotalMiB),
    cacheForwardPercent: clamp(input.cacheForwardPercent ?? migratedForwardPercent, 0, 100, DEFAULT_SETTINGS.cacheForwardPercent),
    cacheMinimumFreeMiB: clamp(input.cacheMinimumFreeMiB, 0, 10240, DEFAULT_SETTINGS.cacheMinimumFreeMiB),
    cacheTimelineDisplay: input.cacheTimelineDisplay === "network-cache" || input.cacheTimelineDisplay === "playable" ? input.cacheTimelineDisplay : DEFAULT_SETTINGS.cacheTimelineDisplay,
  }
}

function strings(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback
}
