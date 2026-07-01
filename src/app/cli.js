#!/usr/bin/env node
// WindsurfAPI CLI — a thin dispatcher over the existing server bootstrap and
// account pool. Zero dependencies: argv parsing uses node:util parseArgs.
//
// Subcommands:
//   start (default)  boot the proxy (flags override .env / env vars)
//   install | setup  scaffold .env + dirs and fetch the Language Server
//   install-ls       (re)download just the Language Server binary
//   login            add an account to the pool (token / api_key / email+pass)
//   accounts         list the account pool
//   status           pool summary
//   --version | --help
//
// `npm start` / `npm run dev` keep calling src/index.js directly and are
// unaffected by this file.
import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { isCompiled } from '../core/runtime-root.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const HELP = `WindsurfAPI — Windsurf/Codeium models as OpenAI + Anthropic APIs

Usage: windsurf-api <command> [options]

Commands:
  start            Start the proxy server (default if no command given)
    -p, --port <n>          listen port            (env PORT, default 3003)
    --host <addr>           bind host              (env HOST, default 0.0.0.0)
    --data-dir <path>       state directory        (env DATA_DIR, default ~/.windsurf-api)
    --api-key <key>         require this API key    (env API_KEY)
    --ls-binary <path>      Language Server binary  (env LS_BINARY_PATH)
    --log-level <level>     debug|info|warn|error   (env LOG_LEVEL)

  install            Scaffold .env + directories, then download the LS binary
  setup              (alias of install)
    --port <n>              PORT            (default 3003)
    --host <addr>           HOST
    --api-key <key>         API_KEY
    --generate-api-key      generate a random API_KEY and print it to copy
    --data-dir <path>       DATA_DIR
    --default-model <m>     DEFAULT_MODEL   (default claude-4.5-sonnet-thinking)
    --max-tokens <n>        MAX_TOKENS      (default 8192)
    --log-level <level>     LOG_LEVEL       (default info)
    --ls-binary <path>      LS_BINARY_PATH  (default: platform path)
    --ls-port <n>           LS_PORT         (default 42100)
    --dashboard-password <p> DASHBOARD_PASSWORD
    --skip-ls               do not download the Language Server binary
    --force                 overwrite an existing .env

  install-ls [args]  Download/update only the Language Server binary
                     (args are forwarded to install-ls.sh, e.g. --url <u>)

  login              Add an account to the pool
    --token <t>             register via Windsurf auth token
    --api-key <k>           add a raw Codeium api_key
    --email <e> --password <p>   log in with Windsurf credentials
    --label <name>          friendly label for the account

  import-local       Import credentials from a local Windsurf/Devin install
                     (reads the desktop client's state.vscdb + ~/.codeium/config.json)
    --dry-run               show what would be imported without adding
    --json                  machine-readable output
    --api-key <key>         set the incoming API_KEY (written to .env)
    --generate-api-key      generate a random API_KEY and print it to copy

  accounts [--json]  List the account pool
  status   [--json]  Pool summary

  --version, -v      Print version
  --help,    -h      Print this help
`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// Random incoming API key for clients to authenticate with. `sk-` prefix so it
// drops straight into OpenAI-style clients that expect that shape; hex keeps it
// shell- and copy-safe.
function generateApiKey() {
  return 'sk-' + randomBytes(24).toString('hex');
}

// Resolve the API_KEY the user wants: an explicit --api-key wins, otherwise
// --generate-api-key mints a fresh one. Returns '' when neither is given.
function resolveApiKey(values) {
  if (values['api-key']) return values['api-key'];
  if (values['generate-api-key']) return generateApiKey();
  return '';
}

// Upsert a single KEY=value into .env (preserving other lines / comments) and
// mirror it into config.json when that file exists. Lets `import-local` set
// API_KEY without rewriting the whole config the way `install` does.
function upsertConfigValue(key, value) {
  const envPath = join(ROOT, '.env');
  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf-8').split('\n') : [];
  const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (idx !== -1) {
    lines[idx] = `${key}=${value}`;
  } else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(`${key}=${value}`);
  }
  writeFileSync(envPath, lines.join('\n') + '\n');

  const configPath = join(ROOT, 'config.json');
  if (existsSync(configPath)) {
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
    cfg[key] = value;
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
  }
}

async function printVersion() {
  const { getVersionInfo } = await import('../core/version.js');
  const v = getVersionInfo();
  console.log(`windsurf-api ${v.version}${v.commit ? ` (${v.commit}, ${v.branch})` : ''}`);
}

// The Language Server binary is Linux/macOS-only and install-ls.sh needs a
// POSIX shell + uname (Git Bash reports MINGW* which the script rejects), so
// on Windows we print the same guidance as index.js instead of failing on a
// missing `bash`. Returns false when the download was skipped.
function printWindowsLsNote() {
  console.log('Windows detected: the Language Server binary is Linux/macOS only.');
  console.log('Options: (1) Docker (see docker-compose.yml), (2) WSL2, or');
  console.log('(3) point LS_BINARY_PATH at a Devin Desktop / Windsurf language_server binary, e.g.');
  console.log('    C:\\Program Files\\Devin\\resources\\app\\extensions\\windsurf\\bin\\language_server_windows_x64.exe');
}

function runInstallLs(args = [], extraEnv = {}) {
  if (process.platform === 'win32') {
    printWindowsLsNote();
    return false;
  }
  const script = join(ROOT, 'install-ls.sh');
  if (!existsSync(script)) {
    fail(`install-ls.sh not found at ${script}`);
  }
  const quoted = args
    .map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`)
    .join(' ');
  execSync(`bash "${script}" ${quoted}`.trim(), {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  return true;
}

// ─── start ───────────────────────────────────────────────
// Flags override env; config.js reads process.env at import time, so we MUST
// set the vars before importing index.js (which runs main() on import).
async function cmdStart(rest) {
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      'data-dir': { type: 'string' },
      'api-key': { type: 'string' },
      'ls-binary': { type: 'string' },
      'log-level': { type: 'string' },
    },
  });
  const map = {
    port: 'PORT',
    host: 'HOST',
    'data-dir': 'DATA_DIR',
    'api-key': 'API_KEY',
    'ls-binary': 'LS_BINARY_PATH',
    'log-level': 'LOG_LEVEL',
  };
  for (const [flag, env] of Object.entries(map)) {
    if (values[flag] != null) process.env[env] = String(values[flag]);
  }
  await import('./index.js'); // main() runs on import; server keeps the process alive
}

