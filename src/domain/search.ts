import type { LibraryEntry } from "./types"

function normalize(value: string) { return value.toLocaleLowerCase().trim().replace(/\s+/g, " ") }

export function searchableTitles(entry: LibraryEntry) {
  const media = entry.media
  return [media?.title?.userPreferred, media?.title?.english, media?.title?.romaji, media?.title?.native, ...(media?.synonyms ?? [])]
    .filter((value): value is string => Boolean(value?.trim()))
}

export function titleFor(entry: LibraryEntry) {
  const title = entry.media?.title
  return title?.userPreferred || title?.english || title?.romaji || title?.native || `Anime ${entry.mediaId}`
}

export function rankSearch(entries: LibraryEntry[], query: string, limit = 8) {
  const needle = normalize(query)
  if (!needle) return entries.slice(0, limit)
  return entries.map((entry, originalIndex) => {
    let best = Number.POSITIVE_INFINITY
    for (const rawTitle of searchableTitles(entry)) {
      const title = normalize(rawTitle)
      const score = title === needle ? 0
        : title.startsWith(needle) ? 100 + title.length
        : title.split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(needle)) ? 200 + title.indexOf(needle)
        : title.includes(needle) ? 300 + title.indexOf(needle)
        : Number.POSITIVE_INFINITY
      best = Math.min(best, score)
    }
    return { entry, score: best, originalIndex }
  }).filter(item => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || titleFor(a.entry).localeCompare(titleFor(b.entry)) || a.originalIndex - b.originalIndex)
    .slice(0, limit).map(item => item.entry)
}
