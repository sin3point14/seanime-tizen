import { DEFAULT_SETTINGS } from "../domain/settings"
import type { MediaContainer } from "../domain/types"
import { wasmEligibility } from "./engine-factory"

function media(container: string, codec: string, audio = "aac"): MediaContainer {
  return { filePath: "x", hash: "x", streamType: "direct", streamUrl: "x", mediaInfo: {
    extension: container, container, size: 1, duration: 1,
    video: { codec, quality: "1080p", width: 1920, height: 1080, bitrate: 1, pixFmt: "yuv420p", colorSpace: "", colorTransfer: "", colorPrimaries: "" },
    audios: [{ index: 0, codec: audio, channels: 2 }],
  } }
}

it("allows verified H264/H265 MKV and MP4 combinations", () => {
  expect(wasmEligibility(media("matroska", "hevc")).eligible).toBe(true)
  expect(wasmEligibility(media("mp4", "h264")).eligible).toBe(true)
})

it("rejects unverified containers, codecs, and DTS audio", () => {
  expect(wasmEligibility(media("avi", "h264")).eligible).toBe(false)
  expect(wasmEligibility(media("mkv", "av1")).eligible).toBe(false)
  expect(wasmEligibility(media("mkv", "hevc", "dts")).eligible).toBe(false)
  expect(DEFAULT_SETTINGS.playbackBackend).toBe("avplay")
})