// ─── install / setup ─────────────────────────────────────
async function cmdInstall(rest) {
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      'api-key': { type: 'string' },
      'generate-api-key': { type: 'boolean' },
      'data-dir': { type: 'string' },
      'default-model': { type: 'string' },
      'max-tokens': { type: 'string' },
      'log-level': { type: 'string' },
      'ls-binary': { type: 'string' },
      'ls-port': { type: 'string' },
      'dashboard-password': { type: 'string' },
      'skip-ls': { type: 'boolean' },
      force: { type: 'boolean' },
    },
  });

  const isWindows = process.platform === 'win32';
  const { defaultLsBinaryPath } = await import('../core/config.js');
  // On Windows the LS isn't supported, so don't bake a bogus /opt/... default
  // into .env — leave LS_BINARY_PATH empty unless the user passed one.
  const lsBinary = values['ls-binary'] || (isWindows ? '' : defaultLsBinaryPath());
  const dataDir = values['data-dir'] || '';
  const envPath = join(ROOT, '.env');
  const configPath = join(ROOT, 'config.json');

  // --api-key sets an explicit incoming key; --generate-api-key mints one.
  // Empty (neither flag) keeps the open-access default.
  const apiKey = resolveApiKey(values);

  const settings = {
    PORT: values.port || '3003',
    // Default to loopback so a fresh local install serves an open dashboard
    // (no prompt) when API_KEY / DASHBOARD_PASSWORD are empty. Pass
    // --host 0.0.0.0 to expose on the network — then set --dashboard-password,
    // since public binds fail-closed without it.
    HOST: values.host || '127.0.0.1',
    API_KEY: apiKey,
    DATA_DIR: dataDir,
    DEFAULT_MODEL: values['default-model'] || 'claude-4.5-sonnet-thinking',
    MAX_TOKENS: values['max-tokens'] || '8192',
    LOG_LEVEL: values['log-level'] || 'info',
    LS_BINARY_PATH: lsBinary,
    LS_PORT: values['ls-port'] || '42100',
    DASHBOARD_PASSWORD: values['dashboard-password'] || '',
    ALLOW_PRIVATE_PROXY_HOSTS: '',
  };

  // 1. .env
  if (existsSync(envPath) && !values.force) {
    console.log(`.env already exists at ${envPath} — skipping (use --force to overwrite)`);
  } else {
    const body = Object.entries(settings).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    writeFileSync(envPath, body);
    console.log(`Wrote ${envPath}`);
  }

  // 1b. config.json — same settings as a flat JSON fallback below ENV/.env.
  // ENV (and .env) still win; this file fills any keys they don't set.
  if (existsSync(configPath) && !values.force) {
    console.log(`config.json already exists at ${configPath} — skipping (use --force to overwrite)`);
  } else {
    writeFileSync(configPath, JSON.stringify(settings, null, 2) + '\n');
    console.log(`Wrote ${configPath}`);
  }

  // 2. directories (LS binary dir, data dir, workspace)
  const workspace = join(tmpdir(), 'windsurf-workspace');
  const dirs = [
    lsBinary ? dirname(lsBinary) : null,
    dataDir ? resolve(ROOT, dataDir) : ROOT,
    workspace,
  ].filter(Boolean);
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error(`mkdir ${dir}: ${e.message}`);
    }
  }
  console.log(`Created directories: ${dirs.join(', ')}`);

  // 3. Language Server binary
  if (values['skip-ls']) {
    console.log('Skipping Language Server download (--skip-ls).');
  } else if (isWindows) {
    printWindowsLsNote();
  } else {
    console.log('Downloading Language Server binary...');
    runInstallLs([], { LS_INSTALL_PATH: lsBinary });
  }

  if (apiKey) {
    console.log(`\nAPI key (written to .env — clients send it as the Bearer token / api_key):\n  ${apiKey}`);
    if (values['generate-api-key'] && !values['api-key']) console.log('  ^ generated for you — copy it now.');
  }

  console.log('\nDone. Next:');
  console.log('  windsurf-api login --token <your-windsurf-token>');
  console.log('  windsurf-api import-local   # or pull accounts from a local Windsurf/Devin install');
  console.log('  windsurf-api start');
}

