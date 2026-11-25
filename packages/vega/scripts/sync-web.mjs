#!/usr/bin/env node
/*
 * Puts the AIOStreams web client's standalone build in `assets/`, where the
 * shell loads it from: the package's `assets` folder is what a Vega app reads
 * at `file:///pkg/assets/`, so `index.html` and `static/` sit at its root.
 *
 * The standalone build is the one the LG/Samsung packages carry too: it has
 * relative asset paths and picks its own server, instead of being served by a
 * server that knows where it is mounted.
 *
 * Where the AIOStreams copy is, in order: `--repo <path>`, `$AIOSTREAMS_REPO`,
 * or the repository this package sits in, two levels up. Pass `--skip-build`
 * to copy the existing `dist-standalone` without rebuilding.
 *
 *   node scripts/sync-web.mjs [--repo <path>] [--skip-build]
 */
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function argument(name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

const repo = resolve(
  argument('--repo') ??
    process.env.AIOSTREAMS_REPO ??
    join(root, '..', '..'),
);
const build = !args.includes('--skip-build');
const from = join(repo, 'packages', 'web', 'dist-standalone');
const to = join(root, 'assets');

if (!existsSync(join(repo, 'packages', 'web', 'package.json'))) {
  console.error(
    `Not an AIOStreams clone: ${repo}\n` +
      'Pass --repo <path> or set AIOSTREAMS_REPO.',
  );
  process.exit(1);
}

if (build) {
  console.log(`Building the web client in ${repo}`);
  const {status, error} = spawnSync(
    'pnpm',
    ['-F', '@aiostreams/web', 'build:standalone'],
    {cwd: repo, stdio: 'inherit'},
  );
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}

if (!existsSync(join(from, 'index.html'))) {
  console.error(
    `No standalone build at ${from}\n` +
      'Run without --skip-build so it is built first.',
  );
  process.exit(1);
}

rmSync(to, {recursive: true, force: true});
mkdirSync(to, {recursive: true});
// `dist-standalone`'s own files, at the root of the package's assets.
cpSync(from, to, {recursive: true});

// Vega has no WebGPU adapter, so the page can never use this player, and it is
// 9 MB of wasm and JavaScript. The shell also deletes `navigator.gpu` before the
// page runs, so nothing asks for it. See `src/App.tsx`.
rmSync(join(to, 'static', 'webgpu-player'), {recursive: true, force: true});

// The launcher's tile, which the manifest names as `@image/app_icon.png` and
// which has to sit inside the package's assets. Kept in `icon/` so a sync,
// which replaces `assets/`, cannot lose it.
mkdirSync(join(to, 'image'), {recursive: true});
cpSync(join(root, 'icon', 'app_icon.png'), join(to, 'image', 'app_icon.png'));

const version = JSON.parse(
  readFileSync(join(repo, 'package.json'), 'utf8'),
).version;
console.log(`AIOStreams ${version} → ${to}`);
