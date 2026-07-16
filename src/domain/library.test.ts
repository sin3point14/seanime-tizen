import { localContinueWatching, localEntries } from "./library"
import type { LibraryCollection } from "./types"

it("filters all library surfaces to server-local files", () => {
  const collection: LibraryCollection = {
    lists: [{ entries: [
      { mediaId: 1, libraryData: { mainFileCount: 2, unwatchedCount: 1, sharedPath: "x" } },
      { mediaId: 2 },
    ] }],
    continueWatchingList: [
      { type: "main", displayTitle: "1", episodeTitle: "", episodeNumber: 1, absoluteEpisodeNumber: 1, progressNumber: 1, isDownloaded: false, isInvalid: false, localFile: { path: "a.mkv", name: "a", mediaId: 1 } },
      { type: "main", displayTitle: "2", episodeTitle: "", episodeNumber: 2, absoluteEpisodeNumber: 2, progressNumber: 2, isDownloaded: false, isInvalid: false },
    ],
  }
  expect(localEntries(collection).map(entry => entry.mediaId)).toEqual([1])
  expect(localContinueWatching(collection)).toHaveLength(1)
})
