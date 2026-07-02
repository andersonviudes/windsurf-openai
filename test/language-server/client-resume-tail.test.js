import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resumeTailMessages } from '../../src/language-server/client.js';

// Regression for "I don't see an actual question or task in your latest
// message": the resume path used to send only convo[length-1] upstream,
// but a tool_result turn from /v1/messages arrives as several messages
// (one synthetic <tool_result> user turn per result plus a trailing user
// text turn). Resume must send every message after the newest assistant
// turn — the exact turn the pool's fingerprint/digest checkout verified.
describe('resumeTailMessages', () => {
  it('returns every message after the newest assistant turn (batched tool_results)', () => {
    const convo = [
      { role: 'user', content: 'refactor the login flow' },
      { role: 'assistant', content: 'I will read the file first.\n<tool_call id="a">read_file</tool_call>' },
      { role: 'user', content: '<tool_result tool_call_id="a">\nfile contents A\n</tool_result>' },
      { role: 'user', content: '<tool_result tool_call_id="b">\nfile contents B\n</tool_result>' },
      { role: 'user', content: '<system-reminder>CLAUDE.md loaded</system-reminder>' },
    ];
    const tail = resumeTailMessages(convo);
    assert.equal(tail.length, 3);
    assert.deepEqual(tail, convo.slice(2));
    // The tool results — not just the trailing reminder text — are in the tail.
    assert.ok(tail.some(m => m.content.includes('file contents A')));
    assert.ok(tail.some(m => m.content.includes('file contents B')));
  });

  it('returns only the newest message on a plain text turn', () => {
    const convo = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi, what can I do?' },
      { role: 'user', content: 'write a haiku' },
    ];
    assert.deepEqual(resumeTailMessages(convo), [convo[2]]);
  });

  it('anchors on the NEWEST assistant turn, not an earlier one', () => {
    const convo = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: '<tool_result tool_call_id="x">\nold result\n</tool_result>' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'q2' },
    ];
    assert.deepEqual(resumeTailMessages(convo), [convo[4]]);
  });

  it('falls back to the newest message when there is no assistant turn', () => {
    const convo = [{ role: 'user', content: 'first message' }];
    assert.deepEqual(resumeTailMessages(convo), [convo[0]]);
  });

  it('falls back to the newest message when the history ends with the assistant turn', () => {
    const convo = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ];
    assert.deepEqual(resumeTailMessages(convo), [convo[1]]);
  });

  it('returns [] for empty or non-array input', () => {
    assert.deepEqual(resumeTailMessages([]), []);
    assert.deepEqual(resumeTailMessages(null), []);
    assert.deepEqual(resumeTailMessages(undefined), []);
  });
});
