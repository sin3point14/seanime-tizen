import type { AnimeEntry, LibraryCollection, MediaContainer, WatchHistory, WatchHistoryItem } from "../domain/types"
import { createMediaToken } from "./auth"
import { storage, type ClientIdentity, type ServerConfig } from "../lib/storage"

interface SeaEnvelope<T> { data?: T; error?: string }

export class SeanimeError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = "SeanimeError" }
}

export class SeanimeClient {
  constructor(private config: ServerConfig) {}

  setConfig(config: ServerConfig) { this.config = config }
  getConfig() { return this.config }

  private headers() {
    const identity = storage.getIdentity()
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-Seanime-Client-Platform": "web" }
    if (this.config.passwordHash) headers["X-Seanime-Token"] = this.config.passwordHash
    if (identity.clientId && identity.proof) {
      headers["X-Seanime-Client-Id"] = identity.clientId
      headers["X-Seanime-Client-Id-Proof"] = identity.proof
    }
    return headers
  }

  private captureIdentity(headers: Headers) {
    const clientId = headers.get("X-Seanime-Client-Id")?.trim()
    const proof = headers.get("X-Seanime-Client-Id-Proof")?.trim()
    if (clientId) storage.setIdentity({ clientId, proof: proof ?? "" })
  }

  async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${normalizeUrl(this.config.url)}${endpoint}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    })
    this.captureIdentity(response.headers)
    const text = await response.text()
    let envelope: SeaEnvelope<T> = {}
    try { envelope = text ? JSON.parse(text) as SeaEnvelope<T> : {} } catch {
      if (response.ok) return text as T
    }
    if (!response.ok || envelope.error) throw new SeanimeError(envelope.error || `Request failed (${response.status})`, response.status)
    return envelope.data as T
  }

  async requestText(endpoint: string): Promise<string> {
    const response = await fetch(`${normalizeUrl(this.config.url)}${endpoint}`, { headers: this.headers() })
    this.captureIdentity(response.headers)
    if (!response.ok) throw new SeanimeError(`Request failed (${response.status})`, response.status)
    return response.text()
  }

  async validate() {
    await this.request<unknown>("/api/v1/status")
    await this.request<unknown>("/api/v1/settings")
  }

  getLibrary(refresh = false) { return this.request<LibraryCollection>("/api/v1/library/collection", { method: refresh ? "POST" : "GET" }) }
  getAnimeEntry(id: number) { return this.request<AnimeEntry>(`/api/v1/library/anime-entry/${id}`) }
  getHistory() { return this.request<WatchHistory>("/api/v1/continuity/history") }
  getHistoryItem(id: number) { return this.request<{ item?: WatchHistoryItem; found: boolean }>(`/api/v1/continuity/item/${id}`) }

  getMediaContainer(path: string) {
    const identity = storage.getIdentity()
    return this.request<MediaContainer>("/api/v1/mediastream/request", {
      method: "POST",
      body: JSON.stringify({ path, streamType: "direct", audioStreamIndex: 0, clientId: identity.clientId }),
    })
  }

  getExtractedSubtitle(link: string) {
    return this.requestText(`/api/v1/mediastream/subs/${link.replace(/^\/+/, "")}`)
  }

  async measureMediaSpeed(url: string, sampleBytes = 4 * 1024 * 1024) {
    const controller = new AbortController()
    const started = performance.now()
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body?.getReader) throw new SeanimeError("Connection test is unavailable on this TV.", response.status)
    const reader = response.body.getReader()
    let bytes = 0
    try {
      while (bytes < sampleBytes) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
      }
    } finally {
      controller.abort()
      void reader.cancel().catch(() => undefined)
    }
    const seconds = Math.max(0.001, (performance.now() - started) / 1000)
    return { megabitsPerSecond: bytes * 8 / seconds / 1_000_000, bytes, seconds }
  }

  updateContinuity(item: Omit<WatchHistoryItem, "timeUpdated">) {
    return this.request<void>("/api/v1/continuity/item", { method: "PATCH", body: JSON.stringify({ options: item }) })
  }

  startTracking(mediaId: number, episodeNumber: number) {
    const identity = storage.getIdentity()
    return this.request<boolean>("/api/v1/playback-manager/manual-tracking/start", {
      method: "POST", body: JSON.stringify({ mediaId, episodeNumber, clientId: identity.clientId }),
    })
  }

  cancelTracking() { return this.request<void>("/api/v1/playback-manager/manual-tracking/cancel", { method: "POST" }) }

  updateProgress(mediaId: number, episodeNumber: number, totalEpisodes: number) {
    return this.request<void>("/api/v1/library/anime-entry/update-progress", {
      method: "POST", body: JSON.stringify({ mediaId, episodeNumber, totalEpisodes }),
    })
  }

  mediaUrl(path: string) {
    const endpoint = "/api/v1/mediastream/file"
    const token = this.config.passwordHash ? `&token=${encodeURIComponent(createMediaToken(this.config.passwordHash, endpoint))}` : ""
    return `${normalizeUrl(this.config.url)}${endpoint}?path=${encodeURIComponent(path)}${token}`
  }

  disconnect() { storage.disconnect() }
}

export function normalizeUrl(url: string) {
  let value = url.trim().replace(/\/+$/, "")
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  return value
}

export type { ClientIdentity }
