import type { SystemResources } from "../domain/cache"

export async function getSystemResources(): Promise<SystemResources> {
  const systeminfo = window.tizen?.systeminfo
  if (!systeminfo) return emptyResources()
  const memory = await new Promise<{ total: number | null; available: number | null }>(resolve => {
    try {
      resolve({ total: finite(systeminfo.getTotalMemory()), available: finite(systeminfo.getAvailableMemory()) })
    } catch { resolve({ total: null, available: null }) }
  })
  const storage = await new Promise<{ total: number | null; available: number | null }>(resolve => {
    try {
      systeminfo.getPropertyValue("STORAGE", value => {
        const units = Array.isArray(value.units) ? value.units : []
        const internal = units.filter(unit => unit.type === "INTERNAL")
        const candidates = internal.length ? internal : units
        resolve({
          total: sum(candidates.map(unit => unit.capacity)),
          available: sum(candidates.map(unit => unit.availableCapacity)),
        })
      }, () => resolve({ total: null, available: null }))
    } catch { resolve({ total: null, available: null }) }
  })
  return {
    totalMemoryBytes: memory.total,
    availableMemoryBytes: memory.available,
    totalStorageBytes: storage.total,
    availableStorageBytes: storage.available,
  }
}

export function emptyResources(): SystemResources {
  return { totalMemoryBytes: null, availableMemoryBytes: null, totalStorageBytes: null, availableStorageBytes: null }
}

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function sum(values: unknown[]) {
  const numbers = values.map(finite).filter((value): value is number => value !== null)
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null
}
