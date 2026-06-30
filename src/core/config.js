import { readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { appRuntimeRoot } from './runtime-root.js';

// Repo root in a source checkout, or the directory holding the binary in a
// `bun build --compile` build — so .env and the data dir resolve next to the
// executable. See src/core/runtime-root.js.
const ROOT = appRuntimeRoot();

// Load .env file manually (zero dependencies)
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      // Strip inline comments for unquoted values: PORT=3003 # port → 3003
      const commentIdx = val.indexOf(' #');
      if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// Load config.json as a fallback *below* .env / real ENV (zero dependencies).
// Flat JSON keyed by the same names as the env vars: { "PORT": 3003, ... }.
// Only fills keys not already in process.env, so precedence stays
// flags > real ENV > .env > config.json > built-in defaults.
export function loadConfigFile(cfgPath = resolve(ROOT, 'config.json')) {
  if (!existsSync(cfgPath)) return;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  } catch (e) {
    // log isn't built yet here; warn directly so a typo doesn't crash boot.
    console.warn(`[WARN] config.json: failed to parse ${cfgPath}: ${e.message}`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith('_')) continue; // _-prefixed keys are comments/metadata
    if (value == null) continue;
    if (!process.env[key]) process.env[key] = String(value);
  }
}

if (process.env.WINDSURFAPI_SKIP_DOTENV !== '1') {
  loadEnv();
  loadConfigFile();
}

// `sharedDataDir` is the cluster-shared root: a single accounts.json lives
// here so add-account writes from any replica are visible to every replica
// after restart. `dataDir` is replica-local under REPLICA_ISOLATE=1 and is
// safe to use for telemetry that does not need cross-replica visibility.
// See issue #67 — when the two were collapsed into one path, every
// docker-compose upgrade orphaned the user's accounts.json under a stale
// `replica-${HOSTNAME}` subdir.
// Default data dir: a hidden per-user folder. os.homedir() resolves to the
// right place on every OS (Linux ~/, macOS /Users/<u>, Windows C:\Users\<u>),
// so the same `.windsurf-api` name is cross-platform. DATA_DIR overrides it
// (resolved against ROOT so a relative DATA_DIR still lands next to the app).
const DEFAULT_DATA_DIR = join(homedir(), '.windsurf-api');
const sharedDataDir = process.env.DATA_DIR ? resolve(ROOT, process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const dataDir = (() => {
  let base = sharedDataDir;
  if (process.env.REPLICA_ISOLATE === '1' && process.env.HOSTNAME) {
    base = join(base, `replica-${process.env.HOSTNAME}`);
  }
  return base;
})();

try {
  mkdirSync(sharedDataDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
} catch {}

export function defaultLsBinaryPath(platform = process.platform, arch = process.arch, home = process.env.HOME) {
  if (platform === 'darwin') {
    const name = arch === 'arm64' ? 'language_server_macos_arm' : 'language_server_macos_x64';
    return `${home}/.windsurf/${name}`;
  }
  const name = arch === 'arm64' ? 'language_server_linux_arm' : 'language_server_linux_x64';
  return `/opt/windsurf/${name}`;
}

export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  // Bind host. Defaults to all interfaces. Set HOST=127.0.0.1 (or BIND_HOST=)
  // for localhost-only deployments — when bound non-locally, missing API_KEY /
  // DASHBOARD_PASSWORD switches to fail-closed instead of default-allow.
  host: process.env.HOST || process.env.BIND_HOST || '0.0.0.0',
  apiKey: process.env.API_KEY || '',
  dataDir,
  sharedDataDir,

  codeiumAuthToken: process.env.CODEIUM_AUTH_TOKEN || '',
  codeiumApiKey: process.env.CODEIUM_API_KEY || '',
  codeiumEmail: process.env.CODEIUM_EMAIL || '',
  codeiumPassword: process.env.CODEIUM_PASSWORD || '',

  codeiumApiUrl: process.env.CODEIUM_API_URL || 'https://server.self-serve.windsurf.com',
  // Astraflow — OpenAI-compatible aggregation platform by UCloud (200+ models)
  // Global:  https://api-us-ca.umodelverse.ai/v1  — signup: https://astraflow.ucloud-global.com
  // China:   https://api.modelverse.cn/v1          — signup: https://astraflow.ucloud.cn
  astraflowApiKey: process.env.ASTRAFLOW_API_KEY || '',
  astraflowApiKeyCn: process.env.ASTRAFLOW_CN_API_KEY || '',
  astraflowApiUrl: 'https://api-us-ca.umodelverse.ai/v1',
  astraflowApiUrlCn: 'https://api.modelverse.cn/v1',
  defaultModel: process.env.DEFAULT_MODEL || 'claude-4.5-sonnet-thinking',
  maxTokens: parseInt(process.env.MAX_TOKENS || '8192', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

  // Language server
  lsBinaryPath: process.env.LS_BINARY_PATH || defaultLsBinaryPath(),
  lsPort: parseInt(process.env.LS_PORT || '42100', 10),

  // Dashboard
  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',

  // Proxy testing
  allowPrivateProxyHosts: process.env.ALLOW_PRIVATE_PROXY_HOSTS === '1',
};

// True when at least one Windsurf auth source is configured: env / config.json
// credentials, or a non-empty accounts.json in the shared data dir. The server
// boot uses this to fail fast instead of starting with no way to authenticate.
// Override with WINDSURFAPI_ALLOW_NO_AUTH=1 (dashboard-first deployments that
// add accounts in the UI after boot).
export function requireAuthConfigured() {
  if (config.codeiumApiKey || config.codeiumAuthToken ||
      (config.codeiumEmail && config.codeiumPassword)) {
    return true;
  }
  try {
    const accountsPath = join(sharedDataDir, 'accounts.json');
    if (existsSync(accountsPath)) {
      const parsed = JSON.parse(readFileSync(accountsPath, 'utf-8'));
      if (Array.isArray(parsed) && parsed.length > 0) return true;
    }
  } catch {}
  return false;
}

const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[config.logLevel] ?? 1;

export const log = {
  debug: (...args) => currentLevel <= 0 && console.log('[DEBUG]', ...args),
  info: (...args) => currentLevel <= 1 && console.log('[INFO]', ...args),
  warn: (...args) => currentLevel <= 2 && console.warn('[WARN]', ...args),
  error: (...args) => currentLevel <= 3 && console.error('[ERROR]', ...args),
};
