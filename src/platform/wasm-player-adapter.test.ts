import { WasmPlayerAdapter, type WasmPlayerBridge } from "./wasm-player-adapter"
import type { MediaContainer } from "../domain/types"

it("exposes exact platform buffered ranges for the WASM timeline", () => {
  const bridge: WasmPlayerBridge = {
    onEvent: () => () => undefined, open: vi.fn(), prepare: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(), stop: vi.fn(async () => undefined),
    duration: () => 60_000, currentTime: () => 10_000, state: () => "PLAYING", tracks: () => [], currentTracks: () => [], bandwidth: () => null,
    buffered: () => [{ start: 8, end: 14 }, { start: 30, end: 34 }], cacheStatus: () => ({ usedBytes: 48, capacityBytes: 128, sourceBytes: 256, byteRanges: [{ start: 0, end: 48 }] }), selectTrack: vi.fn(), setSubtitlesEnabled: vi.fn(),
  }
  const media = { filePath: "x", hash: "x", streamType: "direct", streamUrl: "x" } as MediaContainer
  const adapter = new WasmPlayerAdapter(bridge, { hotRamBytes: 64, forwardBytes: 64, backBytes: 64, seconds: 60, forwardSeconds: 48, backSeconds: 12, requestedBytes: 128, diskBytes: 0, minimumFreeBytes: 0, forwardPercent: 80, limitedByMemory: false, warnings: [] }, media)
  expect(adapter.exactBufferedRanges).toBe(true)
  expect(adapter.getBufferedRanges()).toEqual([{ start: 8, end: 14 }, { start: 30, end: 34 }])
  expect(adapter.getCacheStatus()).toEqual({ usedBytes: 48, capacityBytes: 128, sourceBytes: 256, byteRanges: [{ start: 0, end: 48 }] })
})
