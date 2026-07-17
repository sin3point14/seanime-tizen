import { init } from "@noriginmedia/norigin-spatial-navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SeanimeClient } from "./api/seanime-client"
import type { PlayerSettings } from "./domain/settings"
import type { LibraryCollection, PlaybackSource } from "./domain/types"
import { storage, type ServerConfig } from "./lib/storage"
import { registerMediaKeys, RemoteKey } from "./platform/remote"
import { diagnostic } from "./platform/diagnostics"
import { ConnectScreen } from "./screens/ConnectScreen"
import { DetailsScreen } from "./screens/DetailsScreen"
import { HomeScreen } from "./screens/HomeScreen"
import { PlayerScreen } from "./screens/PlayerScreen"
import { SearchScreen } from "./screens/SearchScreen"
import { SettingsScreen } from "./screens/SettingsScreen"
import { Shell, type Route } from "./ui/Shell"

init({
  distanceCalculationMethod: "center",
  visualDebug: false,
  shouldFocusDOMNode: true,
  shouldUseNativeEvents: true,
})

export default function App() {
  const initialConfig = storage.getServer()
  const [config, setConfig] = useState<ServerConfig | null>(initialConfig)
  const [client, setClient] = useState<SeanimeClient | null>(() => initialConfig ? new SeanimeClient(initialConfig) : null)
  const [connected, setConnected] = useState(false)
  const [collection, setCollection] = useState<LibraryCollection | null>(null)
  const [route, setRoute] = useState<Route>({ screen: "home" })
  const [settings, setSettings] = useState<PlayerSettings>(storage.getSettings)
  const [source, setSource] = useState<PlaybackSource | null>(null)
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [checking, setChecking] = useState(Boolean(initialConfig))
  const diagnosticAutoplayStarted = useRef(false)

  const loadLibrary = useCallback(async (refresh = false) => {
    if (!client) return
    setRefreshing(true); setError("")
    try { setCollection(await client.getLibrary(refresh)); setConnected(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setRefreshing(false); setChecking(false) }
  }, [client])

  useEffect(() => { registerMediaKeys() }, [])
  useEffect(() => {
    if (!client || connected) return
    client.validate().then(() => loadLibrary()).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)); setChecking(false); setConnected(false) })
  }, [client, connected, loadLibrary])

  useEffect(() => {
    if (typeof __DIAGNOSTICS__ === "undefined" || !__DIAGNOSTICS__ || typeof __DIAGNOSTIC_AUTOPLAY__ === "undefined" || !__DIAGNOSTIC_AUTOPLAY__ || !client || !connected || diagnosticAutoplayStarted.current) return
    const [rawMediaId, rawEpisode] = __DIAGNOSTIC_AUTOPLAY__.split(":")
    const mediaId = Number(rawMediaId)
    const episodeNumber = Number(rawEpisode)
    if (!Number.isFinite(mediaId) || !Number.isFinite(episodeNumber)) return
    diagnosticAutoplayStarted.current = true
    diagnostic("autoplay.start", { mediaId, episodeNumber })
    void client.getAnimeEntry(mediaId).then(entry => {
      const episodes = (entry.episodes ?? []).filter(episode => episode.type === "main" && episode.localFile)
      const episode = episodes.find(item => item.episodeNumber === episodeNumber)
      if (!entry.media || !episode?.localFile) throw new Error(`Episode ${episodeNumber} is unavailable.`)
      setSettings(current => ({ ...current, playbackBackend: "wasm-experimental" }))
      setSource({ mediaId, media: entry.media, episode, localFile: episode.localFile, url: client.mediaUrl(episode.localFile.path), resumePosition: 0, queue: episodes })
      diagnostic("autoplay.ready", { mediaId, episodeNumber, file: episode.localFile.name })
    }).catch(reason => diagnostic("autoplay.error", { message: reason instanceof Error ? reason.message : String(reason) }, "error"))
  }, [client, connected])

  useEffect(() => {
    const onBack = (event: KeyboardEvent) => {
      if (event.keyCode !== RemoteKey.Back || source) return
      event.preventDefault()
      if (route.screen === "details") setRoute({ screen: "home" })
      else if (route.screen !== "home") setRoute({ screen: "home" })
      else window.tizen?.application?.getCurrentApplication().exit()
    }
    window.addEventListener("keydown", onBack)
    return () => window.removeEventListener("keydown", onBack)
  }, [route, source])

  const handleConnected = (nextConfig: ServerConfig, nextClient: SeanimeClient) => {
    setConfig(nextConfig); setClient(nextClient); setConnected(true); setChecking(false); setError("")
    nextClient.getLibrary().then(setCollection).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }
  const saveSettings = (value: PlayerSettings) => { storage.setSettings(value); setSettings(value) }
  const disconnect = () => { client?.disconnect(); setConfig(null); setClient(null); setCollection(null); setConnected(false); setRoute({ screen: "home" }) }
  const app = useMemo(() => ({ config, client, collection }), [client, collection, config])

  if (!app.config || !app.client || !connected) {
    if (checking) return <div className="state-screen"><div className="spinner" /><h2>Connecting to Seanime…</h2><p>{app.config?.url}</p></div>
    return <><ConnectScreen onConnected={handleConnected} />{error && initialConfig && <div className="connection-warning">Saved server unavailable: {error}</div>}</>
  }
  if (source) return <PlayerScreen initialSource={source} client={app.client} settings={settings} onSettings={saveSettings} onExit={() => { setSource(null); void loadLibrary() }} onSourceChange={setSource} />
  if (!app.collection) return <div className="state-screen"><div className="spinner" /><h2>Loading your local library…</h2>{error && <><p className="error">{error}</p><button onClick={() => void loadLibrary()}>Try again</button></>}</div>

  return <Shell route={route} navigate={setRoute}>
    {route.screen === "home" && <HomeScreen collection={app.collection} onOpen={mediaId => setRoute({ screen: "details", mediaId })} onRefresh={() => void loadLibrary(true)} refreshing={refreshing} />}
    {route.screen === "search" && <SearchScreen collection={app.collection} onOpen={mediaId => setRoute({ screen: "details", mediaId })} />}
    {route.screen === "settings" && <SettingsScreen config={app.config} settings={settings} onSettings={saveSettings} onReconnect={() => { setConnected(false); setChecking(true) }} onDisconnect={disconnect} />}
    {route.screen === "details" && <DetailsScreen mediaId={route.mediaId} client={app.client} settings={settings} onBack={() => setRoute({ screen: "home" })} onPlay={setSource} />}
    {error && <div className="toast">{error}</div>}
  </Shell>
}
