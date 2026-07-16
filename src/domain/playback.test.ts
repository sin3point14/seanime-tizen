import { isComplete, nextAvailableEpisode, resumePosition, shouldOfferAutoNext } from "./playback"
import type { Episode, WatchHistoryItem } from "./types"

const item = (currentTime: number): WatchHistoryItem => ({ currentTime, duration: 100, mediaId: 1, episodeNumber: 1, filepath: "x", kind: "mediastream" })
const episode = (number: number, local = true): Episode => ({ type: "main", displayTitle: `${number}`, episodeTitle: "", episodeNumber: number, absoluteEpisodeNumber: number, progressNumber: number, isDownloaded: false, isInvalid: false, localFile: local ? { path: `${number}`, name: `${number}`, mediaId: 1 } : undefined })

it("resumes only from 2% through 90%", () => {
  expect(resumePosition(item(1))).toBe(0); expect(resumePosition(item(2))).toBe(2); expect(resumePosition(item(90))).toBe(90); expect(resumePosition(item(91))).toBe(0)
})
it("marks completion and gates next episode", () => {
  expect(isComplete(85, 100)).toBe(true)
  expect(shouldOfferAutoNext(98, 100)).toBe(true)
  expect(nextAvailableEpisode([episode(1), episode(2, false)], episode(1))).toBeUndefined()
  expect(nextAvailableEpisode([episode(1), episode(2)], episode(1))?.episodeNumber).toBe(2)
})
