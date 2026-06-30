#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../src/core/config.js';
import { getEffectiveProxy } from '../src/core/proxy-config.js';
import { getWebSearchResults } from '../src/language-server/windsurf-api.js';

const query = process.env.WEB_SEARCH_PROBE_QUERY || 'WindsurfAPI native bridge protocol';
const limit = Math.max(1, Math.min(10, Number(process.env.WEB_SEARCH_PROBE_LIMIT || 3)));
const accountId = process.env.WEB_SEARCH_PROBE_ACCOUNT || '';
const accountKeyEnv = process.env.WEB_SEARCH_PROBE_API_KEY
  || process.env.CODEIUM_API_KEY
  || process.env.WINDSURFAPI_CODEIUM_API_KEY
  || '';
const accountsFile = process.env.WEB_SEARCH_PROBE_ACCOUNTS_FILE
  || join(config.sharedDataDir || config.dataDir || process.cwd(), 'accounts.json');

function compact(value, max = 500) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}...<truncated ${s.length - max} chars>` : s;
}

function summarizeResult(item) {
  if (!item || typeof item !== 'object') return item;
  const out = {};
  for (const key of ['title', 'name', 'url', 'sourceUrl', 'webUrl', 'snippet', 'summary', 'text', 'content']) {
    if (item[key] != null) out[key] = typeof item[key] === 'string' ? compact(item[key], 240) : item[key];
  }
  if (!Object.keys(out).length) {
    for (const [key, value] of Object.entries(item).slice(0, 8)) {
      if (/apiKey|token|secret|password/i.test(key)) continue;
      out[key] = typeof value === 'string' ? compact(value, 160) : value;
    }
  }
  return out;
}

function readPersistedAccounts() {
  if (!existsSync(accountsFile)) return [];
  try {
    const data = JSON.parse(readFileSync(accountsFile, 'utf8'));
    if (!Array.isArray(data)) return [];
    return data.filter(a => a && typeof a === 'object' && a.apiKey);
  } catch (error) {
    throw new Error(`Failed to read accounts file ${accountsFile}: ${error.message}`);
  }
}

function selectAccounts() {
  const directKeys = String(accountKeyEnv || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (directKeys.length) {
    return directKeys.map((apiKey, index) => ({
      id: `env-account-key-${index + 1}`,
      email: '',
      apiKey,
      direct: true,
      proxy: null,
    }));
  }

  const accounts = readPersistedAccounts()
    .filter(a => a.status === 'active' && a.apiKey);
  if (accountId) return accounts.filter(a => a.id === accountId || a.email === accountId);
  return accounts;
}

const accounts = selectAccounts();
if (!accounts.length) {
  console.error('No active upstream account found. Set WEB_SEARCH_PROBE_API_KEY/CODEIUM_API_KEY, or point WEB_SEARCH_PROBE_ACCOUNTS_FILE at accounts.json.');
  process.exit(2);
}

const results = [];
for (const account of accounts) {
  const proxy = account.proxy || (!account.direct ? getEffectiveProxy(account.id) : null);
  const started = Date.now();
  try {
    const out = await getWebSearchResults(account.apiKey, { query, limit }, proxy);
    results.push({
      ok: true,
      accountId: account.id,
      email: account.email || '',
      latencyMs: Date.now() - started,
      resultCount: Array.isArray(out.results) ? out.results.length : 0,
      webSearchUrl: out.webSearchUrl || '',
      summary: compact(out.summary, 500),
      results: (out.results || []).slice(0, limit).map(summarizeResult),
    });
  } catch (error) {
    results.push({
      ok: false,
      accountId: account.id,
      email: account.email || '',
      latencyMs: Date.now() - started,
      error: String(error?.message || error),
    });
  }
}

console.log(JSON.stringify({
  ok: results.every(r => r.ok),
  query,
  limit,
  accountSource: accountKeyEnv ? 'env-account-key' : accountsFile,
  accountCount: accounts.length,
  results,
}, null, 2));

if (!results.every(r => r.ok)) process.exit(1);
