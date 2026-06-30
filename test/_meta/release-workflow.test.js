import { readFileSync, existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const release = readFileSync('.github/workflows/release.yml', 'utf8');
const publish = readFileSync('.github/workflows/publish.yml', 'utf8');
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

function jobBlock(workflow, name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `expected ${name} job`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/\n  [A-Za-z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('release workflow', () => {
  it('is dispatch-driven and bumps the version before building', () => {
    assert.match(release, /on:\s*\n\s*workflow_dispatch:/);
    assert.match(release, /\bbump:/);
    const test = jobBlock(release, 'test');
    const rel = jobBlock(release, 'release');
    assert.match(test, /\brun:\s*npm run test:release\b/);
    assert.match(test, /\btimeout-minutes:\s*10\b/);
    assert.match(rel, /\bneeds:\s*test\b/);
    assert.match(rel, /\btimeout-minutes:\s*30\b/);
    assert.match(rel, /\bnpm version\b/);
    assert.match(rel, /git push origin HEAD:main --follow-tags/);
    assert.match(rel, /\bnpm run build:exe:all\b/);
    assert.match(rel, /node scripts\/changelog\.mjs/);
    assert.match(rel, /body_path:\s*RELEASE_NOTES\.md/);
    assert.match(rel, /files:\s*dist\/windsurf-api-\*/);
  });

  it('publishes npm only after a successful Release', () => {
    assert.match(publish, /on:\s*\n\s*workflow_run:/);
    assert.match(publish, /workflows:\s*\[Release\]/);
    const npm = jobBlock(publish, 'npm');
    assert.match(npm, /github\.event\.workflow_run\.conclusion == 'success'/);
    assert.match(npm, /\bnpm publish\b/);
    assert.match(npm, /NODE_AUTH_TOKEN:\s*\$\{\{ secrets\.NPM_TOKEN \}\}/);
    assert.match(npm, /git rev-parse "v\$VERSION"/);
    assert.doesNotMatch(publish, /\n  docker:\n/);
  });

  it('uses the bounded release test gate in CI', () => {
    assert.match(ciWorkflow, /\bmatrix:\s*\n\s*shard:\s*\[0, 1, 2, 3\]/);
    assert.match(ciWorkflow, /\brun:\s*npm run test:shard -- \$\{\{ matrix\.shard \}\} 4\b/);
  });

  // Guards against a phantom path slipping into the gate: node --test errors
  // out on a missing file argument, which would fail the Release at runtime.
  it('test:release references only test files that exist', () => {
    const files = pkg.scripts['test:release'].match(/test\/\S+\.test\.js/g) || [];
    assert.ok(files.length > 0, 'expected test:release to list test files');
    for (const f of files) {
      assert.ok(existsSync(f), `test:release references a missing file: ${f}`);
    }
  });
});