// ─── login ───────────────────────────────────────────────
async function cmdLogin(rest) {
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      token: { type: 'string' },
      'api-key': { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
      label: { type: 'string' },
    },
  });

  const {
    initAuth, addAccountByToken, addAccountByKey, addAccountByEmail,
    saveAccountsSync, maskApiKey,
  } = await import('../account-pool/auth.js');

  await initAuth(); // loads the existing pool so we append instead of clobbering

  let account;
  if (values.token) {
    account = await addAccountByToken(values.token, values.label || '');
  } else if (values['api-key']) {
    account = addAccountByKey(values['api-key'], values.label || '');
  } else if (values.email && values.password) {
    account = await addAccountByEmail(values.email, values.password);
  } else {
    fail('login needs one of: --token <t>, --api-key <k>, or --email <e> --password <p>');
  }

  saveAccountsSync();
  console.log(`Account added: id=${account.id} email=${account.email} method=${account.method} key=${maskApiKey(account.apiKey)}`);
  process.exit(0); // initAuth schedules background timers; we're done, exit cleanly
}

// ─── import-local ────────────────────────────────────────
// Discover credentials from a locally-installed Windsurf/Devin desktop client
// (state.vscdb + ~/.codeium/config.json) and add them to the pool. The
// dashboard exposes the same discovery at GET /accounts/import-local, but gates
// it behind a loopback check because the dashboard can be bound publicly; the
// CLI is inherently a local process, so no such network gate is needed here.
async function cmdImportLocal(rest) {
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      json: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'api-key': { type: 'string' },
      'generate-api-key': { type: 'boolean' },
    },
  });

  // Optionally set the incoming API_KEY while we're here — independent of what
  // gets imported (runs even when no local accounts are found). Skipped on
  // --dry-run. In --json mode the notice goes to stderr so stdout stays JSON.
  const apiKey = resolveApiKey(values);
  if (apiKey && !values['dry-run']) {
    upsertConfigValue('API_KEY', apiKey);
    const note = `API key set (written to .env — clients send it as the Bearer token / api_key): ${apiKey}`;
    if (values.json) console.error(note);
    else console.log(`${note}\n`);
  }

  const { discoverWindsurfCredentials } = await import('../dashboard/local-windsurf.js');
  const result = await discoverWindsurfCredentials();

  // Nothing found — report the checked sources so the user can debug.
  if (result.accounts.length === 0) {
    if (values.json) {
      console.log(JSON.stringify({ discovered: 0, added: 0, accounts: [], ...result }, null, 2));
    } else {
      console.log('No local Windsurf/Devin credentials found. Checked:');
      for (const s of result.sources) {
        console.log(`  ${s.ok ? 'ok  ' : '--  '}${s.path}${s.reason ? ` (${s.reason})` : ''}`);
      }
      if (result.sqliteSupport !== 'available') {
        console.log('Note: node:sqlite is unavailable, so the IDE state.vscdb could not be read (Node >=24 ships it).');
      }
    }
    process.exit(0);
  }

  // Dry run: list discoveries without touching the pool.
  if (values['dry-run']) {
    if (values.json) {
      console.log(JSON.stringify({ discovered: result.accounts.length, added: 0, accounts: result.accounts, sources: result.sources }, null, 2));
    } else {
      console.log(`Would import ${result.accounts.length} credential(s) (dry run):`);
      for (const a of result.accounts) {
        console.log(`  ${(a.apiKeyMasked || '').padEnd(20)} ${(a.email || a.name || '').padEnd(28)} ${a.source}`);
      }
    }
    process.exit(0);
  }

  const {
    initAuth, addAccountByKey, saveAccountsSync, maskApiKey, getAccountList,
  } = await import('../account-pool/auth.js');
  await initAuth(); // load the existing pool so we append instead of clobbering

  const existingIds = new Set(getAccountList({ view: 'summary' }).map((a) => a.id));
  const rows = [];
  for (const a of result.accounts) {
    const account = addAccountByKey(a.apiKey, a.label || a.email || a.name || '', a.apiServerUrl || '');
    rows.push({ account, source: a.source, isNew: !existingIds.has(account.id) });
  }
  saveAccountsSync();

  const addedCount = rows.filter((r) => r.isNew).length;
  if (values.json) {
    console.log(JSON.stringify({
      discovered: result.accounts.length,
      added: addedCount,
      accounts: rows.map((r) => ({
        id: r.account.id, email: r.account.email, status: r.account.status,
        apiKey_masked: maskApiKey(r.account.apiKey), source: r.source, new: r.isNew,
      })),
    }, null, 2));
  } else {
    for (const r of rows) {
      console.log(
        `${r.account.id}  ${(r.isNew ? 'new' : 'existing').padEnd(8)} ${maskApiKey(r.account.apiKey).padEnd(20)} ${(r.account.email || '').padEnd(28)} ${r.source}`,
      );
    }
    console.log(`\nImported ${addedCount} new account(s); ${result.accounts.length - addedCount} already in the pool.`);
  }
  process.exit(0); // initAuth schedules background timers; we're done, exit cleanly
}

