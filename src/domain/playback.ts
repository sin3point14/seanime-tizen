import type { Episode, WatchHistoryItem } from "./types"

export function resumePosition(item: WatchHistoryItem | undefined, enabled = true) {
  if (!enabled || !item || item.duration <= 0) return 0
  const ratio = item.currentTime / item.duration
  return ratio >= 0.02 && ratio <= 0.9 ? item.currentTime : 0
}

export function isComplete(currentTime: number, duration: number, streamComplete = false) {
  return streamComplete || (duration > 0 && currentTime / duration >= 0.85)
}

export function shouldOfferAutoNext(currentTime: number, duration: number) {
  if (duration <= 0) return false
  return currentTime / duration >= 0.97 && duration - currentTime <= 4
}

export function nextAvailableEpisode(queue: Episode[], current: Episode) {
  const index = queue.findIndex(ep => ep.episodeNumber === current.episodeNumber && ep.type === current.type)
  const next = index >= 0 ? queue[index + 1] : undefined
  return next?.localFile?.path ? next : undefined
}
