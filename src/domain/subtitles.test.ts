import { cueAt, parseSubtitleFile } from "./subtitles"

it("parses embedded ASS dialogue and removes styling", () => {
  const cues = parseSubtitleFile(`[Script Info]\n[Events]\nDialogue: 0,0:00:01.25,0:00:03.50,Default,,0,0,0,,{\\an8}Hello\\Nworld\nDialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\p1}m 0 0 l 1 1`, "ass")
  expect(cues).toEqual([{ start: 1.25, end: 3.5, text: "Hello\nworld" }])
  expect(cueAt(cues, 2)?.text).toBe("Hello\nworld")
  expect(cueAt(cues, 4)).toBeUndefined()
})

it("parses SRT and WebVTT-style timestamps", () => {
  const cues = parseSubtitleFile(`1\n00:00:01,000 --> 00:00:02,500\n<i>First</i>\n\n00:03.000 --> 00:04.000 align:center\nSecond`, "vtt")
  expect(cues.map(cue => cue.text)).toEqual(["First", "Second"])
})

it("keeps an earlier overlapping cue visible after a shorter cue ends", () => {
  expect(cueAt([
    { start: 0, end: 10, text: "long" },
    { start: 1, end: 2, text: "short" },
  ], 3)?.text).toBe("long")
})
