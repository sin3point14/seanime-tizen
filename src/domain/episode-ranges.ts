export interface EpisodeRange {
  index: number
  start: number
  end: number
}

export function episodeRanges(count: number, size = 50): EpisodeRange[] {
  if (count <= size || size <= 0) return []
  return Array.from({ length: Math.ceil(count / size) }, (_, index) => ({
    index,
    start: index * size + 1,
    end: Math.min(count, (index + 1) * size),
  }))
}
