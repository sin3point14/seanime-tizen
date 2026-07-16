# Seanime TV for Samsung Tizen

A remote-first Seanime client targeting 2025 Samsung televisions running Tizen 9.

## Playback features

- Samsung AVPlay direct playback for locally hosted anime, including H.264/H.265 MKV when supported by the television
- Audio/subtitle track persistence, Seanime resume and progress tracking, and automatic next episode
- Real ASS/SSA rendering through libass/JASSUB with embedded font attachments, plus SRT/VTT fallback
- Immediate cumulative remote seeking, manual AVPlay startup/recovery thresholds, and stream diagnostics
- Search history and a remote-navigable settings interface
- An opt-in FFmpeg 4.3.1/Samsung WASM Player backend with ranged reads, a bounded LRU byte cache, eligibility checks, diagnostics, and automatic AVPlay fallback

The experimental backend is compiled with Samsung's modified Emscripten 1.39.4.7 SDK. It is intentionally opt-in and returns to AVPlay if FFmpeg demuxing or Samsung hardware-track initialization fails. The app never displays an estimated buffered timeline; the experimental byte cache currently reports bandwidth but does not claim byte ranges as playable timeline ranges.

## Development

```powershell
npm install
npm test
npm run build
```

Playback requires a Samsung TV. Browsing screens can be reviewed through Vite in a desktop browser.

## Samsung TV deployment

Install the TV and Certificate extensions in Tizen Studio and create a Samsung certificate profile containing the TV DUID. Certificate material must remain outside this repository.

```powershell
$env:TIZEN_CERT_PROFILE = "SeanimeTV"
$env:TIZEN_DEVICE = "TV_IP_ADDRESS:26101"
npm run tizen:deploy
```

The existing deployment script builds Vite, creates a signed WGT, installs it, and launches the application. This manifest intentionally requires Tizen 9.0.

## Experimental native backend prerequisites

- Tizen Studio with the Samsung TV extensions
- Samsung's modified Emscripten SDK 1.39.4.7
- FFmpeg/libavformat built without GPL or nonfree components
- Required flags: `-s ENVIRONMENT_MAY_BE_TIZEN -pthread -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=1`

Run `npm run wasm:build` to rebuild the native artifacts. The current implementation uses synchronous ranged browser fetches from a demux pthread, FFmpeg custom AVIO, a bounded hot-RAM LRU cache, a three-second Samsung packet queue, and Elementary Media Stream Source hardware decoding. A persistent sparse disk tier remains future work; the UI does not mislabel the RAM cache as persistent storage.
