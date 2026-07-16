import JASSUB from "jassub"
import workerUrl from "jassub/dist/worker/worker.js?worker&url"
import wasmUrl from "jassub/dist/wasm/jassub-worker.wasm?url"
import modernWasmUrl from "jassub/dist/wasm/jassub-worker-modern.wasm?url"
import type { PlayerSettings } from "../domain/settings"

export class AssSubtitleRenderer {
  private renderer: JASSUB | null = null
  private frame: number | null = null
  private playing = false
  private lastRenderedAt = 0

  constructor(
    private canvas: HTMLCanvasElement,
    private getTime: () => number,
    private getVideoSize: () => { width: number; height: number },
    private settings: PlayerSettings,
  ) {}

  async load(content: string, fonts: Uint8Array[]) {
    await this.destroy()
    const quality = qualityOptions(this.settings)
    this.renderer = new JASSUB({
      canvas: this.canvas,
      subContent: content,
      fonts,
      queryFonts: false,
      workerUrl,
      wasmUrl,
      modernWasmUrl,
      prescaleFactor: quality.prescaleFactor,
      prescaleHeightLimit: quality.maxHeight,
      maxRenderHeight: quality.maxHeight,
      libassMemoryLimit: quality.memoryLimit,
      libassGlyphLimit: quality.glyphLimit,
    })
    await this.renderer.ready
    this.applyAppearance()
    const size = this.getVideoSize()
    await this.renderer.resize(true, size.width, size.height)
    await this.renderAt(this.getTime(), true)
    if (this.playing) this.schedule()
  }

  setSettings(settings: PlayerSettings) {
    this.settings = settings
    this.applyAppearance()
    void this.renderAt(this.getTime(), true)
  }

  setPlaying(playing: boolean) {
    this.playing = playing
    if (playing) this.schedule()
    else this.cancelFrame()
  }

  seek(seconds: number) { return this.renderAt(seconds, true) }

  resize() {
    this.applyAppearance()
    const size = this.getVideoSize()
    return this.renderer?.resize(true, size.width, size.height) ?? Promise.resolve()
  }

  async destroy() {
    this.cancelFrame()
    const current = this.renderer
    this.renderer = null
    if (current) await current.destroy().catch(() => undefined)
    const context = this.canvas.getContext("2d")
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private applyAppearance() {
    const scale = this.settings.subtitleUseAssStyles ? 1 : this.settings.subtitleFontScale / 100
    const lift = this.settings.subtitleUseAssStyles ? 0 : -this.settings.subtitleBottomPercent
    this.canvas.style.transformOrigin = "center bottom"
    this.canvas.style.transform = `translateY(${lift}vh) scale(${scale})`
  }

  private schedule = () => {
    if (!this.playing || !this.renderer || this.frame !== null) return
    this.frame = window.requestAnimationFrame(timestamp => {
      this.frame = null
      const interval = 1000 / qualityOptions(this.settings).fps
      if (timestamp - this.lastRenderedAt >= interval) {
        this.lastRenderedAt = timestamp
        void this.renderAt(this.getTime())
      }
      this.schedule()
    })
  }

  private async renderAt(seconds: number, repaint = false) {
    if (!this.renderer) return
    const size = this.getVideoSize()
    await this.renderer.manualRender({
      expectedDisplayTime: performance.now(),
      mediaTime: Math.max(0, seconds),
      width: size.width,
      height: size.height,
    }, repaint).catch(() => undefined)
  }

  private cancelFrame() {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame)
    this.frame = null
  }
}

function qualityOptions(settings: PlayerSettings) {
  if (settings.subtitleQuality === "performance") return { fps: 15, prescaleFactor: 0.5, maxHeight: 540, memoryLimit: 24, glyphLimit: 24 }
  if (settings.subtitleQuality === "quality") return { fps: 30, prescaleFactor: 1, maxHeight: 1080, memoryLimit: 64, glyphLimit: 64 }
  return { fps: 24, prescaleFactor: 0.8, maxHeight: 720, memoryLimit: 40, glyphLimit: 40 }
}

export function videoViewport(videoWidth: number, videoHeight: number, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  if (videoWidth <= 0 || videoHeight <= 0) return { x: 0, y: 0, width: viewportWidth, height: viewportHeight }
  const scale = Math.min(viewportWidth / videoWidth, viewportHeight / videoHeight)
  const width = Math.round(videoWidth * scale)
  const height = Math.round(videoHeight * scale)
  return { x: Math.round((viewportWidth - width) / 2), y: Math.round((viewportHeight - height) / 2), width, height }
}
