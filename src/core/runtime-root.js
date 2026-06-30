// Runtime-root resolution that works for both a normal source checkout and a
// `bun build --compile` standalone binary.
//
// In a compiled binary, import.meta.url points at Bun's virtual `$bunfs`
// filesystem, so anything that must live on the *real* disk next to the
// executable — .env, the data dir, the Language Server binary — has to be
// resolved from process.execPath instead of from import.meta.url.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `true` only inside the compiled binary. The flag is set by
// src/app/compiled-entry.js (the sole entrypoint `bun build --compile` runs).
// It is absent under Node and `bun run`, so those paths stay unchanged.
export function isCompiled() {
  return !!globalThis.__WINDSURF_COMPILED__;
}

// Repo root in a source checkout (this file is src/core/runtime-root.js → '../..').
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The repo root in a source checkout; the directory holding the binary when
// compiled (so on-disk siblings resolve relative to the executable).
export function appRuntimeRoot() {
  return isCompiled() ? dirname(process.execPath) : SOURCE_ROOT;
}