// ─── accounts ────────────────────────────────────────────
async function cmdAccounts(rest) {
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: { json: { type: 'boolean' } },
  });
  const { initAuth, getAccountList } = await import('../account-pool/auth.js');
  await initAuth();
  const list = getAccountList({ view: 'summary' });

  if (values.json) {
    console.log(JSON.stringify(list, null, 2));
  } else if (list.length === 0) {
    console.log('No accounts. Add one with: windsurf-api login --token <t>');
  } else {
    for (const a of list) {
      const rl = a.rateLimited ? ' rate-limited' : '';
      console.log(
        `${a.id}  ${a.status.padEnd(7)} ${(a.method || '').padEnd(8)} tier=${a.tier}  rpm=${a.rpmUsed}/${a.rpmLimit}  errs=${a.errorCount}${rl}  ${a.email}`,
      );
    }
  }
  process.exit(0);
}

// ─── status ──────────────────────────────────────────────
async function cmdStatus(rest) {
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: { json: { type: 'boolean' } },
  });
  const { initAuth, getAccountListStats, isAuthenticated } = await import('../account-pool/auth.js');
  await initAuth();
  const stats = getAccountListStats();
  const authed = isAuthenticated();

  if (values.json) {
    console.log(JSON.stringify({ authenticated: authed, ...stats }, null, 2));
  } else {
    console.log(`Authenticated: ${authed ? 'yes' : 'no'}`);
    console.log(`Accounts: ${stats.total} total, ${stats.active} active, ${stats.error} error`);
    console.log(`Flagged: ${stats.flagged}  rate-limited: ${stats.rateLimited}  disabled: ${stats.disabled}`);
  }
  process.exit(0);
}

