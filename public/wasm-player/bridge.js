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
  let bridgeSequence = 0

  const diskCache = (() => {
    let policy = { totalBytes: 0, forwardBytes: 0, backBytes: 0 }
    let entries = {}
    let pruning = false
    let activeIdentity = null
    let sessionId = null
    let sourceUrl = null
    let sourceBytes = 0
    let prefetchController = null
    let prefetchGeneration = 0
    let prefetchTimer = null
    let lastTimelineSignature = ''
    let reservations = []
    let reservationRelease = Promise.resolve()
    let preallocationTask = Promise.resolve(0)
    let allocationGeneration = 0
    const segmentBytes = 4 * 1024 * 1024
    const writeHeadroomBytes = 32 * 1024 * 1024
    try { localStorage.removeItem('seanime-wasm-disk-cache-v1') } catch (_) { /* Legacy metadata is disposable. */ }
    const ready = deleteMatchingKeys(key => key.indexOf('seanime-v1/') === 0 || key.indexOf('seanime-session/') === 0)

    async function configure(cache, info, url) {
      const identity = info.sha || info.path || String(info.size)
      if (activeIdentity === identity && sessionId !== null) return { totalBytes: policy.totalBytes, cacheId: `${identity}:${sessionId}` }
      if (Object.keys(entries).length || reservations.length) await clear()
      activeIdentity = identity
      sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      sourceUrl = url
      sourceBytes = info.size || 0
      const averageBytesPerSecond = info && info.duration > 0 && info.size > 0 ? info.size / info.duration : 0
      const timeBytes = cache.seconds === null || !averageBytesPerSecond ? Number.POSITIVE_INFINITY : Math.round(cache.seconds * averageBytesPerSecond)
      const requestedTotalBytes = Math.max(0, Math.floor(Math.min(cache.diskBytes || 0, timeBytes)))
      const generation = ++allocationGeneration
      preallocationTask = preallocate(requestedTotalBytes, generation)
      const reservedBytes = await preallocationTask
      if (generation !== allocationGeneration) return { totalBytes: 0, cacheId: `${identity}:${sessionId}`, warning: null }
      const totalBytes = reservedBytes
      policy = {
        totalBytes,
        forwardBytes: Math.round(totalBytes * cache.forwardPercent / 100),
        backBytes: totalBytes - Math.round(totalBytes * cache.forwardPercent / 100),
      }
      const warning = requestedTotalBytes - totalBytes >= segmentBytes
        ? totalBytes > 0
          ? `Only ${formatBytes(totalBytes)} of the requested ${formatBytes(requestedTotalBytes)} temporary cache could be reserved. Playback will continue with the smaller cache.`
          : `Temporary disk cache reservation failed. Playback will continue using the adaptive RAM cache.`
        : null
      record('disk-cache-policy', { ...policy, configuredBytes: cache.requestedBytes, requestedTotalBytes, seconds: cache.seconds, averageBytesPerSecond, warning })
      return { totalBytes, cacheId: `${identity}:${sessionId}`, warning }
    }

    async function preallocate(requestedBytes, generation) {
      if (!window.indexedDB || requestedBytes < segmentBytes) return 0
      const chunks = Math.floor(requestedBytes / segmentBytes)
      const data = new Uint8Array(segmentBytes).buffer
      let reservedBytes = 0
      record('disk-cache-preallocation-start', { requestedBytes, chunks })
      for (let index = 0; index < chunks && generation === allocationGeneration; index += 1) {
        const key = `seanime-session/reserve/${sessionId}/${index}`
        try {
          await storeFile(key, data)
          reservations.push({ key, size: segmentBytes })
          reservedBytes += segmentBytes
        } catch (reason) {
          record('disk-cache-preallocation-limited', { requestedBytes, reservedBytes, message: String(reason && reason.message || reason) })
          break
        }
      }
      if (reservedBytes > 0) await releaseReservation(Math.min(writeHeadroomBytes, reservedBytes))
      record('disk-cache-preallocation-complete', { requestedBytes, reservedBytes, heldBytes: reservations.reduce((sum, item) => sum + item.size, 0) })
      return reservedBytes
    }

    function releaseReservation(bytes) {
      const selected = []
      let released = 0
      while (reservations.length && released < bytes) {
        const item = reservations.shift()
        selected.push(item.key)
        released += item.size
      }
      if (!selected.length) return reservationRelease.then(() => 0)
      reservationRelease = reservationRelease.then(() => deleteKeys(selected)).then(() => {
        record('disk-cache-reservation-released', { entries: selected.length, bytes: released })
      })
      return reservationRelease.then(() => released)
    }

    function touch(kind, bytes, key) {
      const parts = String(key || '').split('/')
      const index = Number(parts[parts.length - 1])
      const media = parts.length >= 3 ? parts[parts.length - 2] : ''
      if (!media || !Number.isFinite(index) || bytes <= 0) return
      entries[key] = { key, media, index, size: bytes, lastUsed: Date.now() }
      record(`disk-cache-${kind}`, { key, bytes })
      if (kind === 'write') void releaseReservation(bytes)
      void prune({ key, media, index })
      schedulePrefetch(key, media, index)
    }

    function schedulePrefetch(key, media, index) {
      if (prefetchTimer !== null) clearTimeout(prefetchTimer)
      prefetchTimer = setTimeout(() => { prefetchTimer = null; void prefetch(key, media, index) }, 750)
    }

    async function prefetch(currentKey, media, currentIndex) {
      if (!sourceUrl || !sourceBytes || policy.forwardBytes < 4 * 1024 * 1024) return
      const generation = ++prefetchGeneration
      prefetchController?.abort()
      const controller = new AbortController()
      prefetchController = controller
      const prefix = currentKey.slice(0, currentKey.lastIndexOf('/') + 1)
      const maxSegments = Math.max(1, Math.floor(policy.forwardBytes / segmentBytes))
      for (let index = currentIndex + 1; index <= currentIndex + maxSegments && generation === prefetchGeneration; index += 1) {
        const start = index * segmentBytes
        if (start >= sourceBytes) break
        const end = Math.min(sourceBytes - 1, start + segmentBytes - 1)
        const key = `${prefix}${index}`
        if (entries[key]) continue
        try {
          const response = await fetch(sourceUrl, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal, cache: 'no-store' })
          if (response.status !== 206) throw new Error(`range request returned ${response.status}`)
          const data = await response.arrayBuffer()
          if (data.byteLength !== end - start + 1) throw new Error('range response was incomplete')
          await releaseReservation(data.byteLength)
          await storeFile(key, data)
          if (generation !== prefetchGeneration) break
          entries[key] = { key, media, index, size: data.byteLength, lastUsed: Date.now() }
          record('disk-cache-prefetch', { key, bytes: data.byteLength })
          await prune({ key: currentKey, media, index: currentIndex })
        } catch (reason) {
          if (!controller.signal.aborted) record('disk-cache-prefetch-stopped', { message: String(reason && reason.message || reason) })
          break
        }
      }
    }

    async function prune(current) {
      if (pruning) return
      pruning = true
      try {
        const all = Object.values(entries)
        const remove = new Set()
        const evictionOrder = (list, compare) => list.filter(item => !current || item.key !== current.key).sort(compare || ((a, b) => a.lastUsed - b.lastUsed))
        const trim = (list, limit, compare) => {
          let used = list.reduce((sum, item) => sum + item.size, 0)
          for (const item of evictionOrder(list, compare)) {
            if (used <= limit) break
            remove.add(item.key); used -= item.size
          }
        }
        if (current) {
          const sameMedia = all.filter(item => item.media === current.media)
          const behind = sameMedia.filter(item => item.index < current.index)
          const ahead = sameMedia.filter(item => item.index >= current.index)
          const behindUsed = behind.reduce((sum, item) => sum + item.size, 0)
          const aheadUsed = ahead.reduce((sum, item) => sum + item.size, 0)
          // Preserve contiguous playback windows. LRU can evict a prefetched
          // middle segment merely because the demuxer has not reached it yet,
          // leaving a hole while retaining less useful data farther away.
          trim(behind, policy.backBytes + Math.max(0, policy.forwardBytes - aheadUsed), (a, b) => a.index - b.index)
          trim(ahead, policy.forwardBytes + Math.max(0, policy.backBytes - behindUsed), (a, b) => b.index - a.index)
        }
        const remaining = all.filter(item => !remove.has(item.key))
        trim(remaining, policy.totalBytes, current ? (a, b) => Math.abs(b.index - current.index) - Math.abs(a.index - current.index) : undefined)
        if (policy.totalBytes <= 0) all.forEach(item => remove.add(item.key))
        if (!remove.size) return
        await deleteKeys(Array.from(remove))
        remove.forEach(key => { delete entries[key] })
        record('disk-cache-evicted', { entries: remove.size })
      } finally { pruning = false }
    }

    async function clear() {
      allocationGeneration += 1
      await preallocationTask.catch(() => 0)
      await reservationRelease
      const keys = [...Object.keys(entries), ...reservations.map(item => item.key)]
      entries = {}
      reservations = []
      activeIdentity = null
      sessionId = null
      sourceUrl = null
      sourceBytes = 0
      lastTimelineSignature = ''
      prefetchGeneration += 1
      if (prefetchTimer !== null) clearTimeout(prefetchTimer)
      prefetchTimer = null
      prefetchController?.abort()
      prefetchController = null
      if (keys.length) await deleteKeys(keys)
      record('disk-cache-session-cleared', { entries: keys.length })
    }

    function status() {
      const cached = Object.values(entries).sort((left, right) => left.index - right.index)
      const byteRanges = []
      for (const item of cached) {
        const start = item.index * segmentBytes
        const end = Math.min(sourceBytes, start + item.size)
        const previous = byteRanges[byteRanges.length - 1]
        if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
        else byteRanges.push({ start, end })
      }
      const timeRanges = []
      if (Module._seanime_time_for_byte) {
        const packetRanges = Module._seanime_byte_range_has_media
          ? byteRanges.filter(range => Module._seanime_byte_range_has_media(range.start, range.end))
          : byteRanges
        for (const range of byteRanges) {
          const containsPackets = packetRanges.indexOf(range) >= 0
          const followsPackets = packetRanges.some(media => media.end <= range.start && range.start - media.end <= policy.forwardBytes + segmentBytes)
          if (!containsPackets && !followsPackets) continue
          const start = Module._seanime_time_for_byte(range.start)
          const end = Module._seanime_time_for_byte(range.end)
          if (start < 0 || end <= start) continue
          const previous = timeRanges[timeRanges.length - 1]
          if (previous && start <= previous.end + 0.25) previous.end = Math.max(previous.end, end)
          else timeRanges.push({ start, end })
        }
      }
      const timelineSignature = timeRanges.map(range => `${range.start.toFixed(2)}-${range.end.toFixed(2)}`).join(',')
      if (timelineSignature !== lastTimelineSignature) {
        lastTimelineSignature = timelineSignature
        record('disk-cache-time-ranges', { byteRanges, timeRanges })
      }
      return {
        usedBytes: Object.values(entries).reduce((sum, item) => sum + item.size, 0),
        capacityBytes: policy.totalBytes,
        sourceBytes,
        byteRanges,
        timeRanges,
      }
    }

    function formatBytes(bytes) {
      return bytes >= 1024 * 1024 * 1024 ? `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB` : `${Math.round(bytes / (1024 * 1024))} MiB`
    }

    function deleteKeys(keys) {
      return new Promise(resolve => {
        if (!window.indexedDB || !keys.length) { resolve(); return }
        const request = indexedDB.open('emscripten_filesystem', 1)
        request.onerror = () => resolve()
        request.onsuccess = event => {
          try {
            const db = event.target.result
            const transaction = db.transaction(['FILES'], 'readwrite')
            const store = transaction.objectStore('FILES')
            keys.forEach(key => store.delete(key))
            transaction.oncomplete = () => { db.close(); resolve() }
            transaction.onerror = () => { db.close(); resolve() }
          } catch (_) { resolve() }
        }
      })
    }
    function storeFile(key, data) {
      return new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('IndexedDB is unavailable')); return }
        const request = indexedDB.open('emscripten_filesystem', 1)
        request.onerror = () => reject(new Error('Could not open the temporary cache'))
        request.onsuccess = event => {
          try {
            const db = event.target.result
            const transaction = db.transaction(['FILES'], 'readwrite')
            transaction.objectStore('FILES').put(data, key)
            transaction.oncomplete = () => { db.close(); resolve() }
            transaction.onerror = () => { db.close(); reject(new Error('Temporary cache write failed')) }
            transaction.onabort = () => { db.close(); reject(new Error('Temporary cache allocation was rejected')) }
          } catch (reason) { reject(reason) }
        }
      })
    }
    function deleteMatchingKeys(predicate) {
      return new Promise(resolve => {
        if (!window.indexedDB) { resolve(); return }
        const request = indexedDB.open('emscripten_filesystem', 1)
        request.onerror = () => resolve()
        request.onsuccess = event => {
          try {
            const db = event.target.result
            const transaction = db.transaction(['FILES'], 'readwrite')
            const store = transaction.objectStore('FILES')
            const cursor = store.openCursor()
            let removed = 0
            cursor.onsuccess = cursorEvent => {
              const current = cursorEvent.target.result
              if (!current) return
              if (predicate(String(current.key))) { current.delete(); removed += 1 }
              current.continue()
            }
            transaction.oncomplete = () => { db.close(); record('disk-cache-startup-cleanup', { entries: removed }); resolve() }
            transaction.onerror = () => { db.close(); resolve() }
          } catch (_) { resolve() }
        }
      })
    }
    return { configure, touch, clear, status, ready }
  })()

  class SeanimeWasmBridge {
    constructor() {
      this.bridgeId = ++bridgeSequence
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
      this.isBuffering = false
      this.lastBufferedSignature = ''
      this.lastBufferedLogAt = 0
      this.desiredPlaying = false
      this.seekTarget = null
      this.seekArrivalTime = null
      this.recoveryPending = false
      this.lastRecoveryAttempt = 0
      this.recoveryAttempts = 0
      this.recoveryNudged = false
      this.recoveryRestarted = false
      this.recoveryRestarting = false
      this.seekRequestedAt = 0
      this.nativeStopPromise = null
      this.nativeStopResolve = null
      this.fullyStopped = false
      this.seekCompletionResolve = null
      this.diskCacheFallbackWarned = false
      this.recoveryTimer = setInterval(() => this.recoverSeek(), 250)
      this.snapshotTimer = diagnostics ? setInterval(() => {
        if (activeBridge === this && Module._seanime_debug_snapshot) Module._seanime_debug_snapshot()
      }, 1000) : null
      activeBridge = this
      record('bridge-created', { bridgeId: this.bridgeId })
    }

    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }

    open(url, cache, media) {
      this.fullyStopped = false
      this.media = media
      this.pendingOpen = { url, cache, media }
      this.readyPromise = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
      record('open-requested', { bridgeId: this.bridgeId, bytes: media && media.mediaInfo && media.mediaInfo.size, hotRamBytes: cache.hotRamBytes, path: media && media.filePath })
    }

    async prepare() {
      record('runtime-wait', { bridgeId: this.bridgeId })
      await Promise.race([
        runtime,
        new Promise((_, reject) => setTimeout(() => reject(new Error('WASM runtime initialization timed out.')), 15000)),
      ])
      record('runtime-available', { bridgeId: this.bridgeId })
      await diskCache.ready
      const request = this.pendingOpen
      if (!request) throw new Error('No experimental playback source was provided.')
      const info = request.media && request.media.mediaInfo
      const video = info && info.video
      if (!info || !video) throw new Error('FFmpeg player requires Seanime media metadata.')
      this.lastState = 'PREPARING'
      await this.startNative(this.selectedAudio)
      return Promise.race([
        this.readyPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Samsung WASM media source did not become ready within 20 seconds.')), 20000)),
      ])
    }

    async startNative(audioIndex) {
      const request = this.pendingOpen
      const info = request.media.mediaInfo
      const video = info.video
      const audio = info.audios && info.audios[audioIndex]
      const videoCodec = video.mimeCodec || video.codec
      const audioCodec = audio && (audio.mimeCodec || audio.codec)
      const videoMime = `video/mp4; codecs="${videoCodec}"`
      const audioMime = audioCodec ? `audio/mp4; codecs="${audioCodec}"` : ''
      if (!nativeOpen) throw new Error('Native seanime_open binding is unavailable.')
      record('native-open', { bridgeId: this.bridgeId, videoMime, audioMime, audioIndex, bytes: info.size, forwardBufferSeconds: Math.max(3, Math.round(request.cache.forwardSeconds || 3)) })
      const sessionCache = await diskCache.configure(request.cache, info, request.url)
      if (sessionCache.warning) this.dispatch({ type: 'warning', message: sessionCache.warning })
      nativeOpen(request.url, sessionCache.cacheId, info.size, videoMime, audioMime, 'wasm-video', audioIndex, Math.max(16, Math.round(request.cache.hotRamBytes / 1048576)), Math.floor(sessionCache.totalBytes / 1048576), Math.max(3, Math.round(request.cache.forwardSeconds || 3)))
    }

    play() {
      this.desiredPlaying = true
      // A normal start has one asynchronous native Play request. Retrying it
      // before Samsung emits canplay supersedes that request and can leave the
      // media element permanently waiting. Seek recovery is armed separately
      // once the native demuxer confirms that the destination is buffered.
      this.recoveryPending = this.seekTarget !== null
      this.recoveryAttempts = 0
      this.recoveryNudged = false
      this.recoveryRestarted = false
      this.seekRequestedAt = Date.now()
      Module._seanime_play(); this.lastState = 'PLAYING'; record('play-requested', this.debugState())
    }
    pause() { this.desiredPlaying = false; this.recoveryPending = false; this.finishSeek(); Module._seanime_pause(); this.lastState = 'PAUSED'; record('pause-requested', this.debugState()) }
    seek(milliseconds) {
      record('seek-requested', { ...this.debugState(), milliseconds })
      this.seekTarget = milliseconds; this.seekArrivalTime = null; this.recoveryAttempts = 0; this.recoveryNudged = false; this.recoveryRestarted = false; this.seekRequestedAt = Date.now()
      Module._seanime_seek(milliseconds / 1000); this.lastTime = milliseconds
      this.recoveryPending = false
      return Promise.race([
        new Promise(resolve => { this.seekCompletionResolve = resolve }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Samsung seek did not become ready within 15 seconds.')), 15000)),
      ])
    }
    async waitForNativeStop() {
      if (this.nativeStopPromise) return this.nativeStopPromise
      if (!Module._seanime_stop) return
      record('native-stop-requested', this.debugState())
      this.nativeStopPromise = new Promise(resolve => { this.nativeStopResolve = resolve })
      Module._seanime_stop()
      await this.nativeStopPromise
      this.nativeStopPromise = null
      this.nativeStopResolve = null
    }
    async stop() {
      if (this.fullyStopped) return
      record('bridge-stop-start', this.debugState())
      this.desiredPlaying = false; this.recoveryPending = false; this.finishSeek(); clearInterval(this.recoveryTimer)
      await Promise.all([this.waitForNativeStop(), diskCache.clear()])
      this.fullyStopped = true
      this.lastState = 'IDLE'
      if (this.snapshotTimer !== null) clearInterval(this.snapshotTimer)
      this.snapshotTimer = null
      record('bridge-stop-complete', this.debugState())
      if (activeBridge === this) activeBridge = null
    }
    duration() { return Module._seanime_duration ? Module._seanime_duration() * 1000 : 0 }
    currentTime() { return Module._seanime_current_time ? Module._seanime_current_time() * 1000 : this.lastTime }
    state() { return this.lastState }
    bandwidth() { return Module._seanime_bandwidth ? Module._seanime_bandwidth() : null }
    buffered() {
      if (!Module._seanime_buffered_start || !Module._seanime_buffered_end) return []
      const start = Module._seanime_buffered_start()
      const end = Module._seanime_buffered_end()
      const ranges = start >= 0 && end > start ? [{ start, end }] : []
      const signature = ranges.map(range => `${range.start.toFixed(2)}-${range.end.toFixed(2)}`).join(',')
      if (signature !== this.lastBufferedSignature) {
        this.lastBufferedSignature = signature
        const now = Date.now()
        if (now - this.lastBufferedLogAt >= 500 || !ranges.length) { this.lastBufferedLogAt = now; record('buffered-ranges', { ranges }) }
      }
      return ranges
    }
    cacheStatus() { return diskCache.status() }
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
      const wasPlaying = this.desiredPlaying
      void this.waitForNativeStop().then(() => {
        this.readyPromise = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
        return this.startNative(index)
      }).then(() => this.readyPromise).then(() => {
        Module._seanime_seek(position / 1000)
        if (wasPlaying) Module._seanime_play()
      }).catch(() => undefined)
    }
    setSubtitlesEnabled() { /* Subtitles are rendered by the React/libass layer. */ }

    debugState() {
      const cache = diskCache.status()
      return {
        bridgeId: this.bridgeId, active: activeBridge === this, state: this.lastState,
        desiredPlaying: this.desiredPlaying, prepared: this.prepared, buffering: this.isBuffering,
        seekTarget: this.seekTarget, seekArrivalTime: this.seekArrivalTime,
        recoveryPending: this.recoveryPending, recoveryAttempts: this.recoveryAttempts,
        recoveryNudged: this.recoveryNudged, recoveryRestarted: this.recoveryRestarted,
        nativeStopPending: Boolean(this.nativeStopPromise), fullyStopped: this.fullyStopped,
        lastTime: this.lastTime, cacheUsedBytes: cache.usedBytes, cacheCapacityBytes: cache.capacityBytes,
        cacheEntries: cache.byteRanges.length,
      }
    }

    emit(type, value, message) {
      if (type !== 'time') record(`native-${type}`, { ...this.debugState(), value, message })
      if (type === 'disk-cache-hit' || type === 'disk-cache-write') { diskCache.touch(type === 'disk-cache-hit' ? 'hit' : 'write', value, message); return }
      if (type === 'disk-cache-fallback') {
        record('disk-cache-storage-fallback', { bytes: value, key: message })
        if (!this.diskCacheFallbackWarned) {
          this.diskCacheFallbackWarned = true
          this.dispatch({ type: 'warning', message: 'Temporary disk cache could not store a media segment. Playback is continuing from RAM and the network.' })
        }
        return
      }
      if (type === 'stopped') {
        record('native-stop-complete')
        this.nativeStopResolve && this.nativeStopResolve()
        return
      }
      if (type === 'seek-ready') {
        record('native-seek-ready', { target: value, desiredPlaying: this.desiredPlaying })
        if (this.desiredPlaying) {
          // ResumeMain pauses the media element and OnCanPlay performs the
          // primary resume. Only arm the slower watchdog after packets exist.
          this.seekRequestedAt = Date.now()
          this.lastRecoveryAttempt = 0
          this.recoveryPending = true
        } else {
          this.seekTarget = null
          this.seekArrivalTime = null
          this.finishSeek()
          this.clearBuffering()
        }
        return
      }
      if (type === 'ready') { this.lastState = 'READY'; this.prepared = true; this.clearBuffering(); this.readyResolve && this.readyResolve(); return }
      if (type === 'playing') { this.lastState = 'PLAYING'; this.recoveryPending = false; this.recoveryAttempts = 0; this.finishSeek(); this.clearBuffering(); return }
      if (type === 'paused') {
        this.lastState = this.desiredPlaying ? 'BUFFERING' : 'PAUSED'
        if (this.desiredPlaying && this.seekTarget !== null) {
          record('seek-recovery-pending', { target: this.seekTarget })
          this.recoveryPending = true
        }
        return
      }
      if (type === 'time') {
        this.lastTime = value
        if (this.seekTarget === null) this.clearBuffering()
        else if (Math.abs(value - this.seekTarget) <= 20000) {
          if (this.seekArrivalTime === null) this.seekArrivalTime = value
          else if (Math.abs(value - this.seekArrivalTime) >= 100) { this.seekTarget = null; this.seekArrivalTime = null; this.recoveryPending = false; this.clearBuffering() }
        }
        this.dispatch({ type: 'time', milliseconds: value }); return
      }
      if (type === 'buffering') {
        if (!this.isBuffering) { this.isBuffering = true; this.dispatch({ type: 'buffering', percent: 0 }) }
        return
      }
      if (type === 'play-rejected') {
        record('recoverable-play-rejection', { result: value, desiredPlaying: this.desiredPlaying })
        if (this.desiredPlaying) {
          this.lastState = 'BUFFERING'
          this.recoveryPending = true
          if (!this.isBuffering) { this.isBuffering = true; this.dispatch({ type: 'buffering', percent: 0 }) }
        }
        return
      }
      if (type === 'complete') { this.lastState = 'COMPLETE'; this.dispatch({ type: 'complete' }); return }
      if (type === 'error') {
        const error = message || 'Experimental WASM playback failed.'
        this.lastState = 'ERROR'; this.readyReject && this.readyReject(new Error(error)); this.dispatch({ type: 'error', message: error })
      }
    }
    clearBuffering() {
      if (!this.isBuffering) return
      this.isBuffering = false
      this.dispatch({ type: 'buffering', percent: 100 })
    }
    finishSeek() {
      if (!this.seekCompletionResolve) return
      const resolve = this.seekCompletionResolve
      this.seekCompletionResolve = null
      resolve()
    }
    recoverSeek() {
      if (!this.recoveryPending || this.recoveryRestarting || !this.desiredPlaying || !Module._seanime_play) return
      const now = Date.now()
      if (now - this.seekRequestedAt < 750) return
      // Give an accepted asynchronous Play request time to resolve. Rapid
      // retries cancel one another on Samsung's HTMLMediaElement controller.
      if (now - this.lastRecoveryAttempt < 2000) return
      this.lastRecoveryAttempt = now
      if (this.seekTarget !== null && this.recoveryAttempts >= 3 && !this.recoveryNudged) {
        const duration = this.duration()
        const nudgedTarget = duration > 1000 ? Math.min(this.seekTarget + 250, duration - 1000) : this.seekTarget + 250
        this.recoveryNudged = true
        this.recoveryAttempts = 0
        record('seek-recovery-nudge', { target: this.seekTarget, nudgedTarget })
        Module._seanime_seek(nudgedTarget / 1000)
        return
      }
      if (this.recoveryAttempts >= 6) {
        if (!this.recoveryRestarted) { void this.restartAfterStall(); return }
        this.recoveryPending = false
        record('seek-recovery-exhausted', { target: this.seekTarget, restarted: true })
        this.dispatch({ type: 'error', message: 'Samsung playback remained stuck after seek recovery. Return to the episode and try again.' })
        return
      }
      this.recoveryAttempts += 1
      record('seek-recovery-attempt', { target: this.seekTarget })
      Module._seanime_play()
    }
    async restartAfterStall() {
      if (this.recoveryRestarting || !this.pendingOpen) return
      this.recoveryRestarting = true
      this.recoveryRestarted = true
      this.recoveryAttempts = 0
      const target = this.seekTarget ?? Math.max(0, this.lastTime)
      record('seek-recovery-restart', { target, audioIndex: this.selectedAudio })
      try {
        await this.waitForNativeStop()
        this.readyPromise = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
        await this.startNative(this.selectedAudio)
        await Promise.race([this.readyPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('seek recovery restart timed out')), 15000))])
        if (target > 0) Module._seanime_seek(target / 1000)
        Module._seanime_play()
        this.seekRequestedAt = Date.now()
        this.recoveryPending = true
      } catch (reason) {
        const message = `Seek recovery failed: ${String(reason && reason.message || reason)}`
        record('seek-recovery-restart-failed', { message })
        this.recoveryPending = false
        this.dispatch({ type: 'error', message })
      } finally { this.recoveryRestarting = false }
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
        nativeOpen = Module.cwrap('seanime_open', null, ['string', 'string', 'number', 'string', 'string', 'string', 'number', 'number', 'number', 'number'])
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
