import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capDiffResponse,
  capMessagesResponse,
  maxResponseChars,
  DEFAULT_MAX_RESPONSE_CHARS,
  type TruncatedDiff,
  type TruncatedMessages,
} from './response-cap.js';

// legate-ur1: unit coverage for the response-size caps. The pure functions are tested
// directly (cheapest honest test) — the tool handlers just call them.

function bigFileDiff(patchLen: number, blobLen: number) {
  return {
    file: 'src/big.ts',
    before: 'b'.repeat(blobLen),
    after: 'a'.repeat(blobLen),
    additions: 1,
    deletions: 1,
    patch: 'p'.repeat(patchLen),
    status: 'modified',
  };
}

test('legate-ur1: capDiffResponse returns the array unchanged when under the cap', () => {
  const diffs = [bigFileDiff(10, 10)];
  const out = capDiffResponse(diffs, 1_000_000);
  assert.ok(Array.isArray(out), 'small diff should pass through as an array');
  assert.equal((out as typeof diffs)[0].before, diffs[0].before);
});

test('legate-ur1: capDiffResponse drops before/after first and marks truncated', () => {
  // Cap chosen so the array-with-blobs exceeds it, but the stripped envelope fits.
  const diffs = [bigFileDiff(50, 5000)];
  const out = capDiffResponse(diffs, 2000);
  assert.equal((out as TruncatedDiff).truncated, true);
  const files = (out as TruncatedDiff).files;
  assert.equal(files.length, 1);
  assert.ok(!('before' in files[0]), 'before should be dropped');
  assert.ok(!('after' in files[0]), 'after should be dropped');
  // Patch was small enough to survive untouched once blobs were dropped.
  assert.equal(files[0].patch, 'p'.repeat(50));
  assert.ok(JSON.stringify(out).length <= 2000, 'envelope must fit under the cap');
});

test('legate-ur1: capDiffResponse truncates patch strings when stripping is not enough', () => {
  const diffs = [bigFileDiff(20_000, 100)];
  const cap = 500;
  const out = capDiffResponse(diffs, cap) as TruncatedDiff;
  assert.equal(out.truncated, true);
  assert.ok(out.files[0].patch.includes('…[truncated'), `patch should carry the truncation marker: ${out.files[0].patch.slice(-40)}`);
  assert.ok(JSON.stringify(out).length <= cap, 'truncated envelope must fit under the cap');
});

test('legate-ur1: capDiffResponse handles a cap smaller than any patch (budget→0)', () => {
  const diffs = [bigFileDiff(10_000, 100), bigFileDiff(10_000, 100)];
  const cap = 200;
  const out = capDiffResponse(diffs, cap) as TruncatedDiff;
  assert.equal(out.truncated, true);
  // Even with an aggressive cap it must terminate and stay bounded (patches collapse to the suffix).
  for (const f of out.files) assert.ok(f.patch.includes('…[truncated'));
});

test('legate-ur1: capMessagesResponse returns the array unchanged when under the cap', () => {
  const msgs = [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }];
  const out = capMessagesResponse(msgs, 1_000_000);
  assert.ok(Array.isArray(out));
  assert.equal((out as unknown[]).length, 1);
});

test('legate-ur1: capMessagesResponse drops oldest messages and reports the count', () => {
  // 10 messages, each ~200 chars; cap forces dropping the oldest ones.
  const msgs = Array.from({ length: 10 }, (_v, i) => ({
    info: { role: 'assistant', idx: i },
    parts: [{ type: 'text', text: 'x'.repeat(180) }],
  }));
  const cap = 900;
  const out = capMessagesResponse(msgs, cap) as TruncatedMessages;
  assert.equal(out.truncated, true);
  assert.ok(out.omittedMessages > 0, 'some messages should be omitted');
  assert.equal(out.omittedMessages + out.messages.length, 10, 'omitted + kept === total');
  assert.ok(JSON.stringify(out).length <= cap, 'envelope must fit under the cap');
  // The kept messages must be the NEWEST ones (oldest dropped from the front).
  const keptIdx = (out.messages as Array<{ info: { idx: number } }>).map((m) => m.info.idx);
  assert.deepEqual(keptIdx, [...keptIdx].sort((a, b) => a - b), 'kept indices ascending');
  assert.equal(keptIdx[keptIdx.length - 1], 9, 'the newest message is retained');
});

test('legate-ur1: capMessagesResponse degrades to empty messages when even one exceeds the cap', () => {
  const msgs = [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'z'.repeat(5000) }] }];
  const out = capMessagesResponse(msgs, 100) as TruncatedMessages;
  assert.equal(out.truncated, true);
  assert.equal(out.messages.length, 0);
  assert.equal(out.omittedMessages, 1);
});

test('legate-ur1: maxResponseChars defaults to 400000 and honors LEGATE_MAX_RESPONSE_CHARS', () => {
  const original = process.env.LEGATE_MAX_RESPONSE_CHARS;
  try {
    delete process.env.LEGATE_MAX_RESPONSE_CHARS;
    assert.equal(maxResponseChars(), DEFAULT_MAX_RESPONSE_CHARS);
    assert.equal(DEFAULT_MAX_RESPONSE_CHARS, 400_000);
    process.env.LEGATE_MAX_RESPONSE_CHARS = '12345';
    assert.equal(maxResponseChars(), 12345);
  } finally {
    if (original === undefined) delete process.env.LEGATE_MAX_RESPONSE_CHARS;
    else process.env.LEGATE_MAX_RESPONSE_CHARS = original;
  }
});
