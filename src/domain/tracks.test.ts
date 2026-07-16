import { selectTrack } from "./tracks"
import type { TrackDescriptor } from "./types"

const tracks: TrackDescriptor[] = [
  { index: 1, type: "AUDIO", language: "eng", title: "Stereo", raw: {} },
  { index: 2, type: "AUDIO", language: "jpn", title: "Main", raw: {} },
  { index: 3, type: "AUDIO", language: "jpn", title: "Commentary", raw: {} },
]
it("matches language and title, then language, then defaults", () => {
  expect(selectTrack(tracks, { language: "JPN", title: "Commentary" }, ["eng"])?.index).toBe(3)
  expect(selectTrack(tracks, { language: "jpn", title: "missing" }, ["eng"])?.index).toBe(2)
  expect(selectTrack(tracks, undefined, ["ja", "eng"])?.index).toBe(1)
})
