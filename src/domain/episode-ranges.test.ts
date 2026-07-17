import { episodeRanges } from "./episode-ranges"

it("does not paginate a short episode list", () => {
  expect(episodeRanges(50)).toEqual([])
})

it("creates bounded fifty-episode ranges", () => {
  expect(episodeRanges(123)).toEqual([
    { index: 0, start: 1, end: 50 },
    { index: 1, start: 51, end: 100 },
    { index: 2, start: 101, end: 123 },
  ])
})
