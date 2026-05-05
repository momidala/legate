import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { readSessionMap, writeSessionMap, addSession, removeSession, lookupSession } from './sessions.js';

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'prefect-sessions-'));
}

const SESSIONS_BUILD = resolve(process.cwd(), 'build/sessions.js');
if (!existsSync(SESSIONS_BUILD)) {
  throw new Error(`Build artifact missing: run 'npm run build' first`);
}

test('readSessionMap returns { sessions: {} } when file does not exist', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    // File is NOT created
    const result = readSessionMap(regPath);
    assert.deepEqual(result, { sessions: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSessionMap creates parent directory and writes pretty-printed JSON with trailing newline', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'nested', 'subdir', 'sessions.json');
    writeSessionMap({ sessions: { 'ses_abc123': { server: 'local', url: 'http://localhost:4096' } } }, regPath);
    assert.equal(existsSync(regPath), true);
    const raw = readFileSync(regPath, 'utf8');
    assert.ok(raw.endsWith('\n'), 'file should end with newline');
    assert.ok(raw.includes('  "sessions"'), 'file should use 2-space indent');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, { sessions: { 'ses_abc123': { server: 'local', url: 'http://localhost:4096' } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addSession persists a new entry and lookupSession reads it back', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    addSession('ses_abc123', { server: 'local', url: 'http://localhost:4096' }, regPath);
    const entry = lookupSession('ses_abc123', regPath);
    assert.deepEqual(entry, { server: 'local', url: 'http://localhost:4096' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lookupSession returns undefined for unknown sessionId', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    // File is NOT created — no sessions at all
    const result = lookupSession('ses_unknown', regPath);
    assert.equal(result, undefined);
    // Also test with a file that has a different sessionId
    addSession('ses_abc123', { server: 'local', url: 'http://localhost:4096' }, regPath);
    const result2 = lookupSession('ses_unknown', regPath);
    assert.equal(result2, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeSession removes a known entry and persists', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    addSession('ses_abc123', { server: 'local', url: 'http://localhost:4096' }, regPath);
    addSession('ses_def456', { server: 'dev', url: 'http://devbox:4097' }, regPath);
    removeSession('ses_abc123', regPath);
    const map = readSessionMap(regPath);
    assert.equal(Object.keys(map.sessions).length, 1);
    assert.ok('ses_def456' in map.sessions, 'ses_def456 should remain');
    assert.ok(!('ses_abc123' in map.sessions), 'ses_abc123 should be removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeSession on unknown id is a silent no-op (does not throw)', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    // Call removeSession on an empty map — should not throw
    assert.doesNotThrow(() => removeSession('does-not-exist', regPath));
    const map = readSessionMap(regPath);
    assert.deepEqual(map, { sessions: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSessionMap returns { sessions: {} } on malformed JSON (corrupt file recovery)', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    writeFileSync(regPath, 'not-json{');
    // Corrupt files are now recovered gracefully (returns empty map, logs warning) rather than throwing
    const result = readSessionMap(regPath);
    assert.deepEqual(result, { sessions: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSessionMap returns { sessions: {} } when sessions field is missing or not an object (corrupt file recovery)', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    writeFileSync(regPath, '{"foo": 1}');
    // Malformed structure is now recovered gracefully rather than throwing
    const result = readSessionMap(regPath);
    assert.deepEqual(result, { sessions: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addSession stores model when provided and lookupSession returns it', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    addSession('ses_abc123', { server: 'local', url: 'http://localhost:4096', model: { providerID: 'vllm', modelID: 'qwen3' } }, regPath);
    const entry = lookupSession('ses_abc123', regPath);
    assert.deepEqual(entry?.model, { providerID: 'vllm', modelID: 'qwen3' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addSession without model stores entry with no model field', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    addSession('ses_abc123', { server: 'local', url: 'http://localhost:4096' }, regPath);
    const entry = lookupSession('ses_abc123', regPath);
    assert.equal(entry?.model, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
