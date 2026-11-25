# Porting notes

An engineering log for the Vega OS port of the AIOStreams web client: how it is put together, what
broke on the way, and what the device turned out to be capable of. Everything here was observed on the
hardware and in the code; nothing is projected from another platform.

Test device: Fire TV Stick 4K, product `carnival` (`AFTCR001`), Vega OS `2.0 (TV Ship/90)`,
Vega WebView `Chrome/144.0.7559.246`.

---

## 1. Why a WebView app

The client already is a TV app. `packages/web` in AIOStreams ships to LG webOS and Samsung Tizen as a
*standalone* build — relative asset paths, its own server picker — inside a platform manifest
(`packages/smart-tv`). It lays out at 1280×720, runs its own D-pad focus engine, and plays through its
own `<video>` with hls.js over MSE.

So the port is not a rewrite. It is a Vega package holding that same build:

- the shell is one screen: a `<WebView>` on `file:///pkg/assets/index.html`;
- the client's own host-adapter interface (`src/lib/hosts/`) gains a `vega` entry next to `webos`,
  `tizen`, `android` and `desktop`;
- everything else — routing, state, playback, i18n — is upstream code, reused as it is.

The alternative, rewriting the UI in React Native for Vega, would have discarded a working TV client to
reproduce it. It is worth revisiting only for the audio limitation in §6.

## 2. Architecture

```
Fire TV
└── AIOStreams (com.amazondeveloper.aiostreamsvega)
    ├── manifest.toml            components, media/audio/IME services, cleartext policy
    └── React Native for Vega shell (src/App.tsx)
        └── <WebView source={{uri: 'file:///pkg/assets/index.html'}}>
            └── AIOStreams web client (packages/web, standalone build)
                ├── talks to the user's AIOStreams/Jellyfin server over HTTPS or HTTP
                └── plays through its own <video> element (MSE / hls.js)
```

**What crosses the boundary.** The WebView sets `onMessage`, which puts
`window.ReactNativeWebView` in the page. The client's `vega` host adapter detects it and:

- names the host `vega` → `data-host="vega"`, TV layout on (`src/lib/tv.ts`);
- quits the app on Back from the first page, by posting `{"type":"exit"}`, which the shell answers
  with `BackHandler.exitApp()`.

Nothing else uses the bridge yet. Screen size, D-pad, focus, playback, storage and the network all stay
inside the page.

**Build data flow.** `scripts/sync-web.mjs` builds `@aiostreams/web` with `--env-mode standalone`
(relative asset prefix) and copies `dist-standalone/` to `assets/`, then deletes
`static/webgpu-player`. The Vega packager copies the project's `assets/` into the package, readable at
`/pkg/assets` without `allowFileAccess`.

## 3. The client changes, file by file

The changes to `packages/web` are this branch's commits against `main` (AIOStreams `v2.38.1`);
`git diff main...aiostreams-vegaos -- packages/web` is the whole of them.

| File | Change and why |
| --- | --- |
| `src/lib/hosts/vega/index.ts` *(new)* | The host adapter: `name: 'vega'`, `tv: true`, `device()` for the server's device list, `exit()` over the bridge |
| `src/lib/hosts/index.ts` | Registers it ahead of the browser fallback |
| `src/lib/input/keys.ts` | Vega's key codes: `27` Back, `179` play/pause, `227` rewind, `228` fast-forward. Vega sends Back as `keyCode 27` / `key: 'GoBack'`; the client knew only webOS/Tizen's `10009`/`461` |
| `src/lib/playback/audio-support.ts` *(new)* | Asks the device which audio codecs it decodes (`mediaCapabilities` primed at startup, `canPlayType`/MSE as fallback), and names the ones that cannot play |
| `src/lib/jellyfin/playback-info.ts` | The version list now requests `MediaStreams`, so a version's codecs are known before it is played |
| `src/features/versions/version-list.tsx` | Each version whose sound cannot play is marked in the list, naming the codec |
| `src/app/player/page.tsx` | Play starts on the first version whose sound plays, when the default one would not; a version picked by name plays as picked, with a notice |
| `src/lib/playback/video.ts` | Marks in-file audio tracks unplayable by codec, for engines that do expose a track list |
| `src/lib/playback/audio-tracks.ts` | Track ranking prefers sound this device can decode |
| `src/main.tsx` | Primes the codec answers before the first render, beside the language |

Two user-visible strings are added. The branch carries them in the locale catalogs; if you change or
add strings yourself, run `pnpm -F @aiostreams/web i18n:extract` from the repository root afterwards.
Without it the notices render as message ids (`tq-XnU`) rather than text — we hit exactly that on the
device.

## 4. Bugs and how they were found

### 4.1 `vega device list` shows nothing over the network

`device list` lists devices VDA already knows. Over TCP/IP you must connect first:

```sh
vega exec vda connect <device-ip>:5555     # then `vega device list` shows it
```

### 4.2 The Virtual Device cannot run this app

