export type BufferPolicy = "fast" | "balanced" | "stable"

export interface PlayerSettings {
  version: 2
  resumeEnabled: boolean
  autoplayNext: boolean
  subtitlesEnabled: boolean
  preferredAudio: string[]
  preferredSubtitles: string[]
  seekStepSeconds: number
  bufferPolicy: BufferPolicy
  subtitleFontSize: number
  subtitleBottomPercent: number
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  version: 2,
  resumeEnabled: true,
  autoplayNext: true,
  subtitlesEnabled: true,
  preferredAudio: ["jpn", "ja", "jp", "japanese"],
  preferredSubtitles: ["eng", "en", "english"],
  seekStepSeconds: 10,
  bufferPolicy: "stable",
  subtitleFontSize: 42,
  subtitleBottomPercent: 8,
}

export function migrateSettings(value: unknown): PlayerSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS }
  const input = value as Partial<PlayerSettings> & { seekStep?: number }
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    version: 2,
    preferredAudio: Array.isArray(input.preferredAudio) ? input.preferredAudio.filter(v => typeof v === "string") : DEFAULT_SETTINGS.preferredAudio,
    preferredSubtitles: Array.isArray(input.preferredSubtitles) ? input.preferredSubtitles.filter(v => typeof v === "string") : DEFAULT_SETTINGS.preferredSubtitles,
    seekStepSeconds: clampSeek(input.seekStepSeconds ?? input.seekStep ?? DEFAULT_SETTINGS.seekStepSeconds),
    bufferPolicy: input.bufferPolicy === "fast" || input.bufferPolicy === "balanced" || input.bufferPolicy === "stable" ? input.bufferPolicy : DEFAULT_SETTINGS.bufferPolicy,
    subtitleFontSize: clamp(input.subtitleFontSize, 28, 60, DEFAULT_SETTINGS.subtitleFontSize),
    subtitleBottomPercent: clamp(input.subtitleBottomPercent, 5, 25, DEFAULT_SETTINGS.subtitleBottomPercent),
  }
}

function clampSeek(value: number) {
  return Number.isFinite(value) ? Math.min(60, Math.max(5, Math.round(value))) : DEFAULT_SETTINGS.seekStepSeconds
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback
}
