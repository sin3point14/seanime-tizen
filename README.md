# Seanime TV for Samsung Tizen

A remote-first, personal-sideload TV client for a Seanime server. It targets Samsung TVs with Tizen 6.0 or newer and plays server-local files directly through Samsung AVPlay.

[![CI](https://github.com/sin3point14/seanime-tizen/actions/workflows/ci.yml/badge.svg)](https://github.com/sin3point14/seanime-tizen/actions/workflows/ci.yml)

## Features

- Local library, continue watching, ranked local search, details, and episode availability
- AVPlay playback with remote media keys, seeking, audio/subtitle tracks, resume, progress sync, and auto-next
- Persisted server, signed client identity, track preferences, and versioned player settings
- No torrents, debrid, online streaming, downloads, manga, or library editing

Direct playback depends on codecs supported by the TV. This client does not transcode or choose alternate sources.

## Development

```powershell
npm install
npm test
npm run build
```

Open the Vite development server in a desktop browser to review browsing screens. Playback intentionally reports that AVPlay is unavailable outside a Samsung TV.

GitHub Actions runs the test suite and production web build for every push and pull request. Successful runs publish the `dist` directory as a short-lived workflow artifact. Signed WGT packages remain a local operation so Samsung certificate material never enters CI.

## Samsung TV deployment

Install the Samsung TV Extension and Samsung Certificate Extension in Tizen Studio. Create a Samsung author/distributor certificate profile containing the target TV's DUID. Keep all certificates and passwords outside this repository.

With Developer Mode enabled on the TV and SDB connected:

```powershell
$env:TIZEN_CERT_PROFILE = "YourSamsungProfile"
$env:TIZEN_DEVICE = "192.168.1.38:26101" # optional SDB serial; first connected device is used otherwise
npm run tizen:deploy
```

Individual `tizen:build`, `tizen:package`, `tizen:install`, and `tizen:launch` commands are also available. The package script never stores certificate material in the project.

The deployment script resolves the Samsung target name from the SDB serial and creates a space-free WGT filename. Both are required by some recent Samsung TV installers even though file transfer with a serial or spaced name can appear to work.

At first launch, enter the LAN URL of the Seanime server and its optional password. HTTP is supported for home-network servers through the wildcard Tizen access policy.
