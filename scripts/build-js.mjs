#!/usr/bin/env node
// Build the npm publish artifact: a minified, self-contained `dist/` bundle plus
// the dashboard assets — so the published package ships a built bundle (like
// claudin) instead of the raw src/ tree. Only the *artifact* is built; the repo
// still runs from src/ (`npm start`, `npm test`).
//
//   node scripts/build-js.mjs        (also runs on `npm publish` via prepublishOnly)
//
// Requires `bun` on PATH (it does the bundling; the script itself uses only node
// builtins, so it runs under both `node` and `bun run`). Zero npm deps.
//
// Output layout — the entries land at dist/app/ ON PURPOSE: the runtime resolves
// paths relative to the emitted file (import.meta.url), so dist/app/{cli,index}.js
// keeps `../..` = package root (.env, data dir, LS binary, install-ls.sh) and
// `../dashboard` = dist/dashboard, exactly like src/app/* did against the repo.
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT_APP = join(DIST, 'app');
const OUT_DASH = join(DIST, 'dashboard');
const SRC_DASH = join(ROOT, 'src', 'dashboard');

function fail(msg) {
  console.error(`\n\u2717 ${msg}`);
  process.exit(1);
}

// bun present?
if (spawnSync('bun', ['--version'], { encoding: 'utf-8' }).status !== 0) {
  fail('`bun` not found on PATH. Install Bun (https://bun.sh) \u2014 it does the bundling.');
}

// Clean only the JS-build outputs; leave any dist/windsurf-api-* binaries alone.
rmSync(OUT_APP, { recursive: true, force: true });
rmSync(OUT_DASH, { recursive: true, force: true });
mkdirSync(OUT_APP, { recursive: true });

// Bundle the two entrypoints into self-contained files (no code splitting, so
// each is standalone and its import.meta.url anchors path resolution correctly).
const entries = [
  { in: join('src', 'app', 'cli.js'), out: join(OUT_APP, 'cli.js') },
  { in: join('src', 'app', 'index.js'), out: join(OUT_APP, 'index.js') },
];
for (const e of entries) {
  const args = ['build', e.in, '--target=node', '--format=esm', '--minify', `--outfile=${e.out}`];
  if (spawnSync('bun', args, { cwd: ROOT, stdio: 'inherit' }).status !== 0) {
    fail(`bun build failed for ${e.in}`);
  }
  const size = existsSync(e.out) ? (statSync(e.out).size / 1024).toFixed(0) : '?';
  console.log(`\u2713 Bundled ${e.in} \u2192 dist/app/${e.out.split('/').pop()} (${size} kB)`);
}

// Copy the dashboard assets served at runtime by src/core/assets.js. This is the
// exact set src/app/compiled-entry.js embeds into the standalone binary.
const ASSETS = [
  'index.html',
  'index-sketch.html',
  'i18n/en.json',
  'i18n/zh-CN.json',
  'data/contributors.json',
];
for (const rel of ASSETS) {
  const from = join(SRC_DASH, rel);
  const to = join(OUT_DASH, rel);
  if (!existsSync(from)) fail(`dashboard asset missing: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
console.log(`\u2713 Copied ${ASSETS.length} dashboard assets \u2192 dist/dashboard/`);

// Self-smoke: the CLI must at least print its version from the bundle.
const probe = spawnSync('node', [join(OUT_APP, 'cli.js'), '--version'], {
  encoding: 'utf-8',
  timeout: 30000,
  env: { ...process.env, NO_COLOR: '1' },
});
if (probe.status !== 0 || !probe.stdout || probe.stdout.length < 5) {
  fail(`smoke test failed: node dist/app/cli.js --version (status=${probe.status})\n${probe.stderr || ''}`);
}
console.log(`\u2713 Smoke test passed: ${probe.stdout.trim()}`);
console.log('\nDone. Bundle in dist/app/, assets in dist/dashboard/.');
