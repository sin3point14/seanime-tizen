import { DEFAULT_SETTINGS, migrateSettings } from "./settings"

it("migrates invalid and legacy settings safely", () => {
  expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS)
  expect(migrateSettings({ seekStep: 200, resumeEnabled: false })).toMatchObject({ version: 2, seekStepSeconds: 60, resumeEnabled: false })
  expect(migrateSettings({ preferredAudio: "jpn" })).toMatchObject({ preferredAudio: DEFAULT_SETTINGS.preferredAudio })
  expect(migrateSettings({ bufferPolicy: "invalid", subtitleFontSize: 200, subtitleBottomPercent: 1 })).toMatchObject({ bufferPolicy: "stable", subtitleFontSize: 60, subtitleBottomPercent: 5 })
})
