# Contributing

Thanks for your interest in contributing to WindsurfAPI!

## Before you start

- **New feature?** Open an issue first so we can align on direction before you write the PR.
- **Bug fix or docs change?** Send a PR directly — no need to open an issue first.
- **Unsure about the project structure?** See the [README](README.md) and the header comments at the top of each file under `src/`.

## Development setup

Requirements: Node.js `>=24`. The project has **zero npm dependencies**, so there is nothing to install.

```bash
npm start        # run the proxy
npm run dev      # run with node --watch (auto-reload)
```

You also need a Windsurf Language Server binary. Point `LS_BINARY_PATH` at one (or run `install-ls.sh` to fetch it) — nothing works without it. See [`.env.example`](.env.example) for the full configuration surface.

## Code style

- **Zero npm dependencies** — pure `node:*` builtins only. Do not run `npm install` or add a `dependencies` / `devDependencies` block. Adding any third-party package needs explicit sign-off.
- ES Modules (`import` / `export`) and `async` / `await`.
- 2-space indentation, single quotes, semicolons.
- Put new files under `src/` in the matching subdirectory and follow the existing naming.
- LS protocol changes (`src/windsurf.js`, `src/proto.js`, `src/grpc.js`): when changing a protobuf field number, cite its source (proto file or decompiled finding) in the PR description.
- Dashboard UI (`src/dashboard/`): use `App.confirm()` / `App.prompt()` instead of native `alert()` / `confirm()` / `prompt()`.

## Testing

The project ships a `node:test` suite that runs against an isolated temporary `DATA_DIR`, so it is zero-billable and needs no real accounts.

```bash
npm test                                                              # full suite
node --import ./test/setup-env.mjs --test test/<name>.test.js         # single file
node --import ./test/setup-env.mjs --test test/<name>.test.js \
  --test-name-pattern '<regex>'                                       # single test by name
npm run secret-scan                                                   # gate before shipping
```

Smoke tests (`npm run smoke:special-agent`, `smoke:native-bridge`, `smoke:lsp-matrix`) are **billable** — they hit a live server and real accounts. Run them only when you mean to, and never in CI.

## Commits & PRs

- Format: `type: short description` — e.g. `fix: chat stream missing usage field`.
- Types: `feat` / `fix` / `refactor` / `docs` / `chore`.
- The title says *what* changed; the body says *why* (the diff covers *how*).
- One PR per concern — split unrelated changes into separate PRs.

## CI

CI's only gate is `node --check` (syntax). Green CI is enough to ship to review. A local pre-commit hook also runs `node --check` on staged `.js` files.
