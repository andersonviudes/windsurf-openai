import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrajectorySteps } from '../../src/language-server/windsurf.js';
import { writeVarintField, writeMessageField } from '../../src/language-server/proto.js';
import { isSafeComposeProject, isSafeComposeWorkingDir } from '../../src/dashboard/docker-self-update.js';
import { extractIntentFromNarrative, detectToolIntentInNarrative } from '../../src/chat-completions/intent-extractor.js';

// ── #1: parseTrajectorySteps robustness against malformed protobuf ──
test('#1 parseTrajectorySteps returns [] on a malformed root buffer', () => {
  // 0xff 0xff 0xff is an unterminated varint — parseFields throws.
  assert.deepEqual(parseTrajectorySteps(Buffer.from([0xff, 0xff, 0xff])), []);
});

test('#1 parseTrajectorySteps skips a single malformed step, keeps the good one', () => {
  const goodStep = writeVarintField(1, 14);            // CortexTrajectoryStep.type = 14
  const badStep = Buffer.from([0x12, 0x05, 0x01]);     // field 2 len-delim claims 5 bytes, has 1
  const buf = Buffer.concat([
    writeMessageField(1, goodStep),
    writeMessageField(1, badStep),
  ]);
  const steps = parseTrajectorySteps(buf);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 14);
});

// ── #2: docker self-update compose-label safety validation ──
test('#2 isSafeComposeProject accepts normal names, rejects shell metachars', () => {
  assert.equal(isSafeComposeProject('windsurfapi'), true);
  assert.equal(isSafeComposeProject('my_proj-1.2'), true);
  assert.equal(isSafeComposeProject('a;rm -rf /'), false);
  assert.equal(isSafeComposeProject('$(whoami)'), false);
  assert.equal(isSafeComposeProject("a'\\''b"), false);
  assert.equal(isSafeComposeProject(''), false);
  assert.equal(isSafeComposeProject(null), false);
});

test('#2 isSafeComposeWorkingDir requires a clean absolute path', () => {
  assert.equal(isSafeComposeWorkingDir('/srv/WindsurfAPI'), true);
  assert.equal(isSafeComposeWorkingDir('/app'), true);
  assert.equal(isSafeComposeWorkingDir('relative/path'), false);
  assert.equal(isSafeComposeWorkingDir('/has\nnewline'), false);
  assert.equal(isSafeComposeWorkingDir(''), false);
});

// ── #3: ReDoS/CPU bound on narrative tool-intent extraction ──
test('#3 extractIntentFromNarrative stays bounded on oversized input', () => {
  const tools = [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: {} } } }];
  const huge = 'please use the Read tool to read the file '.repeat(40000); // ~1.7MB
  const t0 = Date.now();
  const r = extractIntentFromNarrative(huge, tools, { lastUserText: 'read the file please', minConfidence: 0 });
  const elapsed = Date.now() - t0;
  assert.ok(Array.isArray(r));
  assert.ok(elapsed < 3000, `extraction took ${elapsed}ms, expected < 3000ms`);
});

test('#3 detectToolIntentInNarrative stays bounded and still works on normal input', () => {
  const tools = [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: {} } } }];
  const huge = '<analysis>'.repeat(60000);
  const t0 = Date.now();
  const r = detectToolIntentInNarrative(huge, tools, { lastUserText: 'read the file please' });
  assert.ok(Date.now() - t0 < 3000);
  assert.ok(r === null || typeof r === 'string');
  // normal input still detects intent
  const ok = detectToolIntentInNarrative('let me use the Read tool now', tools, { lastUserText: 'please read the file' });
  assert.ok(ok === null || typeof ok === 'string');
});
