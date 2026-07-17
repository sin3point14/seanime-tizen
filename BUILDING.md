# Building Seanime TV

## Web application

Install Node.js 22 and run:

```powershell
npm ci
npm test
npm run build
```

## Samsung TV package on Windows

Install Tizen Studio with the Web CLI, Samsung TV extensions, and Certificate Manager. Create a Samsung certificate profile that includes the target TV's DUID, enable Developer Mode on the TV, and connect it with `sdb`.

```powershell
$env:TIZEN_CERT_PROFILE = "SeanimeTV"
$env:TIZEN_DEVICE = "TV_IP:26101"
npm run tizen:deploy
```

The deployment command builds, signs, installs, and launches the WGT. Certificate files and passwords must stay outside the repository.

## Rebuilding the native WASM player

Normal web builds use the checked-in native artifacts. Rebuilding them additionally requires Samsung's modified Emscripten 1.39.4.7 SDK with FFmpeg 4.3.1 support:

```powershell
npm run wasm:check
npm run wasm:build
```

The required build flags include `ENVIRONMENT_MAY_BE_TIZEN`, pthreads, one pthread worker, Fetch, and FFmpeg. The native source is in `native/wasm-player/`.

## Diagnostics

Diagnostics are compile-time disabled in release builds. For a temporary TV diagnostic build:

```powershell
node scripts/diagnostic-server.mjs
$env:VITE_DIAGNOSTICS = "true"
$env:VITE_DIAGNOSTIC_ENDPOINT = "http://LAPTOP_LAN_IP:8765/log"
npm run tizen:deploy
```

Optional `VITE_DIAGNOSTIC_AUTOPLAY`, `VITE_DIAGNOSTIC_AUTO_SEEK_SECONDS`, and `VITE_DIAGNOSTIC_REOPEN_CYCLES` values drive automated player tests. Logs are written under the ignored `diagnostics/` directory.

## Releases

`.github/workflows/release.yml` runs only for `v*` tags or manual dispatch. It installs the Tizen Web CLI, tests the app, creates a release build, and signs the WGT using secrets in the protected `release` environment:

- `TIZEN_AUTHOR_P12_BASE64`
- `TIZEN_AUTHOR_PASSWORD`
- `TIZEN_DISTRIBUTOR_P12_BASE64`
- `TIZEN_DISTRIBUTOR_PASSWORD`

The Samsung distributor certificate determines which TV DUIDs may install the WGT. The workflow also publishes the web bundle for users who need to sign it with their own certificate.
