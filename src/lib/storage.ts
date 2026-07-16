import { DEFAULT_SETTINGS, migrateSettings, type PlayerSettings } from "../domain/settings"

const PREFIX = "seanime-tv:"
const keys = {
  server: `${PREFIX}server`,
  identity: `${PREFIX}identity`,
  settings: `${PREFIX}settings`,
  selectedTracks: `${PREFIX}selected-tracks`,
  recentSearchTitles: `${PREFIX}recent-search-titles`,
}

export interface ServerConfig { url: string; passwordHash: string }
export interface ClientIdentity { clientId: string; proof: string }

function parse<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null } catch { return null }
}

export const storage = {
  getServer: (): ServerConfig | null => parse(keys.server),
  setServer: (value: ServerConfig) => localStorage.setItem(keys.server, JSON.stringify(value)),
  getIdentity: (): ClientIdentity => parse<ClientIdentity>(keys.identity) ?? { clientId: createClientId(), proof: "" },
  setIdentity: (value: ClientIdentity) => localStorage.setItem(keys.identity, JSON.stringify(value)),
  getSettings: (): PlayerSettings => migrateSettings(parse(keys.settings) ?? DEFAULT_SETTINGS),
  setSettings: (value: PlayerSettings) => localStorage.setItem(keys.settings, JSON.stringify(migrateSettings(value))),
  getTrackState: (): Record<string, unknown> => parse(keys.selectedTracks) ?? {},
  setTrackState: (value: Record<string, unknown>) => localStorage.setItem(keys.selectedTracks, JSON.stringify(value)),
  getRecentSearchTitles: (): number[] => (parse<unknown[]>(keys.recentSearchTitles) ?? []).filter(value => typeof value === "number").slice(0, 12) as number[],
  addRecentSearchTitle: (mediaId: number) => {
    const current = (parse<unknown[]>(keys.recentSearchTitles) ?? []).filter(value => typeof value === "number" && value !== mediaId)
    localStorage.setItem(keys.recentSearchTitles, JSON.stringify([mediaId, ...current].slice(0, 12)))
  },
  clearRecentSearchTitles: () => localStorage.removeItem(keys.recentSearchTitles),
  disconnect: () => {
    Object.keys(localStorage).filter(key => key.startsWith(PREFIX)).forEach(key => localStorage.removeItem(key))
  },
}

function createClientId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID()
  if (typeof crypto?.getRandomValues === "function") {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
      (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16))
  }
  return `seanime-tv-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}
