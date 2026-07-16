import { AvPlayAdapter } from "./avplay-adapter"
import { DEFAULT_SETTINGS } from "../domain/settings"

function mockAvPlay() {
  let listener: AVPlayListener = {}
  return {
    open: vi.fn(), close: vi.fn(), prepareAsync: vi.fn((success: () => void) => success()), play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
    seekTo: vi.fn((_ms: number, success?: () => void) => success?.()), jumpForward: vi.fn(), jumpBackward: vi.fn(), getDuration: vi.fn(() => 1000), getCurrentTime: vi.fn(() => 100), getState: vi.fn(() => "PLAYING"),
    getTotalTrackInfo: vi.fn(() => [{ type: "AUDIO", index: 2, extra_info: '{"language":"jpn","title":"Main"}' }]), setSelectTrack: vi.fn(), setSilentSubtitle: vi.fn(), setListener: vi.fn((value: AVPlayListener) => { listener = value }), setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(), setBufferingParam: vi.fn(), setTimeoutForBuffering: vi.fn(),
    getCurrentStreamInfo: vi.fn(() => []), getStreamingProperty: vi.fn(() => "12000000"), emitTime: () => listener.oncurrentplaytime?.(500), emitComplete: () => listener.onstreamcompleted?.(),
  }
}

it("wraps AVPlay state, tracks, seeking, and events", async () => {
  const avplay = mockAvPlay(); const adapter = new AvPlayAdapter(avplay)
  const events: string[] = []; adapter.subscribe(event => events.push(event.type))
  adapter.load("http://video", DEFAULT_SETTINGS); await adapter.prepare(); adapter.play(); adapter.seekBy(-10_000); avplay.emitTime(); avplay.emitComplete()
  expect(avplay.open).toHaveBeenCalledWith("http://video")
  expect(avplay.setBufferingParam).toHaveBeenNthCalledWith(1, "PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", 15)
  expect(avplay.setBufferingParam).toHaveBeenNthCalledWith(2, "PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 30)
  expect(avplay.setTimeoutForBuffering).toHaveBeenCalledWith(30)
  expect(avplay.jumpBackward).toHaveBeenCalledWith(10_000)
  expect(adapter.getTracks()[0]).toMatchObject({ index: 2, language: "jpn", title: "Main" })
  expect(events).toEqual(["time", "complete"])
  adapter.stop(); expect(avplay.close).toHaveBeenCalled()
})

it("exposes AVPlay bandwidth when the firmware provides it", () => {
  const adapter = new AvPlayAdapter(mockAvPlay())
  expect(adapter.getBandwidthBitsPerSecond()).toBe(12_000_000)
})

it("applies manual buffering thresholds before prepare", () => {
  const avplay = mockAvPlay(); const adapter = new AvPlayAdapter(avplay)
  adapter.load("http://video", { ...DEFAULT_SETTINGS, avplayInitialBufferSeconds: 4, avplayRecoveryBufferSeconds: 8, avplayBufferTimeoutSeconds: 9 })
  expect(avplay.setBufferingParam).toHaveBeenNthCalledWith(1, "PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", 4)
  expect(avplay.setBufferingParam).toHaveBeenNthCalledWith(2, "PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 8)
  expect(avplay.setTimeoutForBuffering).toHaveBeenCalledWith(9)
})

it("waits for AVPlay to enter the requested lifecycle state", async () => {
  const avplay = mockAvPlay()
  avplay.getState.mockReturnValueOnce("READY").mockReturnValue("PLAYING")
  const adapter = new AvPlayAdapter(avplay)
  await expect(adapter.waitForState("PLAYING", 250)).resolves.toBeUndefined()
  expect(avplay.getState).toHaveBeenCalledTimes(2)
})
