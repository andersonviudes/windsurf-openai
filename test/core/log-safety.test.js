import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { logHash, safeAccountRef, safeEmailRef, safeKeyRef } from '../../src/core/log-safety.js';

describe('log safety helpers', () => {
  it('keeps log references stable without exposing raw labels', () => {
    const email = 'operator@example.test';
    const key = 'sk-ws-01-secret-fixture-key';
    const account = { id: 'acct1234', email };

    const accountRef = safeAccountRef(account);
    const emailRef = safeEmailRef(email);
    const keyRef = safeKeyRef(key, 'apiKey');

    assert.equal(accountRef, `account=acct1234 labelHash=${logHash(email)}`);
    assert.equal(emailRef, `emailHash=${logHash(email)}`);
    assert.equal(keyRef, `apiKeyHash=${logHash(key)}`);

    assert.doesNotMatch(accountRef, /operator@example\.test/);
    assert.doesNotMatch(emailRef, /operator@example\.test/);
    assert.doesNotMatch(keyRef, /sk-ws-01-secret/);
  });

  it('does not reintroduce raw account labels or API key prefixes in sensitive logs', () => {
    const files = [
      'src/account-pool/auth.js',
      'src/chat-completions/chat.js',
      'src/dashboard/windsurf-login.js',
      'src/language-server/windsurf-api.js',
    ];

    const offenders = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const [idx, line] of src.split(/\r?\n/).entries()) {
        if (!/\blog\.(?:info|warn|error|debug)\b/.test(line)) continue;
        if (/\$\{(?:acct|account)\.email\}|\$\{email\}|(?:apiKey|reg\.api_key|currentApiKey)\??\.slice\(/.test(line)) {
          offenders.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      }
    }

    assert.deepEqual(offenders, []);
  });
});
