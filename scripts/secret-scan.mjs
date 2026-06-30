#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);

const RULES = [
  {
    id: 'openai-api-key',
    regex: /sk-[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'literal-credential-assignment',
    regex: /\b(?:secret|token|password)\b\s*[:=]\s*["'][A-Za-z0-9_./+=-]{16,}["']/gi,
  },
  {
    id: 'private-key-block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    id: 'credentialed-email-example',
    regex: /[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}["']?\s*,\s*["']?password["']?\s*:/gi,
  },
];

const IGNORED_PATHS = new Set([
  'scripts/secret-scan.mjs',
  'test/_meta/secret-scan.test.js',
]);

const IGNORED_PREFIXES = [
  'test/',
  'test/_research/',
];

const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.db',
]);

function toRepoPath(file) {
  return relative(root, resolve(root, file)).split(sep).join('/');
}

function isIgnored(file) {
  const repoPath = toRepoPath(file);
  if (!repoPath || repoPath.startsWith('..') || repoPath.includes('\0')) return true;
  if (IGNORED_PATHS.has(repoPath)) return true;
  if (IGNORED_PREFIXES.some(prefix => repoPath.startsWith(prefix))) return true;
  const lower = repoPath.toLowerCase();
  return [...IGNORED_EXTENSIONS].some(ext => lower.endsWith(ext));
}

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean);
}

function inputFiles() {
  if (args.length) return args;
  return trackedFiles();
}

function lineForOffset(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function scanFile(file) {
  if (isIgnored(file)) return [];
  const abs = resolve(root, file);
  if (!existsSync(abs) || !statSync(abs).isFile()) return [];
  const text = readFileSync(abs, 'utf8');
  const findings = [];
  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    for (const match of text.matchAll(rule.regex)) {
      findings.push({
        path: toRepoPath(file),
        line: lineForOffset(text, match.index || 0),
        rule: rule.id,
      });
    }
  }
  return findings;
}

const findings = inputFiles().flatMap(scanFile)
  .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule));

for (const finding of findings) {
  console.log(`${finding.path}:${finding.line} ${finding.rule}`);
}

if (findings.length) process.exitCode = 1;
