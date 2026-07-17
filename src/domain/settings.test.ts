import { DEFAULT_SETTINGS, migrateSettings } from "./settings"

it("migrates invalid and legacy settings safely", () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ playbackBackend: "wasm-experimental", cacheMode: "custom", cacheSeconds: 300, cacheTotalMiB: 1024, cacheForwardPercent: 80, cacheTimelineDisplay: "network-cache" })
  expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS)
  expect(migrateSettings({ seekStep: 200, resumeEnabled: false })).toMatchObject({ version: 6, seekStepSeconds: 60, resumeEnabled: false, cacheMinimumFreeMiB: 1024, cacheTimelineDisplay: "network-cache" })
  expect(migrateSettings({ preferredAudio: "jpn" })).toMatchObject({ preferredAudio: DEFAULT_SETTINGS.preferredAudio })
  expect(migrateSettings({ bufferPolicy: "invalid", subtitleFontSize: 200, subtitleBottomPercent: -1 })).toMatchObject({ subtitleFontScale: 200, subtitleBottomPercent: 0, playbackBackend: "wasm-experimental" })
  expect(migrateSettings({ bufferPolicy: "fast" })).toMatchObject({ avplayInitialBufferSeconds: 4, avplayRecoveryBufferSeconds: 8 })
  expect(migrateSettings({ cacheSecondsEnabled: false, cacheBytesEnabled: false })).toMatchObject({ cacheSecondsEnabled: true, cacheBytesEnabled: true })
  expect(migrateSettings({ cacheForwardMiB: 200, cacheBackMiB: 100 })).toMatchObject({ cacheTotalMiB: 300, cacheForwardPercent: 67 })
})