```
Module dependency not found: /com.amazon.kepler.webview_4@IWebview_4
The Vega Virtual Device is missing modules that are available on a physical device.
```

Documented VVD limitation: no WebView on Ubuntu or Intel Macs. Every later finding in this document
came from a physical Fire TV Stick 4K.

### 4.3 The app installed and died with `SIGABRT` in half a second

The worst of them, because nothing pointed at the cause. Symptom: install succeeded, launch succeeded,
the process aborted before the first frame, every time.

- The crash report (`vega device copy-logs -a SYSTEM_TOMBSTONE/acr`) showed `SIGABRT`, thread 0 in
  `libc` → `libstdc++` → `liblcm_client.so` → `libappfwkutils_async.so` → `libstem_init.so`, i.e. a C++
  exception during app-framework start-up. No application frames.
- **Bisecting:** the same device ran the plain `KeplerProject` React Native sample, so the framework was
  fine. Replacing our `App.tsx` with a bare `<View><Text>` and emptying the manifest changed nothing.
- **Cause:** the package had `bundle/assets/` but no `index.hermes.bundle`. `vega build` packages the
  native side only; the JavaScript bundling is done by the React Native CLI plugin. `npm run build:debug`
  runs `react-native build-vega`, which bundles first — and the app started.
- **Guard:** check `build/private/vega/<arch>/Debug/bundle/index.hermes.bundle` exists before installing.

### 4.4 Every request failed with `net::ERR_CLEARTEXT_NOT_PERMITTED`

The page loaded, but nothing reached the server, even though `curl` from the device's own shell got
200 from the same URL. WebView 4.0.2 (RN 0.83) blocks plain HTTP unless the app allows it:

```toml
[network-traffic-policy.cleartext]
allowed-domains = ["*"]
```

Needed because a self-hosted AIOStreams server is often plain http on a LAN.
`mixedContentMode="always"` alone does not do this.

### 4.5 A 404 on one image replaced the whole UI

`onError` fires for subresources too. A missing `/logo.png` set the failure overlay over a working app.
The shell now ignores errors for anything outside the package (`file:///pkg/`).

### 4.6 `navigator.gpu` exists, and no adapter does

The WebView exposes `navigator.gpu`; `requestAdapter()` resolves to `null`. The client's
`canPlayWithWebGpu()` tests for the property's presence, so it would have chosen the WebGPU player —
whose assets cannot run. `injectedJavaScriptBeforeContentLoaded` deletes `navigator.gpu` before the page
scripts run, leaving the client on `<video>` and MSE, which the device does support.

The WebGPU player is 9.2 MB of wasm and JavaScript, so `sync-web.mjs` also leaves it out of `assets/`.

### 4.7 Lossless audio played as silence

Covered in §6; the fix spans the capability module, the version list, the player and the track picker.

### 4.8 Removing files from `assets/` kept them in the package

The build stages into `build/private/vega/<arch>/<type>/assets` and copies over it without clearing, so
a deleted asset survives. Measured: after dropping 9.2 MB of WebGPU assets the `.vpkg` was still
5.85 MB until `vega clean` — then 2.9 MB.

### 4.10 The launcher drew its default tile

The app installed and ran, but "Your apps and channels" showed an unmarked square: the manifest had no
`[package] icon`, which is a required field (512×512 PNG at `assets/image/`, max 1 MB), and the build had
said so in its output all along — `[package.icon] Icon is not defined in the manifest. System default
will be used.` The tile now draws the AIOStreams mark and is named after the manifest's `title`. The icon
lives in `icon/` and `sync-web.mjs` copies it into `assets/image/`, because a sync replaces `assets/` and
the icon must ship inside the package.

### 4.11 Testing notes

- The device drops to standby quickly and then `com.amazon.dev.shell.service` is gone: `vega device shell`,
  `device info` and screenshots all fail while ping and VDA still answer.
- Screenshots of playback are black: video is drawn on a hardware surface the screener does not read.
  Judge playback from the logs (`MediaServer*`, `AmazonVideoDecoderIdl`, `MEDIA_METRICS`) and from what
  you hear.
- The most useful instrument was the WebView's own DevTools:
  `vega exec vda forward tcp:9229 tcp:9229`, then `/json/list` and CDP. It gives the page's DOM, its
  console, and `mediaCapabilities` verdicts on the real device. Release builds are not debuggable —
  install a Debug build to inspect.

## 5. What the device can actually do

Measured on the device, in the page, through DevTools.

### Player and layout

| | |
| --- | --- |
| WebView engine | `Chrome/144.0.7559.246` (`Kepler 2.0`, `AFTCR001`) |
| Page viewport | 1280×720 on a 1920×1080 screen, `devicePixelRatio` 1 — the client's TV layout, as designed |
| MSE | available; `SourceBuffer` as Chromium does |
| WebGPU | `navigator.gpu` present, **no adapter** |
| `HTMLMediaElement.audioTracks` | **absent** — a page cannot list or switch a file's audio tracks |
| `mediaPlaybackRequiresUserAction` | defaults to true; set to false, or a title only plays after a tap |

