// Dashboard asset loader that works for both a normal source checkout and a
// `bun build --compile` standalone binary.
//
// In a source checkout the assets are read from src/dashboard/ on disk. In a
// compiled binary they are embedded at build time by src/app/compiled-entry.js,
// which preloads them into `globalThis.__WINDSURF_EMBEDDED_ASSETS__` (a map of
// forward-slash relative path → Buffer). This module never references `Bun`,
// so the Node runtime path is untouched.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// src/dashboard, resolved from this file (src/core/assets.js → '../dashboard').
const DASHBOARD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');

// `relPath` is forward-slash, relative to src/dashboard:
//   'index.html', 'index-sketch.html', 'i18n/en.json', 'data/contributors.json'
// Returns a Buffer, or throws — the callers in server.js already wrap this in
// try/catch and turn a miss into a 404/500, so embed-only locales degrade the
// same way a missing file would on disk.
export function readDashboardAsset(relPath) {
  const embedded = globalThis.__WINDSURF_EMBEDDED_ASSETS__;
  if (embedded) {
    const hit = embedded[relPath];
    if (hit) return hit;
    throw new Error(`embedded dashboard asset not found: ${relPath}`);
  }
  return readFileSync(join(DASHBOARD_DIR, relPath));
}
