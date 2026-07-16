import { DEFAULT_SETTINGS } from "./settings"
import { effectiveCachePolicy, mergeCacheExtents, selectLruEvictions } from "./cache"

it("caps automatic cache to 85 percent of currently available storage", () => {
  const policy = effectiveCachePolicy(DEFAULT_SETTINGS, {
    totalMemoryBytes: 1024 ** 3,
    availableMemoryBytes: 512 * 1024 ** 2,
    totalStorageBytes: 8 * 1024 ** 3,
    availableStorageBytes: 400 * 1024 ** 2,
  })
  expect(policy.diskBytes).toBe(Math.floor(400 * 1024 ** 2 * 0.85))
  expect(policy.hotRamBytes).toBe(64 * 1024 ** 2)
  expect(policy.limitedByStorage).toBe(true)
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
