#!/usr/bin/env node

const baseUrl = (process.env.BASE_URL || process.env.WINDSURFAPI_BASE_URL || 'http://127.0.0.1:3003').replace(/\/+$/, '');
const apiKey = process.env.API_KEY || process.env.WINDSURFAPI_API_KEY || '';
const model = process.env.MODEL || process.env.WINDSURFAPI_LSP_MATRIX_MODEL || 'claude-haiku-4.5';
const concurrencyValues = String(process.env.LSP_MATRIX_CONCURRENCY || '1,2,4')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0);
const rounds = Math.max(1, Number(process.env.LSP_MATRIX_ROUNDS || 1));
const timeoutMs = Math.max(5_000, Number(process.env.LSP_MATRIX_TIMEOUT_MS || 90_000));
const stream = process.env.LSP_MATRIX_STREAM === '1';
const includeHealth = process.env.LSP_MATRIX_HEALTH !== '0';
const failFast = process.env.LSP_MATRIX_FAIL_FAST === '1';
const marker = `LSP_MATRIX_${Date.now().toString(36)}`;

if (!apiKey) {
  console.error('API_KEY is required');
  process.exit(2);
}
if (!concurrencyValues.length) {
  console.error('LSP_MATRIX_CONCURRENCY must contain at least one positive integer');
  process.exit(2);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function compactText(text, max = 800) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}...<truncated ${s.length - max} chars>` : s;
}

function percentile(values, p) {
  const nums = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const idx = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return nums[idx];
}

function summarizePool(health) {
  const pool = health?.lsPool?.pool || {};
  const guard = pool.memoryGuard || health?.lsPool?.memoryGuard || {};
  return {
    running: !!health?.lsPool?.running,
    maxInstances: health?.lsPool?.maxInstances ?? pool.maxInstances ?? null,
    totalRssBytes: health?.lsPool?.totalRssBytes ?? null,
    size: pool.size ?? null,
    occupancy: pool.occupancy ?? null,
    effectiveOccupancy: pool.effectiveOccupancy ?? null,
    ready: pool.ready ?? null,
    starting: pool.starting ?? null,
    pending: pool.pending ?? null,
    reservedPendingStarts: pool.reservedPendingStarts ?? null,
    stopping: pool.stopping ?? null,
    activeRequests: pool.activeRequests ?? null,
    maintenanceRequests: pool.maintenanceRequests ?? null,
    nonDefaultInstances: pool.nonDefaultInstances ?? null,
    canStartNewNonDefault: pool.canStartNewNonDefault ?? null,
    blockReason: pool.blockReason ?? null,
    memoryGuard: {
      enabled: guard.enabled ?? null,
      availableBytes: guard.availableBytes ?? null,
      minAvailableBytes: guard.minAvailableBytes ?? null,
      estimatedRssBytesPerInstance: guard.estimatedRssBytesPerInstance ?? null,
      okToSpawn: guard.okToSpawn ?? null,
      source: guard.minAvailableBytesSource ?? null,
    },
    admissionStats: health?.lsPool?.admissionStats || null,
  };
}

async function fetchHealth(label) {
  if (!includeHealth) return null;
  try {
    const res = await fetch(`${baseUrl}/health?verbose=1`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      return { ok: false, label, status: res.status, error: 'health returned non-JSON', rawPreview: compactText(text) };
    }
    return {
      ok: res.ok,
      label,
      status: res.status,
      version: json.version,
      commit: json.commit,
      accounts: json.accounts || null,
      nativeBridgeConfig: json.nativeBridgeConfig || null,
      pool: summarizePool(json),
    };
  } catch (error) {
    return { ok: false, label, error: String(error?.message || error) };
  }
}

function requestBody(user, index) {
  return {
    model,
    stream,
    user,
    max_tokens: 16,
    messages: [
      { role: 'user', content: `Reply exactly OK. ${marker} request ${index}.` },
    ],
  };
}

async function runOne(user, index) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody(user, index)),
    });
    const text = await res.text();
    const latencyMs = Date.now() - started;
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      status: res.status,
      latencyMs,
      processingMs: Number(res.headers.get('openai-processing-ms') || 0) || null,
      accountLikeHeaders: {
        model: res.headers.get('openai-model') || null,
        requestId: res.headers.get('x-request-id') || null,
      },
      preview: ok ? compactText(text, 240) : compactText(text, 800),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      error: error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function admissionDelta(before, after) {
  const b = before?.pool?.admissionStats || {};
  const a = after?.pool?.admissionStats || {};
  const keys = ['startAttempts', 'startSuccesses', 'startFailures', 'poolWaits', 'memoryWaits', 'poolExhausted', 'memoryGuardBlocks', 'evictions'];
  const out = {};
  for (const key of keys) out[key] = Number(a[key] || 0) - Number(b[key] || 0);
  return out;
}

function summarizeBatch(concurrency, round, before, after, requests) {
  const latencies = requests.map(r => r.latencyMs);
  const ok = requests.filter(r => r.ok).length;
  const statuses = {};
  for (const r of requests) statuses[String(r.status)] = (statuses[String(r.status)] || 0) + 1;
  const beforePool = before?.pool || {};
  const afterPool = after?.pool || {};
  return {
    round,
    concurrency,
    ok: ok === requests.length,
    success: ok,
    failed: requests.length - ok,
    statuses,
    latencyMs: {
      min: Math.min(...latencies),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: Math.max(...latencies),
    },
    rssDeltaBytes: Number(afterPool.totalRssBytes || 0) - Number(beforePool.totalRssBytes || 0),
    poolBefore: beforePool,
    poolAfter: afterPool,
    admissionDelta: admissionDelta(before, after),
    failures: requests.filter(r => !r.ok).slice(0, 10),
  };
}

const matrix = [];
const failures = [];
const overallBefore = await fetchHealth('overall-before');

for (const concurrency of concurrencyValues) {
  for (let round = 1; round <= rounds; round++) {
    const before = await fetchHealth(`c${concurrency}-r${round}-before`);
    const tasks = [];
    for (let i = 0; i < concurrency; i++) {
      const user = `${marker}-c${concurrency}-r${round}-u${i}`;
      tasks.push(runOne(user, `${concurrency}.${round}.${i}`));
    }
    const requests = await Promise.all(tasks);
    await sleep(Number(process.env.LSP_MATRIX_SETTLE_MS || 1000));
    const after = await fetchHealth(`c${concurrency}-r${round}-after`);
    const row = summarizeBatch(concurrency, round, before, after, requests);
    matrix.push(row);
    if (!row.ok) failures.push(`c=${concurrency} r=${round} failed=${row.failed}`);
    if (failFast && failures.length) break;
  }
  if (failFast && failures.length) break;
}

const overallAfter = await fetchHealth('overall-after');

console.log(JSON.stringify({
  ok: failures.length === 0,
  baseUrl,
  model,
  marker,
  stream,
  timeoutMs,
  concurrencyValues,
  rounds,
  failures,
  overallBefore,
  overallAfter,
  matrix,
}, null, 2));

if (failures.length) process.exit(1);
