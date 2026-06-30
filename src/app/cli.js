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
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { isCompiled } from '../core/runtime-root.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const HELP = `WindsurfAPI — Windsurf/Codeium models as OpenAI + Anthropic APIs

Usage: windsurf-api <command> [options]

Commands:
  start            Start the proxy server (default if no command given)
    -p, --port <n>          listen port            (env PORT, default 3003)
    --host <addr>           bind host              (env HOST, default 0.0.0.0)
    --data-dir <path>       state directory        (env DATA_DIR)
    --api-key <key>         require this API key    (env API_KEY)
    --ls-binary <path>      Language Server binary  (env LS_BINARY_PATH)
    --log-level <level>     debug|info|warn|error   (env LOG_LEVEL)

  install            Scaffold .env + directories, then download the LS binary
  setup              (alias of install)
    --port <n>              PORT            (default 3003)
    --host <addr>           HOST
    --api-key <key>         API_KEY
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

  accounts [--json]  List the account pool
  status   [--json]  Pool summary

  --version, -v      Print version
  --help,    -h      Print this help
`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
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
  console.log('(3) point LS_BINARY_PATH at a Windsurf desktop language_server binary.');
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

  // 1. .env
  if (existsSync(envPath) && !values.force) {
    console.log(`.env already exists at ${envPath} — skipping (use --force to overwrite)`);
  } else {
    const env = {
      PORT: values.port || '3003',
      HOST: values.host || '',
      API_KEY: values['api-key'] || '',
      DATA_DIR: dataDir,
      DEFAULT_MODEL: values['default-model'] || 'claude-4.5-sonnet-thinking',
      MAX_TOKENS: values['max-tokens'] || '8192',
      LOG_LEVEL: values['log-level'] || 'info',
      LS_BINARY_PATH: lsBinary,
      LS_PORT: values['ls-port'] || '42100',
      DASHBOARD_PASSWORD: values['dashboard-password'] || '',
      ALLOW_PRIVATE_PROXY_HOSTS: '',
    };
    const body = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    writeFileSync(envPath, body);
    console.log(`Wrote ${envPath}`);
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

  console.log('\nDone. Next:');
  console.log('  windsurf-api login --token <your-windsurf-token>');
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
    console.log('  - Windows:     use WSL2/Docker, or a Windsurf desktop language_server binary');
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
