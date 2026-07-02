import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// CASCADE_REUSE_BY_CALLER is read once at module load, so it must be set
// before the pool module is imported (dynamic import below). `node --test`
// runs each test file in its own process, so this doesn't leak into other
// test files.
process.env.CASCADE_REUSE_BY_CALLER = '1';
const {
  fingerprintBefore, fingerprintAfter, lastAssistantDigest,
  checkout, checkin, poolClear, poolStats,
} = await import('../../src/conversation-cache/conversation-pool.js');

const CALLER = 'api:k1:client:abc';
const MODEL = 'claude-opus-4-7';

// Chat A: two completed turns, cascade checked in after the second reply.
const chatAComplete = [
  { role: 'user', content: 'tell me about apples' },
  { role: 'assistant', content: 'Apples are pomaceous fruit.' },
  { role: 'user', content: 'and pears?' },
  { role: 'assistant', content: 'Pears are also pomaceous fruit.' },
];

function checkinChatA() {
  const fpAfter = fingerprintAfter(chatAComplete, MODEL, CALLER);
  checkin(fpAfter, {
    cascadeId: 'cascade-a', sessionId: 'sess-a', lsPort: 42200,
    apiKey: 'key-a', modelKey: MODEL,
    lastAssistantDigest: lastAssistantDigest(chatAComplete),
  }, CALLER);
  return fpAfter;
}

describe('lastAssistantDigest', () => {
  it('returns empty string when there is no assistant turn', () => {
    assert.equal(lastAssistantDigest([{ role: 'user', content: 'hi' }]), '');
    assert.equal(lastAssistantDigest([]), '');
    assert.equal(lastAssistantDigest(null), '');
  });

  it('is stable across whitespace reformatting (same canonicalization as fingerprints)', () => {
    const a = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'reply\n\n text' }];
    const b = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'reply   text' }];
    assert.equal(lastAssistantDigest(a), lastAssistantDigest(b));
  });

  it('differs when the assistant turn differs', () => {
    const a = [{ role: 'assistant', content: 'reply one' }];
    const b = [{ role: 'assistant', content: 'reply two' }];
    assert.notEqual(lastAssistantDigest(a), lastAssistantDigest(b));
  });
});

describe('caller-based fallback requires continuation evidence', () => {
  beforeEach(() => poolClear());

  it('a brand-new chat (no assistant history) never resumes the previous cascade', () => {
    checkinChatA();
    // New chat: single user turn → fingerprintBefore is null, evidence ''.
    const newChat = [{ role: 'user', content: 'hello, unrelated new topic' }];
    const fp = fingerprintBefore(newChat, MODEL, CALLER);
    assert.equal(fp, null);
    const entry = checkout(fp, CALLER, null, MODEL, lastAssistantDigest(newChat));
    assert.equal(entry, null);
  });

  it('an unrelated multi-turn conversation from the same caller does not steal the cascade', () => {
    checkinChatA();
    // Chat B has real history but a different last assistant turn. Force a
    // primary miss by using a fingerprint the pool has never seen.
    const chatB = [
      { role: 'user', content: 'write me a poem' },
      { role: 'assistant', content: 'Roses are red...' },
      { role: 'user', content: 'longer please' },
    ];
    const fpB = fingerprintBefore(chatB, MODEL, CALLER);
    assert.ok(fpB); // multi-turn → real fingerprint, but not in the pool
    const entry = checkout(fpB, CALLER, null, MODEL, lastAssistantDigest(chatB));
    assert.equal(entry, null);
    assert.ok(poolStats().callerFallbackRejects >= 1);
  });

  it('a genuine continuation with fingerprint drift still falls back', () => {
    checkinChatA();
    // Next turn of chat A, but the system prompt changed → primary
    // fingerprint misses. The echoed assistant turn proves continuation.
    const nextTurn = [
      { role: 'system', content: 'NEW system prompt that drifted' },
      ...chatAComplete,
      { role: 'user', content: 'and quinces?' },
    ];
    const fpDrifted = fingerprintBefore(nextTurn, MODEL, CALLER);
    assert.ok(fpDrifted);
    const entry = checkout(fpDrifted, CALLER, null, MODEL, lastAssistantDigest(nextTurn));
    assert.ok(entry, 'drift-with-evidence should fall back');
    assert.equal(entry.cascadeId, 'cascade-a');
    assert.ok(poolStats().callerFallbackHits >= 1);
  });

  it('unhashable history (fingerprint null) with matching evidence still falls back', () => {
    checkinChatA();
    // Prior history contains an unhashable image → fingerprintBefore null,
    // but the echoed assistant turn still proves continuation.
    const withMedia = [
      ...chatAComplete,
      { role: 'user', content: [{ type: 'image_url', image_url: {} }, { type: 'text', text: 'and this?' }] },
    ];
    const entry = checkout(null, CALLER, null, MODEL, lastAssistantDigest(withMedia));
    assert.ok(entry);
    assert.equal(entry.cascadeId, 'cascade-a');
  });

  it('entries stored without a digest are never fallback-able', () => {
    const fpAfter = fingerprintAfter(chatAComplete, MODEL, CALLER);
    checkin(fpAfter, {
      cascadeId: 'cascade-legacy', sessionId: 's', lsPort: 1, apiKey: 'k', modelKey: MODEL,
      // no lastAssistantDigest (pre-upgrade entry shape)
    }, CALLER);
    const nextTurn = [...chatAComplete, { role: 'user', content: 'more' }];
    // Unknown fingerprint → primary miss → fallback path.
    const entry = checkout('deadbeef'.repeat(8), CALLER, null, MODEL, lastAssistantDigest(nextTurn));
    assert.equal(entry, null);
  });

  it('the primary fingerprint path is unaffected by evidence', () => {
    const fpAfter = checkinChatA();
    // Exact fingerprint hit works even with empty evidence.
    const entry = checkout(fpAfter, CALLER, null, MODEL, '');
    assert.ok(entry);
    assert.equal(entry.cascadeId, 'cascade-a');
  });

  it('checkin preserves lastAssistantDigest across restore (failure-path re-checkin)', () => {
    checkinChatA();
    const nextTurn = [...chatAComplete, { role: 'user', content: 'and quinces?' }];
    const evidence = lastAssistantDigest(nextTurn);
    const entry = checkout('deadbeef'.repeat(8), CALLER, null, MODEL, evidence);
    assert.ok(entry);
    // Simulate the failure path: restore the checked-out entry as-is.
    checkin('deadbeef'.repeat(8), entry, CALLER);
    const again = checkout('cafebabe'.repeat(8), CALLER, null, MODEL, evidence);
    assert.ok(again, 'restored entry should keep its digest and stay fallback-able');
    assert.equal(again.cascadeId, 'cascade-a');
  });
});
