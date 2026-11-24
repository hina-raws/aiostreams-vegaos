# AGENTS.md

Guidance for AI coding agents working in this repository. Read it before changing anything; the
conventions here are what keep the port reviewable and the app working on real hardware.

## What this repository is

A fork of [AIOStreams](https://github.com/Viren070/AIOStreams) that adds an Amazon Vega OS (Fire TV)
app for the project's web client.

- `main` — the upstream baseline. **Do not commit to it.**
- `aiostreams-vegaos` — the port. All port work goes here, as commits that upstream could review.

Two pieces make up the port:

| Path | What it is |
| --- | --- |
| `packages/vega/` | A React Native for Vega app whose whole screen is one `<WebView>` loading the client's standalone build from `file:///pkg/assets/index.html` |
| `packages/web/` | The client, with this branch's changes: a `vega` host adapter, Vega key codes, codec-aware audio selection |

`packages/vega/PORTING_NOTES.md` explains the architecture and logs every bug hit on the way. Read it
before debugging anything that smells like "the device did something odd" — it may already be there.

## Commands

```sh
# once
pnpm install                        # workspace, at the repo root
cd packages/vega && npm install --workspaces=false

# every build (from packages/vega)
npm run sync-web                    # build packages/web's standalone bundle into assets/
source ~/vega/env                   # the Vega SDK is not on PATH by default
npm run build:debug                 # or npm run build:release
```

Checks, before you call anything done:

```sh
pnpm -F @aiostreams/web typecheck   # the client
pnpm -F @aiostreams/web i18n:extract  # after adding or changing a user-visible string
cd packages/vega && npm run lint && npm test && npx tsc --noEmit
```

On the device:

```sh
vega exec vda connect <ip>:5555     # `vega device list` only lists devices VDA already knows
vega device list
vega device install-app -b Debug
vega device launch-app -a com.amazondeveloper.aiostreamsvega.main
vega device start-log-stream        # logs, including the app's Chromium and media services
vega exec vda forward tcp:9229 tcp:9229   # then CDP against the page (Debug builds only)
vega device copy-logs -a SYSTEM_TOMBSTONE/acr --directory <existing-dir>   # crash reports
```

## Conventions

**Client (`packages/web`).** Match upstream exactly:

- ES modules, `"type": "module"`; relative imports inside a package carry the `.js` extension.
- Every user-visible string goes through Lingui (`t\`…\``, `<Trans>`); run `i18n:extract` afterwards or
  the string renders as a message id. `eslint` enforces the rest (`lingui/no-unlocalized-strings`,
  `lingui/no-expression-in-message`).
- Log with `createLogger('<scope>')` from `@aiostreams/core`; `console.log` is not used.
- Host-specific behaviour belongs in a host adapter (`src/lib/hosts/<host>/`), not in a component. The
  `vega` adapter is the third TV host beside `webos` and `tizen`.
- Keep client changes small and upstreamable. A change that only matters on Vega belongs behind
  `currentHost().name === 'vega'` or in `src/lib/hosts/vega/`.

**Shell (`packages/vega`).**

- React Native 0.83 / React 19, `@amazon-devices/react-native-kepler` and `@amazon-devices/webview` at
  the versions in Amazon's Package Version Matrix for RN 0.83. Do not mix RN lines.
- The shell stays small. Anything the page can do belongs in the page.
- `manifest.toml` carries the components, services and the cleartext policy; change it deliberately and
  re-run a build to see `vpt validate` pass.

## Pitfalls already paid for

- **`vega build` does not bundle JavaScript.** Use `npm run build:*` (`react-native build-vega`), or the
  app installs and dies with `SIGABRT`. Verify `build/private/vega/<arch>/<Debug|Release>/bundle/index.hermes.bundle`
  exists before installing.
- **`vega clean` after removing files from `assets/`.** The build copies over the staging directory
  without clearing it, so a deleted asset stays packaged.
- **Cleartext HTTP is blocked** by the WebView unless `manifest.toml` has
  `[network-traffic-policy.cleartext] allowed-domains`. `mixedContentMode` does not cover it.
- **`navigator.gpu` exists but has no adapter** on this device, and the client treats the property's
  presence as WebGPU working. The shell deletes it before the page loads.
- **No `HTMLMediaElement.audioTracks`** in this WebView: a page cannot switch a file's audio tracks.
  Audio selection therefore happens per version, not per track.
- **No Dolby and no DTS audio decoding** in the WebView — only AAC, MP3, Opus and FLAC — and the server
  only direct plays. Do not "fix" silent lossless audio in the player; see
  `PORTING_NOTES.md` §6.
- **The Vega Virtual Device cannot run this app on Ubuntu or Intel Macs** (`webview_4` module missing).
  Test on a physical Fire TV.
- **Screenshots of playback are black** (hardware surface). Judge playback from logs and ears.
- **Release builds are not debuggable.** Install a Debug build to use CDP on port 9229.

## Testing on hardware

1. Install and launch, then watch `vega device start-log-stream` for `acr_core_dump` (crash), `ANR`, and
   the app's own `chromium`/`MediaServer` lines.
2. Drive the UI with the remote, not just CDP: `vega exec vda shell "inputd-cli button_press KEY_DOWN"`
   (keys: `KEY_UP`, `KEY_DOWN`, `KEY_LEFT`, `KEY_RIGHT`, `KEY_ENTER`, `KEY_BACK`, `KEY_PLAYPAUSE`).
3. For the page itself, forward 9229 and use CDP against `file:///pkg/assets/index.html`: DOM, console,
   and `navigator.mediaCapabilities` verdicts from the real device.
4. Confirm Back still leaves the app from the first page — it goes through the bridge
   (`postMessage {"type":"exit"}` → `BackHandler.exitApp()`), so a regression there is invisible in
   screenshots.

## Do not

- Commit build outputs, packaged apps (`*.vpkg`), `assets/`, `node_modules`, `build/`, or SDK artifacts.
- Commit secrets. `.env` is ignored; the app itself needs none (the server address is typed on the
  device). Never hardcode a server URL, token or API key in source or docs — use placeholders like
  `192.168.1.10`.
- Add a dependency to the shell without checking it is available for RN 0.83 on Vega.
- Change files under `packages/` outside `vega` and `web` — the rest is upstream.
- Fabricate results in documentation. If something was not tested, say so.
