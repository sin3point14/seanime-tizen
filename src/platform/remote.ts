export const RemoteKey = {
  Left: 37,
  Right: 39,
  Enter: 13,
  Back: 10009,
  Play: 415,
  Pause: 19,
  PlayPause: 10252,
  Stop: 413,
  Rewind: 412,
  FastForward: 417,
} as const

export function registerMediaKeys() {
  const input = window.tizen?.tvinputdevice
  const keys = ["MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop", "MediaRewind", "MediaFastForward"]
  try {
    if (input?.registerKeyBatch) input.registerKeyBatch(keys)
    else keys.forEach(key => input?.registerKey(key))
  } catch { /* Browser/dev mode. */ }
}
