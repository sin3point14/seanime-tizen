import type { PlayerSettings } from "../domain/settings"
import type { ServerConfig } from "../lib/storage"
import { Focusable } from "../ui/Focusable"

function Toggle({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return <Focusable className="setting-row" onEnter={() => onChange(!value)}><span><strong>{label}</strong><small>{detail}</small></span><i className={`toggle ${value ? "on" : ""}`}><b /></i></Focusable>
}

export function SettingsScreen({ config, settings, onSettings, onReconnect, onDisconnect }: { config: ServerConfig; settings: PlayerSettings; onSettings: (value: PlayerSettings) => void; onReconnect: () => void; onDisconnect: () => void }) {
  const update = (partial: Partial<PlayerSettings>) => onSettings({ ...settings, ...partial })
  const seekSteps = [5, 10, 15, 30, 60]
  const subtitleSizes = [32, 38, 42, 48, 56]
  const subtitlePositions = [{ label: "Low", value: 5 }, { label: "Normal", value: 8 }, { label: "High", value: 14 }, { label: "Higher", value: 20 }]
  return <div className="screen settings-screen"><p className="eyebrow">PREFERENCES</p><h1>Settings</h1>
    <div className="settings-layout"><section><h2>Playback</h2>
      <Toggle label="Resume playback" detail="Continue between 2% and 90% watched" value={settings.resumeEnabled} onChange={value => update({ resumeEnabled: value })} />
      <Toggle label="Autoplay next episode" detail="Start a five-second countdown near the end" value={settings.autoplayNext} onChange={value => update({ autoplayNext: value })} />
      <Toggle label="Subtitles by default" detail="Use the preferred subtitle language when present" value={settings.subtitlesEnabled} onChange={value => update({ subtitlesEnabled: value })} />
      <div className="setting-block"><strong>Seek step</strong><div className="choice-row">{seekSteps.map(step => <Focusable key={step} className={settings.seekStepSeconds === step ? "selected" : ""} onEnter={() => update({ seekStepSeconds: step })}>{step}s</Focusable>)}</div></div>
      <div className="setting-block"><strong>Buffer policy</strong><small>Controls how much AVPlay buffers before starting and after stalls.</small><div className="choice-row">
        {(["fast", "balanced", "stable"] as const).map(policy => <Focusable key={policy} className={settings.bufferPolicy === policy ? "selected" : ""} onEnter={() => update({ bufferPolicy: policy })}>{policy}</Focusable>)}
      </div></div>
      <div className="setting-block"><strong>Subtitle size</strong><div className="choice-row">{subtitleSizes.map(size => <Focusable key={size} className={settings.subtitleFontSize === size ? "selected" : ""} onEnter={() => update({ subtitleFontSize: size })}>{size}px</Focusable>)}</div></div>
      <div className="setting-block"><strong>Subtitle position</strong><small>Distance above the bottom edge.</small><div className="choice-row">{subtitlePositions.map(position => <Focusable key={position.value} className={settings.subtitleBottomPercent === position.value ? "selected" : ""} onEnter={() => update({ subtitleBottomPercent: position.value })}>{position.label}</Focusable>)}</div></div>
      <div className="setting-block"><strong>Preferred tracks</strong><small>Audio: {settings.preferredAudio.join(", ")}</small><small>Subtitles: {settings.preferredSubtitles.join(", ")}</small></div>
    </section><section><h2>Server</h2><div className="server-card"><span className="connection-dot">● Connected</span><strong>{config.url}</strong><small>{config.passwordHash ? "Password protected" : "No password"}</small></div>
      <Focusable onEnter={onReconnect}>Reconnect</Focusable><Focusable className="danger" onEnter={onDisconnect}>Disconnect and clear data</Focusable>
      <div className="about"><strong>Seanime TV</strong><small>Version 0.1.0 · Samsung Tizen 6.0+</small><small>Direct playback through Samsung AVPlay</small></div>
    </section></div>
  </div>
}
