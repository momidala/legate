import { test } from 'node:test';
import assert from 'node:assert/strict';
// legate-o1u: import the REAL registered schema instead of a phantom local copy. The
// assertions below now exercise exactly the schema the tool registers (../schemas.ts,
// used by tools/session.ts), so schema drift can no longer pass this test unnoticed.
import { SessionCommandInputSchema as CommandInputSchema } from './schemas.js';

// CMD-01 behavior tests for legate_session_command input schema.
// These verify that the Zod schema for the tool's inputSchema enforces
// the correct shape — in particular that `model` is a plain string (NOT
// { providerID, modelID }) and that `command` + `arguments` are required.

test('CMD-01: schema accepts required fields only', () => {
  const result = CommandInputSchema.safeParse({
    sessionId: 'ses_01',
    command: 'compact',
    arguments: '',
  });
  assert.ok(result.success, `Parse failed: ${!result.success && JSON.stringify(result.error)}`);
  assert.equal(result.data.command, 'compact');
  assert.equal(result.data.arguments, '');
});

test('CMD-01: schema accepts all optional fields', () => {
  const result = CommandInputSchema.safeParse({
    sessionId: 'ses_01',
    command: 'clear',
    arguments: 'some args',
    messageID: 'msg_01',
    agent: 'agent-x',
    model: 'anthropic/claude-3-5-sonnet',
  });
  assert.ok(result.success);
  assert.equal(result.data.model, 'anthropic/claude-3-5-sonnet');
});

test('CMD-01: model is a plain string, not an object with providerID/modelID', () => {
  // Passing a { providerID, modelID } object should FAIL — model must be a string
  const result = CommandInputSchema.safeParse({
    sessionId: 'ses_01',
    command: 'compact',
    arguments: '',
    model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
  });
  assert.ok(!result.success, 'Expected schema to reject object-shaped model');
});

test('CMD-01: command field is required — omitting it fails', () => {
  const result = CommandInputSchema.safeParse({
    sessionId: 'ses_01',
    arguments: '',
  });
  assert.ok(!result.success, 'Expected schema to reject missing command');
});

test('CMD-01: arguments field is required — omitting it fails', () => {
  const result = CommandInputSchema.safeParse({
    sessionId: 'ses_01',
    command: 'compact',
  });
  assert.ok(!result.success, 'Expected schema to reject missing arguments');
});

test('CMD-01: optional fields default to undefined when not provided', () => {
  const result = CommandInputSchema.safeParse({
    sessionId: 'ses_01',
    command: 'compact',
    arguments: '',
  });
  assert.ok(result.success);
  assert.equal(result.data.messageID, undefined);
  assert.equal(result.data.agent, undefined);
  assert.equal(result.data.model, undefined);
});
