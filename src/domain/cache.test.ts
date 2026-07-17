import { DEFAULT_SETTINGS } from "./settings"
import { effectiveCachePolicy, mergeCacheExtents, selectLruEvictions } from "./cache"

it("splits a total cache policy and caps the active RAM tier", () => {
  const policy = effectiveCachePolicy(DEFAULT_SETTINGS, {
    totalMemoryBytes: 1024 ** 3,
    availableMemoryBytes: 512 * 1024 ** 2,
    totalStorageBytes: 8 * 1024 ** 3,
    availableStorageBytes: 400 * 1024 ** 2,
  })
  expect(policy.requestedBytes).toBe(1024 * 1024 ** 2)
  expect(policy.forwardBytes).toBeCloseTo(819.2 * 1024 ** 2, -5)
  expect(policy.backBytes).toBeCloseTo(204.8 * 1024 ** 2, -5)
  expect(policy.hotRamBytes).toBe(128 * 1024 ** 2)
  expect(policy.diskBytes).toBe(0)
  expect(policy.minimumFreeBytes).toBe(1024 ** 3)
  expect(policy.warnings[0]).toContain("below the configured")
  expect(policy.limitedByMemory).toBe(true)
  expect(policy.forwardSeconds).toBe(240)
  expect(policy.backSeconds).toBe(60)
})

it("uses available storage above the configurable free-space margin", () => {
  const settings = { ...DEFAULT_SETTINGS, cacheMinimumFreeMiB: 256 }
  const policy = effectiveCachePolicy(settings, {
    totalMemoryBytes: null,
    availableMemoryBytes: null,
    totalStorageBytes: 2 * 1024 ** 3,
    availableStorageBytes: 800 * 1024 ** 2,
  })
  expect(policy.diskBytes).toBe(544 * 1024 ** 2)
  expect(policy.warnings[0]).toContain("reduced")
})

it("retains disjoint cache extents and merges touching ranges", () => {
  const extents = mergeCacheExtents([{ start: 0, end: 100, lastUsed: 1 }], { start: 200, end: 300, lastUsed: 2 })
  expect(extents).toHaveLength(2)
  expect(mergeCacheExtents(extents, { start: 90, end: 220, lastUsed: 3 })).toEqual([{ start: 0, end: 300, lastUsed: 3 }])
})

it("evicts least-recently-used unprotected extents", () => {
  const extents = [
    { start: 0, end: 50, lastUsed: 1 },
    { start: 50, end: 100, lastUsed: 0, protected: true },
    { start: 100, end: 200, lastUsed: 2 },
  ]
  expect(selectLruEvictions(extents, 60)).toEqual([extents[0], extents[2]])
})
