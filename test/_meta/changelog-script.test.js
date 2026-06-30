import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommit, renderChangelog } from '../../scripts/changelog.mjs';

describe('changelog: parseCommit', () => {
  it('parses type, scope, breaking, and subject', () => {
    assert.deepEqual(parseCommit('feat(dashboard)!: drop legacy login'), {
      type: 'feat', scope: 'dashboard', breaking: true, subject: 'drop legacy login',
    });
    assert.deepEqual(parseCommit('chore: bump version to v0.9.1'), {
      type: 'chore', scope: null, breaking: false, subject: 'bump version to v0.9.1',
    });
  });

  it('returns null for non-conventional subjects', () => {
    assert.equal(parseCommit('just some message'), null);
    assert.equal(parseCommit('Merge branch main'), null);
  });
});

describe('changelog: renderChangelog', () => {
  const out = renderChangelog({
    version: '1.2.3',
    date: '2026-06-30',
    repo: 'andersonviudes/windsurf-openai',
    commits: [
      'feat: configurable custom sinkhole IP (#141)',
      'fix: handle empty response',
      'chore: bump version to v1.2.3',
      'plain message with no type prefix',
      'flarble: unknown type goes to misc',
    ],
  });

  it('leads with the version + date header', () => {
    assert.match(out, /^## \[1\.2\.3\] - 2026-06-30\n/);
  });

  it('groups commits under emoji section titles in order', () => {
    assert.ok(out.indexOf('### ✨ Features') < out.indexOf('### 🐛 Bug Fixes'));
    assert.ok(out.indexOf('### 🐛 Bug Fixes') < out.indexOf('### 🔧 Miscellaneous'));
    assert.match(out, /### ✨ Features\n\n- feat - configurable custom sinkhole IP/);
  });

  it('links PR references against the repo', () => {
    assert.match(out, /\(\[#141\]\(https:\/\/github\.com\/andersonviudes\/windsurf-openai\/pull\/141\)\)/);
  });

  it('buckets unknown types into Miscellaneous and keeps the bump commit', () => {
    assert.match(out, /### 🔧 Miscellaneous\n\n(?:.*\n)*- flarble - unknown type goes to misc/);
    assert.match(out, /- chore - bump version to v1\.2\.3/);
  });

  it('drops non-conventional commits', () => {
    assert.doesNotMatch(out, /plain message with no type prefix/);
  });

  it('omits sections with no commits and falls back when empty', () => {
    assert.doesNotMatch(out, /Performance|Documentation/);
    assert.match(renderChangelog({ version: '0.0.1', date: '2026-01-01', commits: [] }), /_No notable changes\._/);
  });
});
