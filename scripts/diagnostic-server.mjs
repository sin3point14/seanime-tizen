import { createServer } from "node:http"
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

const port = Number(process.env.SEANIME_DIAGNOSTIC_PORT || 8765)
const output = resolve(process.env.SEANIME_DIAGNOSTIC_LOG || "diagnostics/tv.jsonl")
mkdirSync(dirname(output), { recursive: true })

createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*")
  response.setHeader("Access-Control-Allow-Headers", "content-type")
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return }
  if (request.method !== "POST" || request.url !== "/log") { response.writeHead(404); response.end(); return }
  const chunks = []
  request.on("data", chunk => chunks.push(chunk))
  request.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8")
    try {
      const body = JSON.parse(raw)
      for (const entry of body.entries || []) appendFileSync(output, `${JSON.stringify({ session: body.session, receivedAt: new Date().toISOString(), ...entry })}\n`)
      response.writeHead(204)
    } catch (error) {
      appendFileSync(output, `${JSON.stringify({ receivedAt: new Date().toISOString(), event: "receiver.invalid", raw, error: String(error) })}\n`)
      response.writeHead(400)
    }
    response.end()
  })
}).listen(port, "0.0.0.0", () => process.stdout.write(`Seanime TV diagnostic receiver: http://0.0.0.0:${port}/log -> ${output}\n`))
