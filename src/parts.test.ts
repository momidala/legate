import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PartSchema,
  ToolStateSchema,
  ApiErrorSchema,
  validateParts,
} from './parts.js';

const BASE = { id: 'p_01', sessionID: 'ses_01', messageID: 'msg_01' };

// legate-ngl: validateParts — per-element salvage with honest typing.

function silenceStderr<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = original; }
}

test('legate-ngl: validateParts returns all parts and no dropped when every element is valid', () => {
  const raw = [
    { ...BASE, type: 'text', text: 'a' },
    { ...BASE, type: 'agent', name: 'qwen' },
  ];
  const { parts, dropped } = validateParts(raw, 'test');
  assert.equal(parts.length, 2);
  assert.equal(dropped, undefined, 'dropped is omitted on the happy path');
});

test('legate-ngl: validateParts salvages valid elements and counts the invalid ones', () => {
  const raw = [
    { ...BASE, type: 'text', text: 'keep me' },
    { ...BASE, type: 'bogus' },          // invalid discriminator
    { ...BASE, type: 'agent', name: 'q' },
    { nope: true },                       // not a part at all
  ];
  const { parts, dropped } = silenceStderr(() => validateParts(raw, 'test'));
  assert.equal(dropped, 2, 'two invalid elements dropped');
  assert.equal(parts.length, 2, 'two valid elements salvaged');
  assert.deepEqual((parts as Array<{ type: string }>).map((p) => p.type), ['text', 'agent']);
});

test('legate-ngl: validateParts emits exactly one warning naming the source and counts', () => {
  const raw = [{ ...BASE, type: 'text', text: 'ok' }, { ...BASE, type: 'bogus' }];
  let calls = 0;
  let captured = '';
  const original = console.error;
  console.error = (...args: unknown[]) => { calls++; captured = args.map(String).join(' '); };
  try {
    validateParts(raw, 'legate_await');
  } finally {
    console.error = original;
  }
  assert.equal(calls, 1, 'exactly one warning');
  assert.ok(captured.includes('legate_await'), `warning should name the source: ${captured}`);
  assert.ok(captured.includes('1 of 2'), `warning should count failures: ${captured}`);
});

test('legate-ngl: validateParts handles non-array input as an empty salvage set', () => {
  const { parts, dropped } = silenceStderr(() => validateParts({ not: 'an array' }, 'test'));
  assert.deepEqual(parts, []);
  assert.equal(dropped, 0);
});

test('PartSchema parses TextPart', () => {
  const p = { ...BASE, type: 'text', text: 'hello' };
  assert.equal(PartSchema.parse(p).type, 'text');
});

test('PartSchema parses ReasoningPart with required time', () => {
  const p = { ...BASE, type: 'reasoning', text: 'thinking', time: { start: 1 } };
  assert.equal(PartSchema.parse(p).type, 'reasoning');
});

test('PartSchema parses FilePart with required mime and url', () => {
  const p = { ...BASE, type: 'file', mime: 'text/plain', url: 'file:///a' };
  assert.equal(PartSchema.parse(p).type, 'file');
});

test('PartSchema parses ToolPart with completed state including required tool field', () => {
  const p = {
    ...BASE,
    type: 'tool',
    callID: 'call_1',
    tool: 'bash',
    state: { status: 'completed', input: {}, output: 'done', title: 't', metadata: {}, time: { start: 1, end: 2 } },
  };
  const parsed = PartSchema.parse(p);
  assert.equal(parsed.type, 'tool');
  if (parsed.type === 'tool') assert.equal(parsed.state.status, 'completed');
});

test('PartSchema parses StepFinishPart with required cost and tokens', () => {
  const p = {
    ...BASE,
    type: 'step-finish',
    reason: 'stop',
    cost: 0.0001,
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
  };
  assert.equal(PartSchema.parse(p).type, 'step-finish');
});

test('PartSchema parses RetryPart with ApiError shape', () => {
  const p = {
    ...BASE,
    type: 'retry',
    attempt: 1,
    error: { name: 'APIError', data: { message: 'rate limited', isRetryable: true } },
    time: { created: 1 },
  };
  const parsed = PartSchema.parse(p);
  if (parsed.type === 'retry') assert.equal(parsed.error.name, 'APIError');
});

test('PartSchema parses SubtaskPart (inline-only in SDK union)', () => {
  const p = { ...BASE, type: 'subtask', prompt: 'do x', description: 'd', agent: 'qwen' };
  assert.equal(PartSchema.parse(p).type, 'subtask');
});

test('PartSchema parses StepStartPart, SnapshotPart, PatchPart, AgentPart, CompactionPart', () => {
  assert.equal(PartSchema.parse({ ...BASE, type: 'step-start' }).type, 'step-start');
  assert.equal(PartSchema.parse({ ...BASE, type: 'snapshot', snapshot: 's' }).type, 'snapshot');
  assert.equal(PartSchema.parse({ ...BASE, type: 'patch', hash: 'h', files: ['a'] }).type, 'patch');
  assert.equal(PartSchema.parse({ ...BASE, type: 'agent', name: 'qwen' }).type, 'agent');
  assert.equal(PartSchema.parse({ ...BASE, type: 'compaction', auto: true }).type, 'compaction');
});

test('PartSchema rejects unknown discriminator', () => {
  assert.throws(() => PartSchema.parse({ ...BASE, type: 'bogus' }));
});

test('ToolStateSchema discriminates on status (NOT type)', () => {
  assert.equal(ToolStateSchema.parse({ status: 'pending', input: {}, raw: '...' }).status, 'pending');
  assert.equal(ToolStateSchema.parse({ status: 'running', input: {}, time: { start: 1 } }).status, 'running');
  assert.equal(ToolStateSchema.parse({ status: 'error', input: {}, error: 'boom', time: { start: 1, end: 2 } }).status, 'error');
});

test('ApiErrorSchema requires name "APIError"', () => {
  assert.equal(ApiErrorSchema.parse({ name: 'APIError', data: { message: 'm', isRetryable: false } }).name, 'APIError');
  assert.throws(() => ApiErrorSchema.parse({ name: 'Other', data: { message: 'm', isRetryable: false } }));
});
