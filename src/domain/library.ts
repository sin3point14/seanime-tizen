import type { Episode, LibraryCollection, LibraryEntry } from "./types"

export function hasLocalFiles(entry: LibraryEntry) {
  // Seanime only hydrates libraryData when at least one matched local file exists.
  // mainFileCount may still be zero for special/non-credit-only entries.
  return Boolean(entry.libraryData)
}

export function localEntries(collection: LibraryCollection): LibraryEntry[] {
  const seen = new Set<number>()
  const entries: LibraryEntry[] = []
  for (const list of collection.lists ?? []) {
    for (const entry of list.entries ?? []) {
      if (hasLocalFiles(entry) && !seen.has(entry.mediaId)) {
        seen.add(entry.mediaId)
        entries.push(entry)
      }
    }
  }
  return entries
}

export function localContinueWatching(collection: LibraryCollection) {
  return (collection.continueWatchingList ?? []).filter(episode => Boolean(episode.localFile?.path))
}

export function availableEpisode(episode: Episode) {
  return Boolean(episode.localFile?.path)
}
