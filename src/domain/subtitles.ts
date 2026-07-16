import type { SubtitleCue } from "./types"

export function parseSubtitleFile(content: string, extension = ""): SubtitleCue[] {
  const normalizedExtension = extension.toLocaleLowerCase().replace(/^\./, "")
  if (normalizedExtension === "ass" || normalizedExtension === "ssa" || /^\s*\[Script Info\]/im.test(content)) {
    return parseAss(content)
  }
  return parseSrtOrVtt(content)
}

export function cueAt(cues: SubtitleCue[], seconds: number) {
  // Subtitle files are ordered, and overlapping signs/dialogue are valid.
  // Prefer the latest active cue so ordinary dialogue wins over long-lived signs.
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    const cue = cues[index]
    if (cue.start > seconds) continue
    if (seconds <= cue.end) return cue
  }
  return undefined
}

function parseAss(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  for (const line of content.split(/\r?\n/)) {
    if (!/^Dialogue\s*:/i.test(line)) continue
    const fields = line.slice(line.indexOf(":") + 1).split(",")
    if (fields.length < 10) continue
    const start = parseTimestamp(fields[1])
    const end = parseTimestamp(fields[2])
    const rawText = fields.slice(9).join(",")
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    // ASS vector drawing commands are not dialogue and would otherwise appear
    // as a wall of coordinates after the style tags are removed.
    if (/\\p[1-9]/i.test(rawText)) continue
    const text = cleanText(rawText)
    if (text) cues.push({ start, end, text })
  }
  return cues.sort((left, right) => left.start - right.start)
}

function parseSrtOrVtt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const blocks = content.replace(/^\uFEFF/, "").split(/\r?\n\s*\r?\n/)
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean)
    const timingIndex = lines.findIndex(line => line.includes("-->"))
    if (timingIndex < 0) continue
    const [rawStart, rawEnd] = lines[timingIndex].split("-->")
    const start = parseTimestamp(rawStart)
    const end = parseTimestamp(rawEnd.trim().split(/\s+/)[0])
    const text = cleanText(lines.slice(timingIndex + 1).join("\n"))
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({ start, end, text })
  }
  return cues.sort((left, right) => left.start - right.start)
}

function parseTimestamp(value: string) {
  const parts = value.trim().replace(",", ".").split(":").map(Number)
  if (parts.some(part => !Number.isFinite(part))) return Number.NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number.NaN
}

function cleanText(value: string) {
  return value
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/gi, "\n")
    .replace(/\\h/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim()
}
