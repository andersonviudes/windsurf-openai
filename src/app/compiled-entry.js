// Entrypoint for the `bun build --compile` standalone binary — and ONLY for it.
// Node never imports this file, which is why the Bun-only `with { type: 'file' }`
// import attribute and the `Bun.file` API below are safe here: they would not
// work under Node, but the Node runtime path uses src/app/index.js / cli.js and
// never loads this module. `node --check` only parses (it does not link/execute),
// and import attributes are valid syntax, so the CI/hook/pre-commit syntax gate
// still passes on this file.
//
// What it does:
//   1. Embed the dashboard assets into the binary (so they are served from
//      memory, not from a src/dashboard/ dir that does not exist next to a
//      standalone binary).
//   2. Set the runtime flags read by src/core/runtime-root.js and
//      src/core/assets.js BEFORE any other module loads.
//   3. Hand off to the normal CLI dispatcher.
import indexHtml from '../dashboard/index.html' with { type: 'file' };
import sketchHtml from '../dashboard/index-sketch.html' with { type: 'file' };
import enJson from '../dashboard/i18n/en.json' with { type: 'file' };
import zhJson from '../dashboard/i18n/zh-CN.json' with { type: 'file' };
import ptJson from '../dashboard/i18n/pt.json' with { type: 'file' };
import esJson from '../dashboard/i18n/es.json' with { type: 'file' };
import contributors from '../dashboard/data/contributors.json' with { type: 'file' };

globalThis.__WINDSURF_COMPILED__ = true;

// The imports above resolve to internal `$bunfs/...` paths after compilation;
// preload each into a Buffer so server.js can serve them synchronously.
const load = async (p) => Buffer.from(await Bun.file(p).arrayBuffer());
globalThis.__WINDSURF_EMBEDDED_ASSETS__ = {
  'index.html': await load(indexHtml),
  'index-sketch.html': await load(sketchHtml),
  'i18n/en.json': await load(enJson),
  'i18n/zh-CN.json': await load(zhJson),
  'i18n/pt.json': await load(ptJson),
  'i18n/es.json': await load(esJson),
  'data/contributors.json': await load(contributors),
};

// Build metadata, injected as literals by `bun build --compile --define ...`.
// Guarded so running this file without --define (e.g. a raw `bun run`) cannot
// throw a ReferenceError. version.js reads these env vars first.
function injectBuildEnv(envName, literal) {
  try {
    if (!process.env[envName] && literal != null) process.env[envName] = literal;
  } catch {}
}
try { injectBuildEnv('WINDSURFAPI_BUILD_VERSION', typeof WSAPI_BUILD_VERSION !== 'undefined' ? WSAPI_BUILD_VERSION : undefined); } catch {}
try { injectBuildEnv('WINDSURFAPI_BUILD_COMMIT', typeof WSAPI_BUILD_COMMIT !== 'undefined' ? WSAPI_BUILD_COMMIT : undefined); } catch {}
try { injectBuildEnv('WINDSURFAPI_BUILD_BRANCH', typeof WSAPI_BUILD_BRANCH !== 'undefined' ? WSAPI_BUILD_BRANCH : undefined); } catch {}

// cli.js only top-level-imports node builtins; config.js (and the rest of the
// graph) load lazily inside the command handlers — after the flags above are
// set — so the runtime-root / embedded-asset wiring is in place by then.
await import('./cli.js');
