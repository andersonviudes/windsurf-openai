#!/usr/bin/env node
// Build standalone `windsurf-api` executables with `bun build --compile`.
//
// Modeled on claudin/scripts/build.ts: clean stale artifacts, build, then
// self-smoke-test the freshly built binary so a broken build fails loudly.
//
//   bun run scripts/build-exe.mjs          host-native target only + smoke (fast local loop)
//   bun run scripts/build-exe.mjs --all    all 5 cross-compiled targets (release/CI)
//   BUILD_ALL=1 bun run scripts/build-exe.mjs   (same as --all)
//
// Requires `bun` on PATH (it does the compiling). The script itself uses only
// node builtins, so it runs under both `node` and `bun run`.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ENTRY = join(ROOT, 'src', 'app', 'compiled-entry.js');

// `out` is the base name; the Windows target produces `<out>.exe`.
const ALL_TARGETS = [
  { target: 'bun-linux-x64', out: 'windsurf-api-linux-x64' },
  { target: 'bun-linux-arm64', out: 'windsurf-api-linux-arm64' },
  { target: 'bun-darwin-x64', out: 'windsurf-api-darwin-x64' },
  { target: 'bun-darwin-arm64', out: 'windsurf-api-darwin-arm64' },
  { target: 'bun-windows-x64', out: 'windsurf-api-windows-x64' },
];

const ext = (target) => (target.includes('windows') ? '.exe' : '');

function hostTarget() {
  const os = process.platform === 'win32' ? 'windows' : process.platform; // linux | darwin | windows
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `bun-${os}-${arch}`;
}

function fail(msg) {
  console.error(`\n\u2717 ${msg}`);
  process.exit(1);
}

// bun present?
if (spawnSync('bun', ['--version'], { encoding: 'utf-8' }).status !== 0) {
  fail('`bun` not found on PATH. Install Bun (https://bun.sh) \u2014 it does the compiling.');
}

const buildAll = process.argv.includes('--all') || process.env.BUILD_ALL === '1';
const host = hostTarget();
const targets = buildAll ? ALL_TARGETS : ALL_TARGETS.filter((t) => t.target === host);
if (targets.length === 0) {
  fail(`no build target matches this host (${host}). Use --all to cross-compile every target.`);
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version || '0.0.0';
const git = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : '';
};
const commit = git(['rev-parse', '--short=12', 'HEAD']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

// Clean stale binaries (keep the dir).
mkdirSync(DIST, { recursive: true });
for (const f of readdirSync(DIST)) {
  if (f.startsWith('windsurf-api-')) rmSync(join(DIST, f), { force: true });
}

console.log(`Building windsurf-api v${version}${commit ? ` (${commit}, ${branch})` : ''}`);
console.log(`Targets: ${targets.map((t) => t.target).join(', ')}\n`);

for (const { target, out } of targets) {
  const outfile = join(DIST, out); // bun appends .exe for the windows target
  const args = [
    'build', '--compile', `--target=${target}`,
    '--define', `WSAPI_BUILD_VERSION="${version}"`,
    '--define', `WSAPI_BUILD_COMMIT="${commit}"`,
    '--define', `WSAPI_BUILD_BRANCH="${branch}"`,
    ENTRY, '--outfile', outfile,
  ];
  if (spawnSync('bun', args, { cwd: ROOT, stdio: 'inherit' }).status !== 0) {
    fail(`bun build failed for ${target}`);
  }
  const produced = outfile + ext(target);
  const size = existsSync(produced) ? (statSync(produced).size / 1024 / 1024).toFixed(1) : '?';
  console.log(`\u2713 Built windsurf-api v${version} \u2192 dist/${out}${ext(target)} (${size} MB)`);
}

// Smoke-test the host-native binary (can't run a darwin/windows binary on linux).
const hostBuilt = targets.find((t) => t.target === host);
if (hostBuilt) {
  const bin = join(DIST, hostBuilt.out + ext(hostBuilt.target));
  console.log(`\nSmoke-testing ${hostBuilt.out}${ext(hostBuilt.target)} ...`);
  for (const probe of [['--version'], ['--help']]) {
    const r = spawnSync(bin, probe, { encoding: 'utf-8', timeout: 30000, env: { ...process.env, NO_COLOR: '1' } });
    if (r.status !== 0 || !r.stdout || r.stdout.length < 10) {
      fail(`smoke test failed: ${hostBuilt.out} ${probe.join(' ')} (status=${r.status})\n${r.stderr || ''}`);
    }
  }
  console.log(`\u2713 Smoke test passed (${hostBuilt.out}${ext(hostBuilt.target)})`);
} else {
  console.log(`\n(skipping smoke test \u2014 no host-native (${host}) binary in this build)`);
}

console.log('\nDone. Binaries in dist/.');
