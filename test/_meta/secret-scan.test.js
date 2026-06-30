import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));

function runSecretScan(args = []) {
  return spawnSync(process.execPath, ['scripts/secret-scan.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('secret scan', () => {
  it('reports only path, line, and rule without printing secret values', () => {
    const dir = join(root, 'tmp', 'secret-scan-test');
    const file = join(dir, 'fixture.js');
    const apiKey = 'sk-' + 'A'.repeat(32);
    const password = 'secret-value-' + 'B'.repeat(24);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(file, `const apiKey = "${apiKey}";\nconst password = "${password}";\n`);
      const result = runSecretScan(['tmp/secret-scan-test/fixture.js']);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /tmp\/secret-scan-test\/fixture\.js:1 openai-api-key/);
      assert.match(result.stdout, /tmp\/secret-scan-test\/fixture\.js:2 literal-credential-assignment/);
      assert.doesNotMatch(result.stdout, new RegExp(apiKey));
      assert.doesNotMatch(result.stdout, new RegExp(password));
      assert.equal(result.stderr, '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes on the tracked repository contents', () => {
    const result = runSecretScan();
    assert.equal(result.status, 0, result.stdout || result.stderr);
  });
});
