import { DEFAULT_SETTINGS, migrateSettings } from "./settings"

it("migrates invalid and legacy settings safely", () => {
  expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS)
  expect(migrateSettings({ seekStep: 200, resumeEnabled: false })).toMatchObject({ version: 3, seekStepSeconds: 60, resumeEnabled: false })
  expect(migrateSettings({ preferredAudio: "jpn" })).toMatchObject({ preferredAudio: DEFAULT_SETTINGS.preferredAudio })
  expect(migrateSettings({ bufferPolicy: "invalid", subtitleFontSize: 200, subtitleBottomPercent: -1 })).toMatchObject({ subtitleFontScale: 200, subtitleBottomPercent: 0, playbackBackend: "avplay" })
  expect(migrateSettings({ bufferPolicy: "fast" })).toMatchObject({ avplayInitialBufferSeconds: 4, avplayRecoveryBufferSeconds: 8 })
  expect(migrateSettings({ cacheSecondsEnabled: false, cacheBytesEnabled: false })).toMatchObject({ cacheSecondsEnabled: true, cacheBytesEnabled: true })
})
