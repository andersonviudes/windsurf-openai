import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  __setWindsurfApiPostJsonForTest,
  getWebSearchResults,
} from '../../src/language-server/windsurf-api.js';

afterEach(() => {
  __setWindsurfApiPostJsonForTest(null);
});

describe('direct Windsurf web search API helper', () => {
  it('posts confirmed GetWebSearchResults fields and normalizes response', async () => {
    const calls = [];
    __setWindsurfApiPostJsonForTest(async (host, path, body, proxy) => {
      calls.push({ host, path, body, proxy });
      return {
        status: 200,
        data: {
          results: [{ title: 'WindsurfAPI', url: 'https://example.com/a' }],
          webSearchUrl: 'https://search.example/?q=WindsurfAPI',
          summary: 'one result',
        },
        raw: '{}',
      };
    });

    const out = await getWebSearchResults('key-123', {
      query: ' WindsurfAPI native bridge ',
      limit: 99,
      domain: 'github.com',
      thirdPartyConfig: { provider: 1, model: 3 },
      mode: 2,
    }, { host: 'proxy.local', port: 8080 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/exa.api_server_pb.ApiServerService/GetWebSearchResults');
    assert.equal(calls[0].body.metadata.apiKey, 'key-123');
    assert.equal(calls[0].body.query, 'WindsurfAPI native bridge');
    assert.equal(calls[0].body.limit, 10);
    assert.equal(calls[0].body.domain, 'github.com');
    assert.deepEqual(calls[0].body.thirdPartyConfig, { provider: 1, model: 3 });
    assert.equal(calls[0].body.mode, 2);
    assert.equal(out.results.length, 1);
    assert.equal(out.webSearchUrl, 'https://search.example/?q=WindsurfAPI');
    assert.equal(out.summary, 'one result');
    assert.equal(typeof out.fetchedAt, 'number');
  });

  it('falls back across hosts on upstream HTTP failures', async () => {
    const calls = [];
    __setWindsurfApiPostJsonForTest(async (host, path, body) => {
      calls.push({ host, path, body });
      if (calls.length === 1) return { status: 500, data: {}, raw: 'temporary' };
      return { status: 200, data: { results: [] }, raw: '{}' };
    });

    const out = await getWebSearchResults('key-123', { query: 'q', limit: 0 });
    assert.deepEqual(out.results, []);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].host, 'server.codeium.com');
    assert.equal(calls[1].host, 'server.self-serve.windsurf.com');
    assert.equal(calls[1].body.limit, 5);
  });

  it('rejects empty queries before sending network traffic', async () => {
    let called = false;
    __setWindsurfApiPostJsonForTest(async () => {
      called = true;
      return { status: 200, data: {}, raw: '{}' };
    });

    await assert.rejects(
      () => getWebSearchResults('key-123', { query: '   ' }),
      /query required/,
    );
    assert.equal(called, false);
  });
});
