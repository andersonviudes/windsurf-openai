import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSession,
  getFirstLoadEvents,
  getOrganization,
  listSessions,
  buildEventStreamRequest,
} from '../../src/special-agent/devin-backend.js';

// S4 coverage: src/devin-backend.js (escape-hatch PATH B, app.devin.ai REST/SSE)
// had read happy-paths + write-stub coverage in test/devin-backend.test.js, but
// the input-validation guards and the non-401 HTTP error mappings were
// uncovered. These matter post-7/1: a missing/empty id must NOT silently build
// a wrong URL, and 403 must pass through (auth gating) while 404 normalizes to
// 502. All offline — fetch is mocked, no network.

function mockFetch(jsonBody, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, json: async () => jsonBody };
  };
  return { fetchImpl, calls };
}

const baseCfg = () => ({
  baseUrl: 'https://app.devin.ai/api',
  token: 'devin-session-token$abc123',
  orgId: 'org-acme',
  enabled: true,
});

describe('devin-backend id-guard validation (no malformed URLs)', () => {
  it('getSession throws 400 on empty devinId (never builds /sessions/)', async () => {
    await assert.rejects(() => getSession(baseCfg(), '', { fetchImpl: async () => { throw new Error('must not fetch'); } }), (e) => {
      assert.equal(e.status, 400);
      return true;
    });
  });

  it('getFirstLoadEvents throws 400 on empty devinId', async () => {
    await assert.rejects(() => getFirstLoadEvents(baseCfg(), '', { fetchImpl: async () => { throw new Error('must not fetch'); } }), (e) => {
      assert.equal(e.status, 400);
      return true;
    });
  });

  it('getOrganization throws 400 when orgId is empty', async () => {
    await assert.rejects(() => getOrganization({ ...baseCfg(), orgId: '' }, { fetchImpl: async () => { throw new Error('must not fetch'); } }), (e) => {
      assert.equal(e.status, 400);
      return true;
    });
  });

  it('listSessions throws 400 (misconfigured) when orgId is empty', async () => {
    await assert.rejects(() => listSessions({ ...baseCfg(), orgId: '' }, { fetchImpl: async () => { throw new Error('must not fetch'); } }), (e) => {
      assert.equal(e.status, 400);
      return true;
    });
  });

  it('buildEventStreamRequest throws 400 on empty devinId', () => {
    assert.throws(() => buildEventStreamRequest(baseCfg(), ''), (e) => {
      assert.equal(e.status, 400);
      return true;
    });
  });
});

describe('devin-backend HTTP error mapping (non-401 cases)', () => {
  it('passes 403 through unchanged (auth/entitlement gate)', async () => {
    const { fetchImpl } = mockFetch({}, { ok: false, status: 403 });
    await assert.rejects(() => getSession(baseCfg(), 'devin-1', { fetchImpl }), (e) => {
      assert.equal(e.status, 403);
      assert.equal(e.type, 'backend_error');
      return true;
    });
  });

  it('normalizes 404 to 502 backend_error', async () => {
    const { fetchImpl } = mockFetch({}, { ok: false, status: 404 });
    await assert.rejects(() => getSession(baseCfg(), 'devin-1', { fetchImpl }), (e) => {
      assert.equal(e.status, 502);
      assert.equal(e.type, 'backend_error');
      return true;
    });
  });

  it('normalizes 429 to 502 backend_error', async () => {
    const { fetchImpl } = mockFetch({}, { ok: false, status: 429 });
    await assert.rejects(() => listSessions(baseCfg(), { fetchImpl }), (e) => {
      assert.equal(e.status, 502);
      return true;
    });
  });
});

describe('devin-backend fetch availability guard', () => {
  it('throws 500 backend_misconfigured when no fetch impl is available', async () => {
    const savedFetch = globalThis.fetch;
    // Simulate an environment with no global fetch and no injected impl.
    try {
      // eslint-disable-next-line no-global-assign
      globalThis.fetch = undefined;
      await assert.rejects(() => listSessions(baseCfg(), {}), (e) => {
        assert.equal(e.status, 500);
        assert.equal(e.type, 'backend_misconfigured');
        return true;
      });
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
