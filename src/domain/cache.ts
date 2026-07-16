import type { PlayerSettings } from "./settings"

export interface SystemResources {
  totalMemoryBytes: number | null
  availableMemoryBytes: number | null
  totalStorageBytes: number | null
  availableStorageBytes: number | null
}

export interface EffectiveCachePolicy {
  seconds: number | null
  forwardBytes: number
  backBytes: number
  hotRamBytes: number
  diskBytes: number
  limitedByStorage: boolean
  warnings: string[]
}

const MiB = 1024 * 1024
const GiB = 1024 * MiB

export function effectiveCachePolicy(settings: PlayerSettings, resources: SystemResources): EffectiveCachePolicy {
  const automatic = settings.cacheMode === "automatic"
  const requestedForward = automatic ? Math.round(0.8 * GiB) : settings.cacheForwardMiB * MiB
  const requestedBack = automatic ? Math.round(0.2 * GiB) : settings.cacheBackMiB * MiB
  const requestedDisk = requestedForward + requestedBack
  const storageCap = resources.availableStorageBytes === null
    ? requestedDisk
    : Math.max(0, Math.floor(resources.availableStorageBytes * 0.85))
  const effectiveDisk = Math.min(requestedDisk, storageCap)
  const ratio = requestedDisk > 0 ? effectiveDisk / requestedDisk : 0
  const backBytes = Math.min(Math.floor(requestedBack * ratio), Math.max(0, effectiveDisk - 32 * MiB))
  const forwardBytes = Math.max(0, effectiveDisk - backBytes)
  const memoryCap = resources.availableMemoryBytes === null
    ? 256 * MiB
    : Math.floor(resources.availableMemoryBytes * 0.25)
  const hotRamBytes = Math.min(settings.cacheHotRamMiB * MiB, 256 * MiB, memoryCap)
  const warnings: string[] = []
  if (effectiveDisk < requestedDisk) warnings.push("Cache reduced to protect currently available temporary storage.")
  if (forwardBytes < 32 * MiB || backBytes < 16 * MiB) warnings.push("Insufficient temporary storage for the configured minimum cache.")
  if (hotRamBytes < 16 * MiB) warnings.push("Available memory is too low for the configured hot cache.")
  return {
    seconds: settings.cacheSecondsEnabled ? (automatic ? 300 : settings.cacheSeconds) : null,
    forwardBytes,
    backBytes,
    hotRamBytes,
    diskBytes: effectiveDisk,
    limitedByStorage: effectiveDisk < requestedDisk,
    warnings,
  }
}

export interface CacheExtent { start: number; end: number; lastUsed: number; protected?: boolean }

export function mergeCacheExtents(extents: CacheExtent[], next: CacheExtent): CacheExtent[] {
  const ordered = [...extents, next].sort((left, right) => left.start - right.start)
  const merged: CacheExtent[] = []
  for (const extent of ordered) {
    const previous = merged[merged.length - 1]
    if (previous && extent.start <= previous.end) {
      previous.end = Math.max(previous.end, extent.end)
      previous.lastUsed = Math.max(previous.lastUsed, extent.lastUsed)
      previous.protected ||= extent.protected
    } else merged.push({ ...extent })
  }
  return merged
}

export function selectLruEvictions(extents: CacheExtent[], bytesToFree: number) {
  let freed = 0
  const selected: CacheExtent[] = []
  for (const extent of [...extents].filter(item => !item.protected).sort((left, right) => left.lastUsed - right.lastUsed)) {
    if (freed >= bytesToFree) break
    selected.push(extent)
    freed += Math.max(0, extent.end - extent.start)
  }
  return selected
}
