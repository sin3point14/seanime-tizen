type DiagnosticData = Record<string, unknown> | undefined

declare const __DIAGNOSTICS__: boolean
declare const __DIAGNOSTIC_ENDPOINT__: string

interface DiagnosticEntry {
  at: string
  level: "info" | "warn" | "error"
  event: string
  data?: Record<string, unknown>
}

const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const enabled = typeof __DIAGNOSTICS__ !== "undefined" && __DIAGNOSTICS__
const endpoint = typeof __DIAGNOSTIC_ENDPOINT__ !== "undefined" ? __DIAGNOSTIC_ENDPOINT__ : ""
const queue: DiagnosticEntry[] = []
let timer: number | null = null

export function diagnosticsEnabled() { return enabled }

export function diagnostic(event: string, data?: DiagnosticData, level: DiagnosticEntry["level"] = "info") {
  if (!enabled) return
  const entry: DiagnosticEntry = { at: new Date().toISOString(), level, event, data: sanitize(data) }
  console[level](`[SeanimeTV] ${event}`, entry.data ?? "")
  queue.push(entry)
  if (queue.length > 300) queue.shift()
  scheduleFlush()
}

export function installDiagnostics() {
  if (!enabled) return
  diagnostic("app.boot", {
    userAgent: navigator.userAgent,
    href: location.href,
    wasm: typeof WebAssembly !== "undefined",
    workers: typeof Worker !== "undefined",
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  })
  window.addEventListener("error", event => diagnostic("window.error", {
    message: event.message, filename: event.filename, line: event.lineno, column: event.colno,
    error: errorDetails(event.error),
  }, "error"))
  window.addEventListener("unhandledrejection", event => diagnostic("window.unhandledrejection", { reason: errorDetails(event.reason) }, "error"))
  window.addEventListener("seanime:wasm-log", ((event: CustomEvent) => diagnostic("wasm.bridge", sanitize(event.detail))) as EventListener)
  window.addEventListener("beforeunload", flushDiagnostics)
  const buffered = (window as typeof window & { SeanimeWasmDiagnostics?: unknown[] }).SeanimeWasmDiagnostics
  if (buffered?.length) diagnostic("wasm.buffered-events", { events: buffered })
}

export function flushDiagnostics() {
  if (!enabled || !endpoint || !queue.length) return
  if (timer !== null) window.clearTimeout(timer)
  timer = null
  const entries = queue.splice(0)
  const payload = JSON.stringify({ session, entries })
  if (navigator.sendBeacon?.(endpoint, new Blob([payload], { type: "application/json" }))) return
  void fetch(endpoint, { method: "POST", body: payload, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {
    queue.unshift(...entries.slice(-100))
  })
}

function scheduleFlush() {
  if (!endpoint || timer !== null) return
  timer = window.setTimeout(flushDiagnostics, 250)
}

function sanitize(data: unknown): Record<string, unknown> | undefined {
  if (data === undefined) return undefined
  try { return JSON.parse(JSON.stringify(data, (_key, value) => typeof value === "string" ? redact(value) : value)) as Record<string, unknown> }
  catch { return { value: String(data) } }
}

function redact(value: string) {
  return value
    .replace(/([?&]token=)[^&]+/gi, "$1[redacted]")
    .replace(/(X-Seanime-Token[\"']?\s*[:=]\s*[\"']?)[a-f0-9]{32,}/gi, "$1[redacted]")
}

function errorDetails(reason: unknown) {
  if (reason instanceof Error) return { name: reason.name, message: reason.message, stack: reason.stack }
  return sanitize(reason) ?? { value: String(reason) }
}
