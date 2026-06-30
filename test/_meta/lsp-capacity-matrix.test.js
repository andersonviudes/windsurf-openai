import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(__dirname));
const matrixScriptPath = join(root, 'scripts', 'lsp-capacity-matrix.mjs');
const matrixScript = readFileSync(matrixScriptPath, 'utf8');

function runNodeScript(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function withMockServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

describe('LSP capacity matrix CLI', () => {
  it('uses caller user scoping and health snapshots for real deployment probes', () => {
    assert.match(matrixScript, /user,\s*\n\s*max_tokens/);
    assert.match(matrixScript, /\/health\?verbose=1/);
    assert.match(matrixScript, /\/v1\/chat\/completions/);
    assert.match(matrixScript, /admissionDelta/);
    assert.match(matrixScript, /totalRssBytes/);
  });

  it('prints per-concurrency rows with pool and admission deltas', async () => {
    let healthHits = 0;
    let chatHits = 0;
    await withMockServer((req, res) => {
      if (req.url?.startsWith('/health')) {
        healthHits++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          version: 'test',
          commit: 'abc123',
          accounts: { total: 2, active: 2, error: 0 },
          lsPool: {
            running: true,
            maxInstances: 2,
            totalRssBytes: 5000 + healthHits,
            pool: {
              size: 1,
              occupancy: 1,
              effectiveOccupancy: 1,
              ready: 1,
              starting: 0,
              pending: 0,
              reservedPendingStarts: 0,
              stopping: 0,
              activeRequests: 0,
              maintenanceRequests: 0,
              nonDefaultInstances: 0,
              canStartNewNonDefault: true,
              blockReason: null,
              memoryGuard: {
                enabled: true,
                availableBytes: 1000000,
                minAvailableBytes: 500000,
                estimatedRssBytesPerInstance: 500000,
                okToSpawn: true,
                minAvailableBytesSource: 'test',
              },
            },
            admissionStats: {
              startAttempts: healthHits,
              startSuccesses: healthHits,
              startFailures: 0,
              poolWaits: 0,
              memoryWaits: 0,
              poolExhausted: 0,
              memoryGuardBlocks: 0,
              evictions: 0,
            },
          },
        }));
        return;
      }

      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        chatHits++;
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
          const body = JSON.parse(raw || '{}');
          res.writeHead(200, {
            'content-type': 'application/json',
            'openai-processing-ms': '12',
            'openai-model': body.model || '',
            'x-request-id': `req-${chatHits}`,
          });
          res.end(JSON.stringify({
            id: `chatcmpl-${chatHits}`,
            choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    }, async (baseUrl) => {
      const result = await runNodeScript(matrixScriptPath, {
        API_KEY: 'test-key',
        BASE_URL: baseUrl,
        MODEL: 'claude-test',
        LSP_MATRIX_CONCURRENCY: '2',
        LSP_MATRIX_ROUNDS: '1',
        LSP_MATRIX_SETTLE_MS: '1',
        LSP_MATRIX_TIMEOUT_MS: '5000',
      });

      assert.equal(result.code, 0, result.stderr);
      assert.equal(chatHits, 2);
      assert.equal(healthHits, 4);
      const json = JSON.parse(result.stdout);
      assert.equal(json.ok, true);
      assert.equal(json.matrix.length, 1);
      assert.equal(json.matrix[0].concurrency, 2);
      assert.equal(json.matrix[0].success, 2);
      assert.equal(json.matrix[0].failed, 0);
      assert.equal(json.matrix[0].poolAfter.canStartNewNonDefault, true);
      assert.equal(json.matrix[0].admissionDelta.startAttempts, 1);
    });
  });
});
