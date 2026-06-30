import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { config, loadConfigFile, requireAuthConfigured } from '../../src/core/config.js';

// loadConfigFile mutates process.env; snapshot the keys we touch and the auth
// fields on the shared `config` object, then restore so other tests are clean.
const TOUCHED = ['CF_TEST_FILLED', 'CF_TEST_EXISTING', 'CF_TEST_NUM', 'CF_TEST_NULL'];
const AUTH_FIELDS = ['codeiumApiKey', 'codeiumAuthToken', 'codeiumEmail', 'codeiumPassword'];
const accountsPath = join(config.sharedDataDir, 'accounts.json');

let tmp;
let envSnapshot;
let authSnapshot;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cf-test-'));
  envSnapshot = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
  authSnapshot = Object.fromEntries(AUTH_FIELDS.map((k) => [k, config[k]]));
  for (const k of AUTH_FIELDS) config[k] = '';
  try { rmSync(accountsPath, { force: true }); } catch {}
});

afterEach(() => {
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const [k, v] of Object.entries(authSnapshot)) config[k] = v;
  try { rmSync(accountsPath, { force: true }); } catch {}
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

function writeConfig(obj) {
  const p = join(tmp, 'config.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

describe('loadConfigFile (fallback below ENV)', () => {
  it('fills keys not already in process.env, coercing to strings', () => {
    loadConfigFile(writeConfig({ CF_TEST_FILLED: 'fromfile', CF_TEST_NUM: 42 }));
    assert.equal(process.env.CF_TEST_FILLED, 'fromfile');
    assert.equal(process.env.CF_TEST_NUM, '42');
  });

  it('never overwrites a value already present in the environment', () => {
    process.env.CF_TEST_EXISTING = 'fromenv';
    loadConfigFile(writeConfig({ CF_TEST_EXISTING: 'fromfile' }));
    assert.equal(process.env.CF_TEST_EXISTING, 'fromenv');
  });

  it('skips _-prefixed comment keys and null values', () => {
    loadConfigFile(writeConfig({ _comment: 'docs', CF_TEST_NULL: null, CF_TEST_FILLED: 'x' }));
    assert.equal(process.env._comment, undefined);
    assert.equal(process.env.CF_TEST_NULL, undefined);
    assert.equal(process.env.CF_TEST_FILLED, 'x');
  });

  it('does not throw on a missing file, bad JSON, or a non-object root', () => {
    assert.doesNotThrow(() => loadConfigFile(join(tmp, 'nope.json')));
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, '{ this is not json ');
    assert.doesNotThrow(() => loadConfigFile(bad));
    assert.doesNotThrow(() => loadConfigFile(writeConfig(['array', 'root'])));
    assert.equal(process.env.CF_TEST_FILLED, undefined);
  });
});

describe('requireAuthConfigured', () => {
  it('is false with no credentials and no accounts.json', () => {
    assert.equal(requireAuthConfigured(), false);
  });

  it('is true when an env/file credential is set', () => {
    config.codeiumApiKey = 'sk-test';
    assert.equal(requireAuthConfigured(), true);
  });

  it('is true with email + password together, false with only one', () => {
    config.codeiumEmail = 'a@b.c';
    assert.equal(requireAuthConfigured(), false);
    config.codeiumPassword = 'pw';
    assert.equal(requireAuthConfigured(), true);
  });

  it('is true when accounts.json holds at least one account', () => {
    writeFileSync(accountsPath, JSON.stringify([{ id: 'a1', apiKey: 'k' }]));
    assert.equal(requireAuthConfigured(), true);
  });

  it('is false for an empty or malformed accounts.json', () => {
    writeFileSync(accountsPath, JSON.stringify([]));
    assert.equal(requireAuthConfigured(), false);
    writeFileSync(accountsPath, 'not json');
    assert.equal(requireAuthConfigured(), false);
  });
});
