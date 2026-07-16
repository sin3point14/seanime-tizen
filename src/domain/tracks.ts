import type { TrackDescriptor, TrackPreference } from "./types"

export function normalizeTrackValue(value?: string) {
  return (value ?? "").toLocaleLowerCase().trim().replace(/[_-]/g, " ").replace(/\s+/g, " ")
}

export function selectTrack(tracks: TrackDescriptor[], previous: TrackPreference | undefined, defaults: string[]) {
  if (!tracks.length) return undefined
  const normalized = tracks.map(track => ({ track, language: normalizeTrackValue(track.language), title: normalizeTrackValue(track.title) }))
  if (previous) {
    const language = normalizeTrackValue(previous.language)
    const title = normalizeTrackValue(previous.title)
    const exact = normalized.find(item => item.language === language && item.title === title)
    if (exact) return exact.track
    const sameLanguage = normalized.find(item => item.language === language)
    if (sameLanguage) return sameLanguage.track
  }
  for (const preference of defaults.map(normalizeTrackValue)) {
    const match = normalized.find(item => item.language === preference || item.language.includes(preference) || item.title.includes(preference))
    if (match) return match.track
  }
  return tracks[0]
}

export function parseAvPlayTracks(rawTracks: unknown[]): TrackDescriptor[] {
  const result: TrackDescriptor[] = []
  rawTracks.forEach((raw: unknown, index: number) => {
    const track = raw as { type?: string; index?: number; extra_info?: string }
    if (track.type !== "AUDIO" && track.type !== "TEXT") return
    let info: Record<string, unknown> = {}
    try { info = track.extra_info ? JSON.parse(track.extra_info) as Record<string, unknown> : {} } catch { /* Samsung sometimes returns invalid metadata. */ }
    result.push({
      index: typeof track.index === "number" ? track.index : index,
      type: track.type,
      language: String(info.language ?? info.lang ?? info.track_lang ?? "unknown"),
      title: String(info.title ?? info.track_name ?? `${track.type === "AUDIO" ? "Audio" : "Subtitle"} ${index + 1}`),
      codec: typeof info.codec === "string" ? info.codec : undefined,
      raw,
    })
  })
  return result
}
