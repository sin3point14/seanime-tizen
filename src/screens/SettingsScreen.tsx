import { setFocus } from "@noriginmedia/norigin-spatial-navigation"
import { useEffect, useMemo, useState } from "react"
import { effectiveCachePolicy, type SystemResources } from "../domain/cache"
import type { PlayerSettings } from "../domain/settings"
import type { ServerConfig } from "../lib/storage"
import { emptyResources, getSystemResources } from "../platform/system-info"
import { Focusable } from "../ui/Focusable"

function Toggle({ label, detail, value, focusKey, previousFocusKey, onChange }: { label: string; detail: string; value: boolean; focusKey?: string; previousFocusKey?: string; onChange: (value: boolean) => void }) {
  const arrow = (direction: string) => {
    if (direction !== "up" || !previousFocusKey) return true
    setFocus(previousFocusKey)
    return false
  }
  return <Focusable focusKey={focusKey} onArrowPress={arrow} className="setting-row" onEnter={() => onChange(!value)}><span><strong>{label}</strong><small>{detail}</small></span><i className={`toggle ${value ? "on" : ""}`}><b /></i></Focusable>
}

function NumberSetting({ label, detail, value, unit, step, minimum, maximum, focusKey, previousFocusKey, nextFocusKey, onChange }: { label: string; detail: string; value: number; unit: string; step: number; minimum: number; maximum: number; focusKey?: string; previousFocusKey?: string; nextFocusKey?: string; onChange: (value: number) => void }) {
  const arrow = (direction: string) => {
    const target = direction === "up" ? previousFocusKey : direction === "down" ? nextFocusKey : undefined
    if (!target) return true
    setFocus(target)
    return false
  }
  return <div className="setting-block numeric-setting"><span><strong>{label}</strong><small>{detail}</small></span><div className="stepper">
    <Focusable focusKey={focusKey && value > minimum ? focusKey : undefined} onArrowPress={arrow} disabled={value <= minimum} onEnter={() => onChange(Math.max(minimum, value - step))}>−</Focusable>
    <b>{value.toLocaleString()} {unit}</b>
    <Focusable focusKey={focusKey && value <= minimum ? focusKey : undefined} onArrowPress={arrow} disabled={value >= maximum} onEnter={() => onChange(Math.min(maximum, value + step))}>+</Focusable>
  </div></div>
}

