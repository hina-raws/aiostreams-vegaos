# Roadmap and where help is wanted

The port runs, browses, and plays video. What follows is what it does not do yet, in rough order of
value, with the shape a fix would take. `PORTING_NOTES.md` has the measurements behind each item.

## 1. Sound for lossless-only versions

The gap that matters most. This WebView decodes no Dolby and no DTS — only AAC, MP3, Opus and FLAC — and
the AIOStreams server only direct plays, so a version whose only audio track is TrueHD or DTS-HD plays
mute. The client now marks such versions and prefers playable ones, which cannot help a title where
every version is lossless.

Ways forward, none of them small:

- **Server-side negotiation.** AIOStreams serves the debrid file as it is. An audio-only remux or an
  audio transcode on the server would settle this for every client, not just Vega. The client already
  knows how to ask for a server conversion (`lib/playback/transcoding.ts`, `deviceProfile`), so a server
  that answers would light that path up unchanged.
- **A native player path.** Vega's own media stack has Dolby Digital and Dolby Digital Plus pass-through
  modes (`SinkFormatsSelectionPolicy`). A Vega player component behind the client's `play()` host hook
  could use it — the client supports that hook (`Host.play`), so the work is the player, not the client.
- **Ask Amazon for Dolby in the WebView.** The OS supports it; the WebView does not expose it. A bug
  report from more than one app would carry more weight than from one.

## 2. Subtitles and trailers from hosts that send no CORS headers

The webOS package needed a small service for this: subtitle files and fonts from hosts without CORS
headers, and YouTube trailer streams. The Vega shell has no equivalent. The client already has the hook
for it — `Host.fetchFile` — so this is a bridge: `postMessage` a URL to the shell, fetch it with React
Native's `fetch` (which is not subject to the page's CORS rules), and answer with
`injectJavaScript`. Subtitles and trailers are both untested on the device; test them before building.

## 3. Screensaver during playback

The client holds the screen awake with the Page Wake Lock API (`lib/hosts/wake-lock.ts`). Whether that
API exists in this WebView is unverified, and a screensaver over a playing video would be an obvious bug.
Check first; if it is missing, `Host.keepAwake` needs a Vega-side implementation.

## 4. Performance measurement

The app has never been measured against the platform's KPI targets — time to first frame, time to fully
drawn, UI fluidity, key-input latency. The Vega SDK has tools for all of these, and a WebView app is
measured like any other app for launch and input, with the page's own work inside the WebView. A baseline
before any tuning would be the first deliverable.

## 5. Device coverage

Verified on one device: Fire TV Stick 4K (`AFTCR001`, armv7). Untested: Fire TV Cube, Fire TV Stick 4K
Max, Fire TV 4K Select, and anything with a different GPU or audio path. Reports of what works, with
`vega device info` output attached, are genuinely useful.

## 6. Upstreaming

- The branch is the pull request: `aiostreams-vegaos` against `main`. The client changes are written to
  upstream's own idiom — a host entry beside `webos`/`tizen` in `src/lib/hosts/`, a module beside
  `device-profile` — so they review as additions rather than a fork.
- `packages/vega` could take its build script from `packages/smart-tv` (`build:webos` / `build:tizen`
  build the client first, then package it) so all three TV targets share one build and ride the
  project's release train. The audio notices and the `vega` host are the parts that would benefit most
  from upstream review, since they touch every client.

## 7. Smaller things

- The shell's failure screen is a bare message; it could offer Retry and Exit, as the webOS `boot.js`
  overlay does.
- `manifest.toml` has no icon, so the system default is used.
- One jest test covers the shell. The bridge's exit path is only covered by device testing.
