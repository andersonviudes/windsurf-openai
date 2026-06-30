#!/usr/bin/env node
// Generates a grouped, conventional-commit changelog for a release, in the
// keep-a-changelog-ish style git-cliff produces: a `## [x.y.z] - DATE` header
// followed by emoji-titled sections (Features / Bug Fixes / ... ) of bullets.
//
// Usage: node scripts/changelog.mjs [version] > RELEASE_NOTES.md
//   - version defaults to package.json's version.
//   - The commit range is `<previous tag>..<vVERSION|HEAD>` (merges excluded).
//   - PR references (`#123`) are linked when GITHUB_REPOSITORY is set (Actions
//     sets it automatically) or an `origin` remote is present.
//
// Zero dependencies — only node:* builtins, in keeping with the project.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// type -> section title, in display order. Unknown types fall into the last
// bucket (Miscellaneous) so nothing is silently dropped.
const SECTIONS = [
  ['feat', '✨ Features'],
  ['fix', '🐛 Bug Fixes'],
  ['perf', '⚡ Performance'],
  ['refactor', '♻️ Refactoring'],
  ['docs', '📝 Documentation'],
  ['test', '🧪 Testing'],
  ['build', '📦 Build'],
  ['ci', '👷 CI'],
  ['style', '🎨 Styling'],
  ['revert', '⏪ Revert'],
  ['chore', '🔧 Miscellaneous'],
];
const MISC = 'chore';
const KNOWN = new Set(SECTIONS.map(([t]) => t));

export function parseCommit(subject) {
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(String(subject).trim());
  if (!m) return null;
  return { type: m[1].toLowerCase(), scope: m[2] || null, breaking: Boolean(m[3]), subject: m[4].trim() };
}

function linkPRs(text, repo) {
  if (!repo) return text;
  return text.replace(/#(\d+)/g, (_full, n) => `[#${n}](https://github.com/${repo}/pull/${n})`);
}

export function renderChangelog({ version, date, repo = null, commits = [] }) {
  const buckets = new Map(SECTIONS.map(([t]) => [t, []]));
  for (const raw of commits) {
    const c = parseCommit(raw);
    if (!c) continue;
    const bucket = KNOWN.has(c.type) ? c.type : MISC;
    const scope = c.scope ? `(${c.scope})` : '';
    const mark = c.breaking ? '**[breaking]** ' : '';
    buckets.get(bucket).push(`- ${mark}${c.type}${scope} - ${linkPRs(c.subject, repo)}`);
  }

  const lines = [`## [${version}] - ${date}`];
  for (const [type, title] of SECTIONS) {
    const items = buckets.get(type);
    if (!items.length) continue;
    lines.push('', `### ${title}`, '', ...items);
  }
  if (lines.length === 1) lines.push('', '_No notable changes._');
  return lines.join('\n') + '\n';
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function tryGit(args) {
  try { return git(args); } catch { return null; }
}

function detectRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = tryGit(['remote', 'get-url', 'origin']);
  const m = url && /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return m ? m[1] : null;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  const version = (process.argv[2] || pkg.version).replace(/^v/, '');

  // Prefer the release tag's commit; fall back to HEAD for a local dry run.
  const tag = `v${version}`;
  const head = tryGit(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`]) ? tag : 'HEAD';
  const prev = tryGit(['describe', '--tags', '--abbrev=0', `${head}^`]);
  const range = prev ? `${prev}..${head}` : head;

  const log = tryGit(['log', range, '--no-merges', '--pretty=format:%s']) || '';
  const commits = log.split('\n').filter(Boolean);
  const date = tryGit(['log', '-1', '--pretty=%cs', head]) || new Date().toISOString().slice(0, 10);

  process.stdout.write(renderChangelog({ version, date, repo: detectRepo(), commits }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