### Video codecs

| Codec | `canPlayType` | MSE |
| --- | --- | --- |
| H.264 | `probably` | ✅ |
| HEVC (Main 10, 4K) | `probably` | ✅ |
| VP9 | `probably` | ✅ |
| AV1 | — | ❌ |

4K HEVC Main 10 confirmed in playback:
`Initializing AmazonVideoDecoderIdl with config: codec: hevc, profile: hevc main 10, coded size: [3840,2160]`.

### Audio codecs

`navigator.mediaCapabilities.decodingInfo()` and `canPlayType`/MSE agree:

| Codec | file | media-source |
| --- | --- | --- |
| AAC, MP3, Opus, FLAC | ✅ | ✅ |
| AC-3 (Dolby Digital) | ❌ | ❌ |
| E-AC-3 (Dolby Digital Plus) | ❌ | ❌ |
| TrueHD / MLP | ❌ | ❌ |
| DTS, DTS-HD | ❌ | ❌ |

The OS is not the limitation: Vega's native audio API documents HDMI sink modes for PCM, Dolby Digital
and Dolby Digital Plus (`SinkFormatsSelectionPolicy`: `AUTO`, `ENFORCE_PCM`, `PASSTHROUGH_DD`,
`PASSTHROUGH_DDP`, `ENFORCE_DDP`). The **WebView** does not expose Dolby decode or passthrough to a
page, and AIOStreams has no transcoding to fall back on — its server reports
`SupportsTranscoding: false` and its HLS route answers *"Transcoding is not available; this server only
direct plays."*

So on this device: AAC works, lossless does not, and the Dolby Digital compatibility track that
accompanies TrueHD in a remux does not rescue it either.

### Package size

| | |
| --- | --- |
| Client `assets/` as built | 20 MB |
| after dropping `static/webgpu-player` | 9.9 MB |
| `.vpkg` (armv7) | 5.85 MB → **2.9 MB** |

## 6. The audio fix

The client used to pick an audio track by language and default flags only, never by codec; and the
version list had no idea what a version carried. With the server unable to convert, the only leverage is
**which version is played** — the page cannot switch tracks inside a file.

Implemented:

1. **Ask the device.** `audio-support.ts` primes `mediaCapabilities.decodingInfo` for every codec name at
   startup and falls back to `canPlayType`/MSE. A codec it has no question for counts as playable, so it
   can never hide working sound.
2. **Know what a version carries.** The version list asks the server for `MediaStreams`
   (`LISTED_FIELDS`), which the AIOStreams server builds from the release name.
3. **Say it before picking.** Each version in the list gets an amber line, for example
   *"Sound (Dolby TrueHD, Dolby Digital) can't be played on this device"*.
4. **Play the right one.** Play starts on the first version whose sound plays when the default one would
   not; a version named explicitly is kept as picked.
5. **Say it in the player**, when a mute version is played anyway.
6. **Track level, where it exists.** In-file tracks are marked unplayable by codec so that a device
   which does expose `audioTracks` (a future WebView, or another TV platform) picks the right track.

Limit, measured: Iron Man (2008) in the test library has six versions — `truehd` + `ac3`, `truehd`,
`truehd`, `dts`, `dts`, `eac3` — **none with AAC**, so none can play with sound on this hardware. The
warning is the correct outcome; making it audible needs a release with AAC, a server that converts, or
Amazon widening the WebView's audio support.

## 7. Verification performed

| Check | How | Result |
| --- | --- | --- |
| Package builds, all `tv` targets | `npm run build:release` | armv7 / x86_64 / aarch64 |
| Assets land in the package | `build/private/vega/<arch>/<type>/assets/index.html` | present, served from `file:///pkg/assets/` |
| Shell unit test, types, lint | `npm test`, `tsc --noEmit`, `eslint` | pass (one informational warning for using a system-distributed library) |
| Client types and lint | `pnpm -F @aiostreams/web typecheck`, `eslint` | pass |
| App launches, Debug and Release | install + launch on the Fire TV | runs; no LogBox in Release |
| Host detection and TV layout | DevTools: `data-host="vega"`, viewport meta | 1280×720 layout, DPR 1 |
| D-pad focus | remote key injection (`inputd-cli button_press KEY_DOWN`) | focus moves, focus ring drawn |
| Back leaves the app | `KEY_BACK` at the root screen | app exits through the bridge |
| Server over https, and http | sign-in against a real instance | Quick Connect and sign-in reached |
| Playback | 4K HEVC Main 10 stream | decoder initialised, video played |
| Audio: AAC | same file family with AAC | audio plays |
| Audio: TrueHD, DTS-HD | the same files | silent, as the device reports |
| Audio notices on device | DevTools DOM read | six versions marked, each with the right codec names |
| Crash-free session | device log stream, ACR tombstones | no crash, no ANR, 0 slow frames in the sampled session |