export function SettingsScreen({ config, settings, onSettings, onReconnect, onDisconnect }: { config: ServerConfig; settings: PlayerSettings; onSettings: (value: PlayerSettings) => void; onReconnect: () => void; onDisconnect: () => void }) {
  const update = (partial: Partial<PlayerSettings>) => onSettings({ ...settings, ...partial })
  const [resources, setResources] = useState<SystemResources>(emptyResources)
  useEffect(() => { void getSystemResources().then(setResources) }, [])
  const cache = useMemo(() => effectiveCachePolicy(settings, resources), [resources, settings])
  const seekSteps = [5, 10, 15, 30, 60]
  const engineArrow = (direction: string) => { if (direction !== "down") return true; setFocus("AVPLAY_INITIAL"); return false }
  return <div className="screen settings-screen"><p className="eyebrow">PREFERENCES</p><h1>Settings</h1>
    <div className="settings-layout"><section><h2>Playback</h2>
      <Toggle label="Resume playback" detail="Continue an episode when Seanime has saved watch history." value={settings.resumeEnabled} onChange={value => update({ resumeEnabled: value })} />
      <Toggle label="Autoplay next episode" detail="Start a five-second countdown near the end." value={settings.autoplayNext} onChange={value => update({ autoplayNext: value })} />
      <Toggle label="Subtitles by default" detail="Use the preferred subtitle language when present." value={settings.subtitlesEnabled} onChange={value => update({ subtitlesEnabled: value })} />
      <div className="setting-block"><strong>Seek step</strong><div className="choice-row">{seekSteps.map(step => <Focusable key={step} className={settings.seekStepSeconds === step ? "selected" : ""} onEnter={() => update({ seekStepSeconds: step })}>{step}s</Focusable>)}</div></div>
      <div className="setting-block"><strong>Playback engine</strong><small>The FFmpeg/WASM engine provides retained caching on supported files. Samsung AVPlay remains the compatibility fallback.</small><div className="choice-row">
        <Focusable onArrowPress={engineArrow} className={settings.playbackBackend === "avplay" ? "selected" : ""} onEnter={() => update({ playbackBackend: "avplay" })}>Samsung AVPlay</Focusable>
        <Focusable onArrowPress={engineArrow} className={settings.playbackBackend === "wasm-experimental" ? "selected" : ""} onEnter={() => update({ playbackBackend: "wasm-experimental" })}>Experimental WASM</Focusable>
      </div></div>
      <h2>AVPlay startup and recovery</h2>
      <p className="setting-explanation">These thresholds decide when AVPlay starts or resumes. Samsung owns and may discard the underlying buffer; these are not persistent cache sizes.</p>
      <NumberSetting focusKey="AVPLAY_INITIAL" nextFocusKey="AVPLAY_RECOVERY" label="Initial playable buffer" detail="Playable media required before the episode starts." value={settings.avplayInitialBufferSeconds} unit="sec" step={1} minimum={4} maximum={120} onChange={value => update({ avplayInitialBufferSeconds: value })} />
      <NumberSetting focusKey="AVPLAY_RECOVERY" previousFocusKey="AVPLAY_INITIAL" nextFocusKey="AVPLAY_TIMEOUT" label="Recovery playable buffer" detail="Playable media required after a seek or network stall." value={settings.avplayRecoveryBufferSeconds} unit="sec" step={1} minimum={4} maximum={120} onChange={value => update({ avplayRecoveryBufferSeconds: value })} />
      <NumberSetting focusKey="AVPLAY_TIMEOUT" previousFocusKey="AVPLAY_RECOVERY" nextFocusKey="SUBTITLE_ASS" label="Buffering timeout" detail="Maximum wall-clock time for an AVPlay buffering phase." value={settings.avplayBufferTimeoutSeconds} unit="sec" step={1} minimum={3} maximum={120} onChange={value => update({ avplayBufferTimeoutSeconds: value })} />
      <h2>Subtitles</h2>
      <Toggle focusKey="SUBTITLE_ASS" previousFocusKey="AVPLAY_TIMEOUT" label="Use authored ASS styles" detail="Preserve exact script fonts, sizes, positions, signs, and karaoke." value={settings.subtitleUseAssStyles} onChange={value => update({ subtitleUseAssStyles: value })} />
      <NumberSetting label="Override scale" detail="Applied only when authored ASS styles are disabled." value={settings.subtitleFontScale} unit="%" step={10} minimum={50} maximum={200} onChange={value => update({ subtitleFontScale: value })} />
      <NumberSetting label="Override bottom offset" detail="Lifts subtitles above the bottom when authored styles are disabled." value={settings.subtitleBottomPercent} unit="%" step={1} minimum={0} maximum={30} onChange={value => update({ subtitleBottomPercent: value })} />
      <div className="setting-block"><strong>ASS renderer quality</strong><small>Lower modes reduce libass canvas resolution, frame rate, and memory use.</small><div className="choice-row">{(["performance", "balanced", "quality"] as const).map(quality => <Focusable key={quality} className={settings.subtitleQuality === quality ? "selected" : ""} onEnter={() => update({ subtitleQuality: quality })}>{quality}</Focusable>)}</div></div>
    </section><section><h2>Experimental cache</h2>
      <div className="setting-block"><strong>Cache mode</strong><small>Only used by the optional FFmpeg/WASM engine. AVPlay does not expose these controls.</small><div className="choice-row"><Focusable className={settings.cacheMode === "automatic" ? "selected" : ""} onEnter={() => update({ cacheMode: "automatic" })}>Automatic</Focusable><Focusable className={settings.cacheMode === "custom" ? "selected" : ""} onEnter={() => update({ cacheMode: "custom" })}>Custom</Focusable></div></div>
      <div className="setting-block"><strong>Timeline buffer display</strong><small>Playable shows timestamped packets accepted by Samsung. Network cache maps downloaded file ranges with FFmpeg packet timestamps and hides container-only metadata.</small><div className="choice-row"><Focusable className={settings.cacheTimelineDisplay === "playable" ? "selected" : ""} onEnter={() => update({ cacheTimelineDisplay: "playable" })}>Immediately playable</Focusable><Focusable className={settings.cacheTimelineDisplay === "network-cache" ? "selected" : ""} onEnter={() => update({ cacheTimelineDisplay: "network-cache" })}>Network cached</Focusable></div></div>
      <NumberSetting label="Minimum free storage" detail="Disk space kept available for Tizen and other apps. Cache reservation uses only storage above this safety margin." value={settings.cacheMinimumFreeMiB} unit="MiB" step={128} minimum={0} maximum={10240} onChange={value => update({ cacheMinimumFreeMiB: value })} />
      {settings.cacheMode === "custom" && <>
        <Toggle label="Time limit" detail="Limit the total retained playback window by time. At least one time or byte limit remains enabled." value={settings.cacheSecondsEnabled} onChange={value => update({ cacheSecondsEnabled: value || !settings.cacheBytesEnabled })} />
        {settings.cacheSecondsEnabled && <NumberSetting label="Total time cache" detail="Shared between media ahead and previously visited media." value={settings.cacheSeconds} unit="sec" step={30} minimum={30} maximum={7200} onChange={value => update({ cacheSeconds: value })} />}
        <Toggle label="Byte limit" detail="Limit the total retained cache by bytes. When both limits are active, the first reached wins." value={settings.cacheBytesEnabled} onChange={value => update({ cacheBytesEnabled: value || !settings.cacheSecondsEnabled })} />
        {settings.cacheBytesEnabled && <NumberSetting label="Total byte cache" detail="Shared between media ahead and previously visited media." value={settings.cacheTotalMiB} unit="MiB" step={32} minimum={32} maximum={10240} onChange={value => update({ cacheTotalMiB: value })} />}
        <NumberSetting label="Forward allocation" detail="Percentage reserved ahead; the remainder is retained behind the current position." value={settings.cacheForwardPercent} unit="%" step={1} minimum={0} maximum={100} onChange={value => update({ cacheForwardPercent: value })} />
      </>}
      <div className="cache-summary"><strong>Experimental cache policy</strong><small>Split: {cache.forwardPercent}% forward / {100 - cache.forwardPercent}% back</small><small>Time: {cache.seconds === null ? "disabled" : `${cache.forwardSeconds}s forward / ${cache.backSeconds}s back (${cache.seconds}s total)`}</small><small>Bytes: {cache.requestedBytes === null ? "disabled" : `${formatBytes(cache.forwardBytes)} forward / ${formatBytes(cache.backBytes)} back (${formatBytes(cache.requestedBytes)} total)`}</small><small>Temporary disk allowance: {formatBytes(cache.diskBytes)}</small><small>Free-space safety margin: {formatBytes(cache.minimumFreeBytes)}</small><small>Adaptive RAM hot tier: up to {formatBytes(cache.hotRamBytes)} (25% of free RAM, maximum 256 MiB)</small><small>The player reserves its temporary disk allowance before playback, releases that reservation as media replaces it, and deletes everything when the player closes or the app restarts.</small>{cache.warnings.map(warning => <small className="warning" key={warning}>{warning}</small>)}</div>
      <div className="resource-summary"><strong>TV resources reported by Tizen</strong><small>RAM: {resource(resources.availableMemoryBytes)} available / {resource(resources.totalMemoryBytes)} total</small><small>Storage: {resource(resources.availableStorageBytes)} available / {resource(resources.totalStorageBytes)} total</small></div>
      <h2>Server</h2><div className="server-card"><span className="connection-dot">● Connected</span><strong>{config.url}</strong><small>{config.passwordHash ? "Password protected" : "No password"}</small></div>
      <Focusable onEnter={onReconnect}>Reconnect</Focusable><Focusable className="danger" onEnter={onDisconnect}>Disconnect and clear data</Focusable>
      <div className="about"><strong>Seanime TV</strong><small>Version 0.3.0 · Samsung Tizen 9</small><small>AVPlay plus FFmpeg/Samsung WASM Player</small></div>
    </section></div>
  </div>
}

function formatBytes(bytes: number) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${Math.round(bytes / 1024 ** 2)} MiB` }
function resource(value: number | null) { return value === null ? "not reported" : formatBytes(value) }
