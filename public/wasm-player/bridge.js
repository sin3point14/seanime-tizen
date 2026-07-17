/* global Module */
(function () {
  const diagnostics = window.SeanimeDiagnosticsEnabled === true
  const diagnosticEvents = diagnostics ? (window.SeanimeWasmDiagnostics = window.SeanimeWasmDiagnostics || []) : []
  function record(stage, detail) {
    if (!diagnostics) return
    const entry = { at: new Date().toISOString(), stage, detail: detail == null ? null : detail }
    diagnosticEvents.push(entry)
    if (diagnosticEvents.length > 200) diagnosticEvents.shift()
    window.dispatchEvent(new CustomEvent('seanime:wasm-log', { detail: entry }))
  }
  let resolveRuntime
  let rejectRuntime
  const runtime = new Promise((resolve, reject) => { resolveRuntime = resolve; rejectRuntime = reject })
  let activeBridge = null
  let nativeOpen = null

  class SeanimeWasmBridge {
    constructor() {
      this.listeners = new Set()
      this.pendingOpen = null
      this.readyPromise = null
      this.readyResolve = null
      this.readyReject = null
      this.media = null
      this.lastTime = 0
      this.lastState = 'IDLE'
      this.selectedAudio = 0
      this.prepared = false
      activeBridge = this
      record('bridge-created')
    }

    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }

    open(url, cache, media) {
      this.media = media
      this.pendingOpen = { url, cache, media }
      this.readyPromise = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
      record('open-requested', { bytes: media && media.mediaInfo && media.mediaInfo.size, hotRamBytes: cache.hotRamBytes })
    }

    async prepare() {
      record('runtime-wait')
      await Promise.race([
        runtime,
        new Promise((_, reject) => setTimeout(() => reject(new Error('WASM runtime initialization timed out.')), 15000)),
      ])
      record('runtime-available')
      const request = this.pendingOpen
      if (!request) throw new Error('No experimental playback source was provided.')
      const info = request.media && request.media.mediaInfo
      const video = info && info.video
      if (!info || !video) throw new Error('FFmpeg player requires Seanime media metadata.')
      this.lastState = 'PREPARING'
      this.startNative(this.selectedAudio)
      return this.readyPromise
    }

    startNative(audioIndex) {
      const request = this.pendingOpen
      const info = request.media.mediaInfo
      const video = info.video
      const audio = info.audios && info.audios[audioIndex]
      const videoCodec = video.mimeCodec || video.codec
      const audioCodec = audio && (audio.mimeCodec || audio.codec)
      const videoMime = `video/mp4; codecs="${videoCodec}"`
      const audioMime = audioCodec ? `audio/mp4; codecs="${audioCodec}"` : ''
      if (!nativeOpen) throw new Error('Native seanime_open binding is unavailable.')
      record('native-open', { videoMime, audioMime, audioIndex, bytes: info.size })
      nativeOpen(request.url, info.size, videoMime, audioMime, 'wasm-video', audioIndex, Math.max(16, Math.round(request.cache.hotRamBytes / 1048576)))
    }

    play() { Module._seanime_play(); this.lastState = 'PLAYING' }
    pause() { Module._seanime_pause(); this.lastState = 'PAUSED' }
    async seek(milliseconds) { Module._seanime_seek(milliseconds / 1000); this.lastTime = milliseconds; }
    stop() { if (Module._seanime_stop) Module._seanime_stop(); this.lastState = 'IDLE'; if (activeBridge === this) activeBridge = null }
    duration() { return Module._seanime_duration ? Module._seanime_duration() * 1000 : 0 }
    currentTime() { return Module._seanime_current_time ? Module._seanime_current_time() * 1000 : this.lastTime }
    state() { return this.lastState }
    bandwidth() { return Module._seanime_bandwidth ? Module._seanime_bandwidth() : null }
    buffered() { return [] }
    tracks() {
      const info = this.media && this.media.mediaInfo
      const audio = (info && info.audios || []).map((track, index) => ({ index, type: 'AUDIO', language: track.language || 'unknown', title: track.title || `Audio ${index + 1}`, codec: track.codec, source: 'server', raw: track }))
      return audio
    }
    currentTracks() { return this.tracks().slice(0, 1) }
    selectTrack(type, index) {
      if (type !== 'AUDIO' || index === this.selectedAudio) return
      this.selectedAudio = index
      if (!this.prepared || !this.pendingOpen) return
      const position = this.currentTime()
      const wasPlaying = this.lastState === 'PLAYING'
      Module._seanime_stop()
      this.readyPromise = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
      this.startNative(index)
      this.readyPromise.then(() => {
        Module._seanime_seek(position / 1000)
        if (wasPlaying) Module._seanime_play()
      }).catch(() => undefined)
    }
    setSubtitlesEnabled() { /* Subtitles are rendered by the React/libass layer. */ }

    emit(type, value, message) {
      if (type !== 'time') record(`native-${type}`, { value, message })
      if (type === 'ready') { this.lastState = 'READY'; this.prepared = true; this.readyResolve && this.readyResolve(); return }
      if (type === 'playing') { this.lastState = 'PLAYING'; return }
      if (type === 'paused') { this.lastState = 'PAUSED'; return }
      if (type === 'time') { this.lastTime = value; this.dispatch({ type: 'time', milliseconds: value }); return }
      if (type === 'buffering') { this.dispatch({ type: 'buffering', percent: value || 0 }); return }
      if (type === 'complete') { this.lastState = 'COMPLETE'; this.dispatch({ type: 'complete' }); return }
      if (type === 'error') {
        const error = message || 'Experimental WASM playback failed.'
        this.lastState = 'ERROR'; this.readyReject && this.readyReject(new Error(error)); this.dispatch({ type: 'error', message: error })
      }
    }
    dispatch(event) { this.listeners.forEach(listener => listener(event)) }
  }

  window.SeanimeWasmPlayer = { create: () => new SeanimeWasmBridge() }
  record('bridge-loaded', { wasm: typeof WebAssembly !== 'undefined', sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', worker: typeof Worker !== 'undefined' })
  if (diagnostics) {
    window.addEventListener('error', event => record('window-error', { message: event.message, filename: event.filename, line: event.lineno, column: event.colno }))
    window.addEventListener('unhandledrejection', event => record('unhandled-rejection', { reason: String(event.reason && (event.reason.stack || event.reason.message) || event.reason) }))
  }
  const moduleConfig = {
    locateFile: path => { const url = `./wasm-player/${path}`; record('locate-file', { path, url }); return url },
    onRuntimeInitialized: () => {
      try {
        nativeOpen = Module.cwrap('seanime_open', null, ['string', 'number', 'string', 'string', 'string', 'number', 'number'])
        record('runtime-initialized')
        resolveRuntime()
      } catch (error) {
        record('runtime-binding-error', { message: String(error && (error.stack || error.message) || error) })
        rejectRuntime(error)
      }
    },
    onAbort: reason => { record('runtime-abort', { reason: String(reason) }); rejectRuntime(new Error(String(reason || 'WASM runtime aborted'))) },
    onSeanimePlayerEvent: (type, value, message) => activeBridge && activeBridge.emit(type, value, message),
  }
  if (diagnostics) {
    moduleConfig.print = message => record('stdout', { message: String(message) })
    moduleConfig.printErr = message => record('stderr', { message: String(message) })
  }
  window.Module = moduleConfig
}())
