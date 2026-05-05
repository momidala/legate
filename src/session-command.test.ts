import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// CMD-01 behavior tests for prefect_session_command input schema.
// These verify that the Zod schema for the tool's inputSchema enforces
// the correct shape — in particular that `model` is a plain string (NOT
// { providerID, modelID }) and that `command` + `arguments` are required.

// Define the schema exactly as it will appear in the tool registration.
// These tests are RED-phase: they assert schema behaviors before the tool
// is wired up to the MCP server.

const CommandInputSchema = z.object({
  sessionId: z.string().describe('Session ID'),
  command: z.string().describe('The slash command name without the leading slash'),
  arguments: z.string().describe('Arguments string to pass to the command'),
  messageID: z.string().optional().describe('Optional message ID for context'),
  agent: z.string().optional().describe('Optional agent override'),
  model: z
    .string()
    .optional()
    .describe('Optional model override as a plain string'),
});

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
