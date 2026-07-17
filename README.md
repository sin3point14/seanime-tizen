# Seanime TV

A remote-first Seanime anime client for Samsung televisions running Tizen 9.

## Features

- Browse and search the Seanime library, including recent searches and large episode lists.
- Direct-stream local H.264/H.265 media with audio and subtitle track selection.
- Resume and progress tracking through Seanime, track persistence, and automatic next episode.
- Remote-native seeking, playback diagnostics, configurable buffering, and temporary RAM/disk caching.
- Samsung AVPlay fallback when the custom player or media format is unsupported.

## Standout playback support

**ASS subtitles:** ASS/SSA tracks are rendered with JASSUB/libass, including authored fonts, sizes, positioning, signs, and karaoke. Embedded font attachments are loaded when Seanime exposes them. A simpler text renderer remains available.

**Custom WASM player:** FFmpeg demuxes containers such as MKV in a worker while Samsung's Elementary Media Stream Source performs hardware audio/video decoding. It adds ranged reads, multiple audio tracks, seek-aware temporary caching, packet-mapped cache visualization, and automatic AVPlay fallback. It exists because AVPlay does not expose a controllable retained network cache or reliable container-level diagnostics.

The defaults are tested on a Samsung S90F (`QA55S90F`): the WASM player, a 300-second/1 GiB temporary cache with 80% allocated forward, authored ASS styles, and the network-cache timeline.

## Install and build

Release WGTs are signed for the test television's DUID. Other televisions must rebuild or re-sign the app with a Samsung certificate containing their own DUID. See [BUILDING.md](BUILDING.md).

This project was built with help from [OpenAI Codex](https://openai.com/codex/).
