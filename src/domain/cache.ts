import type { PlayerSettings } from "./settings"

export interface SystemResources {
  totalMemoryBytes: number | null
  availableMemoryBytes: number | null
  totalStorageBytes: number | null
  availableStorageBytes: number | null
}

export interface EffectiveCachePolicy {
  seconds: number | null
  forwardSeconds: number | null
  backSeconds: number | null
  requestedBytes: number | null
  forwardBytes: number
  backBytes: number
  hotRamBytes: number
  diskBytes: number
  minimumFreeBytes: number
  forwardPercent: number
  limitedByMemory: boolean
  warnings: string[]
}

const MiB = 1024 * 1024
export function effectiveCachePolicy(settings: PlayerSettings, resources: SystemResources): EffectiveCachePolicy {
  const automatic = settings.cacheMode === "automatic"
  const seconds = settings.cacheSecondsEnabled ? (automatic ? 300 : settings.cacheSeconds) : null
  const requestedBytes = settings.cacheBytesEnabled ? (automatic ? 1024 * MiB : settings.cacheTotalMiB * MiB) : null
  const forwardPercent = automatic ? 80 : settings.cacheForwardPercent
  const forwardRatio = forwardPercent / 100
  const forwardBytes = requestedBytes === null ? 0 : Math.round(requestedBytes * forwardRatio)
  const backBytes = requestedBytes === null ? 0 : requestedBytes - forwardBytes
  const forwardSeconds = seconds === null ? null : Math.round(seconds * forwardRatio)
  const backSeconds = seconds === null ? null : seconds - Math.round(seconds * forwardRatio)
  const minimumFreeBytes = settings.cacheMinimumFreeMiB * MiB
  const storageCap = resources.availableStorageBytes === null
    ? (requestedBytes ?? 1024 * MiB)
    : Math.max(0, Math.floor(resources.availableStorageBytes - minimumFreeBytes))
  const diskBytes = requestedBytes === null ? storageCap : Math.min(requestedBytes, storageCap)
  const memoryCap = resources.availableMemoryBytes === null
    ? 256 * MiB
    : Math.floor(resources.availableMemoryBytes * 0.25)
  const desiredRamBytes = requestedBytes ?? 256 * MiB
  const hotRamBytes = Math.min(desiredRamBytes, 256 * MiB, memoryCap)
  const warnings: string[] = []
  if (resources.availableStorageBytes !== null && resources.availableStorageBytes < minimumFreeBytes) {
    warnings.push(`Only ${formatBytes(resources.availableStorageBytes)} is free, below the configured ${formatBytes(minimumFreeBytes)} safety margin. Disk caching will be disabled until space is available.`)
  } else if (requestedBytes !== null && diskBytes < requestedBytes) {
    warnings.push(`The requested ${formatBytes(requestedBytes)} disk cache was reduced to ${formatBytes(diskBytes)} to preserve the configured free-space margin.`)
  }
  if (hotRamBytes < 16 * MiB) warnings.push("Available memory is too low for the configured hot cache.")
  if (requestedBytes !== null && hotRamBytes < requestedBytes) warnings.push("Only the hottest segments stay in RAM; the remainder can stay in temporary session storage.")
  return {
    seconds,
    forwardSeconds,
    backSeconds,
    requestedBytes,
    forwardBytes,
    backBytes,
    hotRamBytes,
    diskBytes,
    minimumFreeBytes,
    forwardPercent,
    limitedByMemory: requestedBytes !== null && hotRamBytes < requestedBytes,
    warnings,
  }
}

function formatBytes(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${Math.round(bytes / MiB)} MiB`
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
