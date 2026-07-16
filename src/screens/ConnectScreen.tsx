import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation"
import { useEffect, useState } from "react"
import { hashPassword } from "../api/auth"
import { normalizeUrl, SeanimeClient } from "../api/seanime-client"
import { storage, type ServerConfig } from "../lib/storage"
import { Focusable } from "../ui/Focusable"
import { Keyboard } from "../ui/Keyboard"

export function ConnectScreen({ onConnected }: { onConnected: (config: ServerConfig, client: SeanimeClient) => void }) {
  const stored = storage.getServer()
  const [url, setUrl] = useState(stored?.url ?? "http://192.168.1.")
  const [password, setPassword] = useState("")
  const [field, setField] = useState<"url" | "password">("url")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const { ref, focusKey } = useFocusable({ focusKey: "CONNECT", trackChildren: true })
  useEffect(() => { setFocus("CONNECT_URL") }, [])

  const connect = async () => {
    setBusy(true); setError("")
    const config = { url: normalizeUrl(url), passwordHash: password ? hashPassword(password) : (stored?.url === normalizeUrl(url) ? stored.passwordHash : "") }
    const client = new SeanimeClient(config)
    try { await client.validate(); storage.setServer(config); onConnected(config, client) }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not connect to Seanime") }
    finally { setBusy(false) }
  }

  const value = field === "url" ? url : password
  return <FocusContext.Provider value={focusKey}><div ref={ref} className="connect-screen">
    <section className="connect-copy"><div className="brand large"><span className="brand-mark">S</span><span>Seanime <em>TV</em></span></div>
      <h1>Your anime library,<br /><span>made for the big screen.</span></h1>
      <p>Connect to the Seanime server running on your home network.</p>
      <div className="connect-form">
        <Focusable focusKey="CONNECT_URL" className={`field ${field === "url" ? "selected" : ""}`} onEnter={() => setField("url")}>
          <small>Server URL</small><strong>{url || "http://192.168.1.10:43211"}</strong>
        </Focusable>
        <Focusable className={`field ${field === "password" ? "selected" : ""}`} onEnter={() => setField("password")}>
          <small>Password (optional)</small><strong>{password ? "•".repeat(password.length) : "No password"}</strong>
        </Focusable>
        <Focusable className="primary" disabled={busy || !url.trim()} onEnter={connect}>{busy ? "Connecting…" : "Connect"}</Focusable>
        {error && <p className="error">{error}</p>}
      </div>
    </section>
    <aside><Keyboard value={value} onChange={next => field === "url" ? setUrl(next) : setPassword(next)} />
      <p className="hint">Use the D-pad and Select. Set the URL first, then choose Password if required.</p>
    </aside>
  </div></FocusContext.Provider>
}
