import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
// expects Plan 02 to export _resetWarnFlags from sessions.ts
import { readSessionMap, writeSessionMap, addSession, removeSession, lookupSession, atomicCheckAndAdd, _resetWarnFlags } from './sessions.js';

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
    assert.equal(entry?.server, 'local');
    assert.equal(entry?.url, 'http://localhost:4096');
    assert.equal(typeof entry?.createdAt, 'number');
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

test('addSession stamps createdAt on new entries', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'sessions.json');
    const before = Date.now();
    addSession('ses_abc123', { server: 'local', url: 'http://localhost:4096' }, regPath);
    const after = Date.now();
    const entry = lookupSession('ses_abc123', regPath);
    assert.ok(entry?.createdAt !== undefined, 'createdAt should be set');
    assert.ok(entry!.createdAt! >= before && entry!.createdAt! <= after, 'createdAt should be within test window');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSessionMap prunes entries older than PREFECT_SESSION_TTL_MS', () => {
  const dir = freshTmp();
  const orig = process.env.PREFECT_SESSION_TTL_MS;
  try {
    const regPath = join(dir, 'sessions.json');
    const old = Date.now() - 1000; // 1 second ago
    writeSessionMap({
      sessions: {
        'ses_old': { server: 'local', url: 'http://localhost:4096', createdAt: old },
        'ses_new': { server: 'local', url: 'http://localhost:4096', createdAt: Date.now() },
      },
    }, regPath);
    // TTL of 500ms — ses_old (1s old) should be pruned, ses_new should survive
    process.env.PREFECT_SESSION_TTL_MS = '500';
    const map = readSessionMap(regPath);
    assert.ok(!('ses_old' in map.sessions), 'expired entry should be pruned');
    assert.ok('ses_new' in map.sessions, 'fresh entry should survive');
  } finally {
    if (orig === undefined) delete process.env.PREFECT_SESSION_TTL_MS;
    else process.env.PREFECT_SESSION_TTL_MS = orig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSessionMap keeps legacy entries without createdAt (never expires them)', () => {
  const dir = freshTmp();
  const orig = process.env.PREFECT_SESSION_TTL_MS;
  try {
    const regPath = join(dir, 'sessions.json');
    writeSessionMap({
      sessions: {
        'ses_legacy': { server: 'local', url: 'http://localhost:4096' }, // no createdAt
      },
    }, regPath);
    process.env.PREFECT_SESSION_TTL_MS = '1'; // 1ms TTL — would prune anything with createdAt
    const map = readSessionMap(regPath);
    assert.ok('ses_legacy' in map.sessions, 'legacy entry without createdAt should never be pruned');
  } finally {
    if (orig === undefined) delete process.env.PREFECT_SESSION_TTL_MS;
    else process.env.PREFECT_SESSION_TTL_MS = orig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('atomicCheckAndAdd prunes stale sessions (non-200 liveness) before capacity check', async () => {
  const dir = freshTmp();
  const origFetch = globalThis.fetch;
  try {
    const regPath = join(dir, 'sessions.json');
    // Pre-populate with two sessions for the same server
    writeSessionMap({
      sessions: {
        'ses_dead': { server: 'myserver', url: 'http://localhost:4096', createdAt: Date.now() },
        'ses_alive': { server: 'myserver', url: 'http://localhost:4096', createdAt: Date.now() },
      },
    }, regPath);

    // Mock fetch: ses_dead → 404, ses_alive → 200
    (globalThis as Record<string, unknown>).fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes('ses_dead')) return new Response(null, { status: 404 });
      if (url.includes('ses_alive')) return new Response('{}', { status: 200 });
      return new Response('{}', { status: 200 });
    };

    // maxSessions=2, but ses_dead is pruned → only 1 alive → should succeed
    const result = await atomicCheckAndAdd(
      'ses_new',
      { server: 'myserver', url: 'http://localhost:4096' },
      2,
      regPath,
    );
    assert.equal(result, undefined, 'should not return capacity error');

    const map = readSessionMap(regPath);
    assert.ok(!('ses_dead' in map.sessions), 'dead session should be pruned');
    assert.ok('ses_alive' in map.sessions, 'live session should remain');
    assert.ok('ses_new' in map.sessions, 'new session should be added');
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('atomicCheckAndAdd enforces capacity after pruning dead sessions', async () => {
  const dir = freshTmp();
  const origFetch = globalThis.fetch;
  try {
    const regPath = join(dir, 'sessions.json');
    writeSessionMap({
      sessions: {
        'ses_a': { server: 'myserver', url: 'http://localhost:4096', createdAt: Date.now() },
        'ses_b': { server: 'myserver', url: 'http://localhost:4096', createdAt: Date.now() },
      },
    }, regPath);

    // Both sessions are live
    (globalThis as Record<string, unknown>).fetch = async () => new Response('{}', { status: 200 });

    // maxSessions=2 with 2 live sessions → should be at capacity
    const result = await atomicCheckAndAdd(
      'ses_new',
      { server: 'myserver', url: 'http://localhost:4096' },
      2,
      regPath,
    );
    assert.ok(result !== undefined, 'should return capacity error string');
    assert.ok(result.includes('at capacity'), 'error should mention capacity');
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── RENAME-04 deprecation warning tests ────────────────────────────────────
// Warning text Plan 02 will emit: '[Legate] PREFECT_SESSION_TTL_MS is deprecated, use LEGATE_SESSION_TTL_MS'
// These tests MUST FAIL (RED) against current source — Plan 02 exports _resetWarnFlags
// from sessions.ts and adds LEGATE_SESSION_TTL_MS support to make them pass.

test('readSessionMap emits one-time deprecation warning for PREFECT_SESSION_TTL_MS when LEGATE_SESSION_TTL_MS is not set', () => {
  _resetWarnFlags();
  const dir = mkdtempSync(join(tmpdir(), 'prefect-sessions-'));
  const prevLegate = process.env.LEGATE_SESSION_TTL_MS;
  const prevPrefect = process.env.PREFECT_SESSION_TTL_MS;
  delete process.env.LEGATE_SESSION_TTL_MS;
  process.env.PREFECT_SESSION_TTL_MS = '3600000';

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    const regPath = join(dir, 'sessions.json');
    readSessionMap(regPath);
    const ttlWarnings = warnings.filter((w) => w.includes('PREFECT_SESSION_TTL_MS'));
    assert.equal(ttlWarnings.length, 1, `expected exactly 1 PREFECT_SESSION_TTL_MS warning, got ${ttlWarnings.length}: ${JSON.stringify(warnings)}`);
    assert.ok(ttlWarnings[0].includes('LEGATE_SESSION_TTL_MS'), `warning should mention LEGATE_SESSION_TTL_MS: ${ttlWarnings[0]}`);
  } finally {
    console.error = origError;
    if (prevLegate === undefined) delete process.env.LEGATE_SESSION_TTL_MS;
    else process.env.LEGATE_SESSION_TTL_MS = prevLegate;
    if (prevPrefect === undefined) delete process.env.PREFECT_SESSION_TTL_MS;
    else process.env.PREFECT_SESSION_TTL_MS = prevPrefect;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSessionMap emits PREFECT_SESSION_TTL_MS warning exactly once when called twice (one-time-per-process guard)', () => {
  _resetWarnFlags();
  const dir = mkdtempSync(join(tmpdir(), 'prefect-sessions-'));
  const prevLegate = process.env.LEGATE_SESSION_TTL_MS;
  const prevPrefect = process.env.PREFECT_SESSION_TTL_MS;
  delete process.env.LEGATE_SESSION_TTL_MS;
  process.env.PREFECT_SESSION_TTL_MS = '3600000';

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    const regPath = join(dir, 'sessions.json');
    readSessionMap(regPath);
    readSessionMap(regPath); // second call — must NOT emit a second warning
    const ttlWarnings = warnings.filter((w) => w.includes('PREFECT_SESSION_TTL_MS'));
    assert.equal(ttlWarnings.length, 1, `expected exactly 1 PREFECT_SESSION_TTL_MS warning across 2 calls, got ${ttlWarnings.length}`);
  } finally {
    console.error = origError;
    if (prevLegate === undefined) delete process.env.LEGATE_SESSION_TTL_MS;
    else process.env.LEGATE_SESSION_TTL_MS = prevLegate;
    if (prevPrefect === undefined) delete process.env.PREFECT_SESSION_TTL_MS;
    else process.env.PREFECT_SESSION_TTL_MS = prevPrefect;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSessionMap emits NO PREFECT_SESSION_TTL_MS warning when LEGATE_SESSION_TTL_MS is also set (LEGATE_* takes precedence)', () => {
  _resetWarnFlags();
  const dir = mkdtempSync(join(tmpdir(), 'prefect-sessions-'));
  const prevLegate = process.env.LEGATE_SESSION_TTL_MS;
  const prevPrefect = process.env.PREFECT_SESSION_TTL_MS;
  process.env.LEGATE_SESSION_TTL_MS = '2000';
  process.env.PREFECT_SESSION_TTL_MS = '1000';

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    const regPath = join(dir, 'sessions.json');
    readSessionMap(regPath);
    const ttlWarnings = warnings.filter((w) => w.includes('PREFECT_SESSION_TTL_MS'));
    assert.equal(ttlWarnings.length, 0, `expected 0 PREFECT_SESSION_TTL_MS warnings when LEGATE_SESSION_TTL_MS is set, got ${ttlWarnings.length}`);
  } finally {
    console.error = origError;
    if (prevLegate === undefined) delete process.env.LEGATE_SESSION_TTL_MS;
    else process.env.LEGATE_SESSION_TTL_MS = prevLegate;
    if (prevPrefect === undefined) delete process.env.PREFECT_SESSION_TTL_MS;
    else process.env.PREFECT_SESSION_TTL_MS = prevPrefect;
    rmSync(dir, { recursive: true, force: true });
  }
});
