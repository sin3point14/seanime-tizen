interface AVPlayTrackInfo { type: string; index: number; extra_info: string }
interface AVPlayListener {
  onbufferingstart?: () => void
  onbufferingprogress?: (percent: number) => void
  onbufferingcomplete?: () => void
  oncurrentplaytime?: (milliseconds: number) => void
  onstreamcompleted?: () => void
  onerror?: (eventType: string) => void
  onerrormsg?: (eventType: string, errorMessage: string) => void
  onevent?: (eventType: string, eventData: string) => void
  onsubtitlechange?: (duration: number, text: string) => void
  ondrmevent?: (eventType: string, eventData: string) => void
}
interface SamsungAVPlay {
  open(url: string): void
  close(): void
  prepareAsync(success: () => void, error: (error: unknown) => void): void
  play(): void
  pause(): void
  stop(): void
  seekTo(milliseconds: number, success?: () => void, error?: (error: unknown) => void): void
  jumpForward(milliseconds: number): void
  jumpBackward(milliseconds: number): void
  getDuration(): number
  getCurrentTime(): number
  getState(): string
  getTotalTrackInfo(): AVPlayTrackInfo[]
  getCurrentStreamInfo?(): AVPlayTrackInfo[]
  getStreamingProperty?(property: "CURRENT_BANDWIDTH"): string
  setSelectTrack(type: "AUDIO" | "TEXT", index: number): void
  setSilentSubtitle(enabled: boolean): void
  setListener(listener: AVPlayListener): void
  setDisplayRect(x: number, y: number, width: number, height: number): void
  setDisplayMethod(method: string): void
  setTimeoutForBuffering(seconds: number): void
  setBufferingParam(option: "PLAYER_BUFFER_FOR_PLAY" | "PLAYER_BUFFER_FOR_RESUME", unit: "PLAYER_BUFFER_SIZE_IN_SECOND", amount: number): void
}
interface Window {
  webapis?: { avplay: SamsungAVPlay }
  tizen?: {
    tvinputdevice?: { registerKey(key: string): void; registerKeyBatch?(keys: string[], success?: () => void, error?: () => void): void }
    application?: { getCurrentApplication(): { exit(): void } }
    systeminfo?: {
      getTotalMemory(): number
      getAvailableMemory(): number
      getPropertyValue(property: "STORAGE", success: (value: { units?: Array<{ type?: string; capacity?: number; availableCapacity?: number }> }) => void, error?: (error: unknown) => void): void
    }
  }
}
