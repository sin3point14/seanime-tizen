import { useEffect, useMemo, useState } from "react"
import { effectiveCachePolicy, type SystemResources } from "../domain/cache"
import type { PlayerSettings } from "../domain/settings"
import type { ServerConfig } from "../lib/storage"
import { emptyResources, getSystemResources } from "../platform/system-info"
import { Focusable } from "../ui/Focusable"

function Toggle({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return <Focusable className="setting-row" onEnter={() => onChange(!value)}><span><strong>{label}</strong><small>{detail}</small></span><i className={`toggle ${value ? "on" : ""}`}><b /></i></Focusable>
}

function NumberSetting({ label, detail, value, unit, step, minimum, maximum, onChange }: { label: string; detail: string; value: number; unit: string; step: number; minimum: number; maximum: number; onChange: (value: number) => void }) {
  return <div className="setting-block numeric-setting"><span><strong>{label}</strong><small>{detail}</small></span><div className="stepper">
    <Focusable disabled={value <= minimum} onEnter={() => onChange(Math.max(minimum, value - step))}>−</Focusable>
    <b>{value.toLocaleString()} {unit}</b>
    <Focusable disabled={value >= maximum} onEnter={() => onChange(Math.min(maximum, value + step))}>+</Focusable>
  </div></div>
}

export function SettingsScreen({ config, settings, onSettings, onReconnect, onDisconnect }: { config: ServerConfig; settings: PlayerSettings; onSettings: (value: PlayerSettings) => void; onReconnect: () => void; onDisconnect: () => void }) {
  const update = (partial: Partial<PlayerSettings>) => onSettings({ ...settings, ...partial })
  const [resources, setResources] = useState<SystemResources>(emptyResources)
  useEffect(() => { void getSystemResources().then(setResources) }, [])
  const cache = useMemo(() => effectiveCachePolicy(settings, resources), [resources, settings])
  const seekSteps = [5, 10, 15, 30, 60]
  return <div className="screen settings-screen"><p className="eyebrow">PREFERENCES</p><h1>Settings</h1>
    <div className="settings-layout"><section><h2>Playback</h2>
      <Toggle label="Resume playback" detail="Continue an episode when Seanime has saved watch history." value={settings.resumeEnabled} onChange={value => update({ resumeEnabled: value })} />
      <Toggle label="Autoplay next episode" detail="Start a five-second countdown near the end." value={settings.autoplayNext} onChange={value => update({ autoplayNext: value })} />
      <Toggle label="Subtitles by default" detail="Use the preferred subtitle language when present." value={settings.subtitlesEnabled} onChange={value => update({ subtitlesEnabled: value })} />
      <div className="setting-block"><strong>Seek step</strong><div className="choice-row">{seekSteps.map(step => <Focusable key={step} className={settings.seekStepSeconds === step ? "selected" : ""} onEnter={() => update({ seekStepSeconds: step })}>{step}s</Focusable>)}</div></div>
      <div className="setting-block"><strong>Playback engine</strong><small>AVPlay is the supported default. The FFmpeg/WASM engine appears only when its separately compiled module is present and the file is verified.</small><div className="choice-row">
        <Focusable className={settings.playbackBackend === "avplay" ? "selected" : ""} onEnter={() => update({ playbackBackend: "avplay" })}>Samsung AVPlay</Focusable>
        <Focusable className={settings.playbackBackend === "wasm-experimental" ? "selected" : ""} onEnter={() => update({ playbackBackend: "wasm-experimental" })}>Experimental WASM</Focusable>
      </div></div>
      <h2>AVPlay startup and recovery</h2>
      <p className="setting-explanation">These thresholds decide when AVPlay starts or resumes. Samsung owns and may discard the underlying buffer; these are not persistent cache sizes.</p>
      <NumberSetting label="Initial playable buffer" detail="Playable media required before the episode starts." value={settings.avplayInitialBufferSeconds} unit="sec" step={1} minimum={4} maximum={120} onChange={value => update({ avplayInitialBufferSeconds: value })} />
      <NumberSetting label="Recovery playable buffer" detail="Playable media required after a seek or network stall." value={settings.avplayRecoveryBufferSeconds} unit="sec" step={1} minimum={4} maximum={120} onChange={value => update({ avplayRecoveryBufferSeconds: value })} />
      <NumberSetting label="Buffering timeout" detail="Maximum wall-clock time for an AVPlay buffering phase." value={settings.avplayBufferTimeoutSeconds} unit="sec" step={1} minimum={3} maximum={120} onChange={value => update({ avplayBufferTimeoutSeconds: value })} />
      <h2>Subtitles</h2>
      <Toggle label="Use authored ASS styles" detail="Preserve exact script fonts, sizes, positions, signs, and karaoke." value={settings.subtitleUseAssStyles} onChange={value => update({ subtitleUseAssStyles: value })} />
      <NumberSetting label="Override scale" detail="Applied only when authored ASS styles are disabled." value={settings.subtitleFontScale} unit="%" step={10} minimum={50} maximum={200} onChange={value => update({ subtitleFontScale: value })} />
      <NumberSetting label="Override bottom offset" detail="Lifts subtitles above the bottom when authored styles are disabled." value={settings.subtitleBottomPercent} unit="%" step={1} minimum={0} maximum={30} onChange={value => update({ subtitleBottomPercent: value })} />
      <div className="setting-block"><strong>ASS renderer quality</strong><small>Lower modes reduce libass canvas resolution, frame rate, and memory use.</small><div className="choice-row">{(["performance", "balanced", "quality"] as const).map(quality => <Focusable key={quality} className={settings.subtitleQuality === quality ? "selected" : ""} onEnter={() => update({ subtitleQuality: quality })}>{quality}</Focusable>)}</div></div>
    </section><section><h2>Experimental cache</h2>
      <div className="setting-block"><strong>Cache mode</strong><small>Only used by the optional FFmpeg/WASM engine. AVPlay does not expose these controls.</small><div className="choice-row"><Focusable className={settings.cacheMode === "automatic" ? "selected" : ""} onEnter={() => update({ cacheMode: "automatic" })}>Automatic</Focusable><Focusable className={settings.cacheMode === "custom" ? "selected" : ""} onEnter={() => update({ cacheMode: "custom" })}>Custom</Focusable></div></div>
      {settings.cacheMode === "custom" && <>
        <Toggle label="Time limit" detail="Stop forward read-ahead when this playable duration is cached. At least one forward limit must remain active." value={settings.cacheSecondsEnabled} onChange={value => update({ cacheSecondsEnabled: value || !settings.cacheBytesEnabled })} />
        {settings.cacheSecondsEnabled && <NumberSetting label="Forward time target" detail="Equivalent to mpv cache-secs." value={settings.cacheSeconds} unit="sec" step={30} minimum={30} maximum={7200} onChange={value => update({ cacheSeconds: value })} />}
        <Toggle label="Byte limit" detail="Stop forward read-ahead at this byte budget. The lower active limit wins." value={settings.cacheBytesEnabled} onChange={value => update({ cacheBytesEnabled: value || !settings.cacheSecondsEnabled })} />
        {settings.cacheBytesEnabled && <NumberSetting label="Forward byte cache" detail="Equivalent to mpv demuxer-max-bytes." value={settings.cacheForwardMiB} unit="MiB" step={32} minimum={32} maximum={8192} onChange={value => update({ cacheForwardMiB: value })} />}
        <NumberSetting label="Back cache" detail="Retains previously watched and seeked regions; it cannot be disabled." value={settings.cacheBackMiB} unit="MiB" step={16} minimum={16} maximum={2048} onChange={value => update({ cacheBackMiB: value })} />
      </>}
      <NumberSetting label="Hot RAM cache" detail="Further limited to 25% of currently available RAM and 256 MiB." value={settings.cacheHotRamMiB} unit="MiB" step={16} minimum={16} maximum={256} onChange={value => update({ cacheHotRamMiB: value })} />
      <div className="cache-summary"><strong>Requested experimental cache policy</strong><small>Forward: {formatBytes(cache.forwardBytes)} · Back: {formatBytes(cache.backBytes)}</small><small>Active hot RAM: {formatBytes(cache.hotRamBytes)}</small><small>Time target: {cache.seconds === null ? "disabled" : `${cache.seconds}s`}</small><small className="warning">The current native preview uses the hot-RAM LRU tier. Persistent sparse disk caching is not enabled yet.</small>{cache.warnings.map(warning => <small className="warning" key={warning}>{warning}</small>)}</div>
      <div className="resource-summary"><strong>TV resources reported by Tizen</strong><small>RAM: {resource(resources.availableMemoryBytes)} available / {resource(resources.totalMemoryBytes)} total</small><small>Storage: {resource(resources.availableStorageBytes)} available / {resource(resources.totalStorageBytes)} total</small></div>
      <h2>Server</h2><div className="server-card"><span className="connection-dot">● Connected</span><strong>{config.url}</strong><small>{config.passwordHash ? "Password protected" : "No password"}</small></div>
      <Focusable onEnter={onReconnect}>Reconnect</Focusable><Focusable className="danger" onEnter={onDisconnect}>Disconnect and clear data</Focusable>
      <div className="about"><strong>Seanime TV</strong><small>Version 0.2.2 · Samsung Tizen 9</small><small>AVPlay plus opt-in FFmpeg/Samsung WASM Player</small></div>
    </section></div>
  </div>
}

function formatBytes(bytes: number) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${Math.round(bytes / 1024 ** 2)} MiB` }
function resource(value: number | null) { return value === null ? "not reported" : formatBytes(value) }