// ─── dispatch ────────────────────────────────────────────
async function dispatch() {
  const argv = process.argv.slice(2);
  const first = argv[0];

  // Global flags / help, or a leading flag → treat as `start`.
  if (!first || first === '--help' || first === '-h' || first === 'help') {
    console.log(HELP);
    return;
  }
  if (first === '--version' || first === '-v' || first === 'version') {
    await printVersion();
    return;
  }

  let command = first;
  let rest = argv.slice(1);
  if (first.startsWith('-')) {
    command = 'start';
    rest = argv;
  }

  // The standalone (`bun build --compile`) binary can't run the LS installer:
  // install-ls.sh isn't on disk, and the Language Server is a separate
  // Linux/macOS-only binary that isn't bundled. Point users at out-of-band
  // setup instead of failing obscurely on a missing script/bash.
  if (isCompiled() && (command === 'install' || command === 'setup' || command === 'install-ls')) {
    console.log('This is the standalone windsurf-api binary — the Language Server installer is not bundled.');
    console.log('Set up the Language Server out-of-band, then point LS_BINARY_PATH at it:');
    console.log('  - Linux/macOS: run install-ls.sh from the repo, or use Docker');
    console.log('  - Windows:     use WSL2/Docker, or a Devin Desktop / Windsurf language_server binary');
    console.log('Then: windsurf-api login --token <t>   &&   windsurf-api start');
    process.exit(0);
  }

  switch (command) {
    case 'start':
      return cmdStart(rest);
    case 'install':
    case 'setup':
      return cmdInstall(rest);
    case 'install-ls':
      return runInstallLs(rest); // pass args straight through to the shell script
    case 'login':
      return cmdLogin(rest);
    case 'import-local':
      return cmdImportLocal(rest);
    case 'accounts':
      return cmdAccounts(rest);
    case 'status':
      return cmdStatus(rest);
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

dispatch().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
