import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthHeader, authFetch, _resetWarnFlags } from './auth.js';

beforeEach(() => _resetWarnFlags());

// ── buildAuthHeader tests ───────────────────────────────────────────────────

test('buildAuthHeader returns {} when LEGATE_SERVER_PASSWORD is not set', () => {
  delete process.env.LEGATE_SERVER_PASSWORD;
  delete process.env.LEGATE_SERVER_USERNAME;
  const result = buildAuthHeader();
  assert.deepEqual(result, {});
});

test('buildAuthHeader returns Authorization header when LEGATE_SERVER_PASSWORD is set', () => {
  const prev = process.env.LEGATE_SERVER_PASSWORD;
  process.env.LEGATE_SERVER_PASSWORD = 'secret';
  delete process.env.LEGATE_SERVER_USERNAME;
  try {
    const result = buildAuthHeader();
    // Buffer.from('opencode:secret').toString('base64') === 'b3BlbmNvZGU6c2VjcmV0'
    const expected = Buffer.from('opencode:secret').toString('base64');
    assert.deepEqual(result, { Authorization: `Basic ${expected}` });
  } finally {
    if (prev === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prev;
  }
});

test('buildAuthHeader uses LEGATE_SERVER_USERNAME when provided', () => {
  const prevPw = process.env.LEGATE_SERVER_PASSWORD;
  const prevUser = process.env.LEGATE_SERVER_USERNAME;
  process.env.LEGATE_SERVER_PASSWORD = 'pw';
  process.env.LEGATE_SERVER_USERNAME = 'alice';
  try {
    const result = buildAuthHeader();
    // Buffer.from('alice:pw').toString('base64') === 'YWxpY2U6cHc='
    const expected = Buffer.from('alice:pw').toString('base64');
    assert.deepEqual(result, { Authorization: `Basic ${expected}` });
  } finally {
    if (prevPw === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prevPw;
    if (prevUser === undefined) delete process.env.LEGATE_SERVER_USERNAME;
    else process.env.LEGATE_SERVER_USERNAME = prevUser;
  }
});

// ── authFetch tests ─────────────────────────────────────────────────────────

test('authFetch forwards request unchanged when no password set', async () => {
  delete process.env.LEGATE_SERVER_PASSWORD;
  delete process.env.LEGATE_SERVER_USERNAME;

  let capturedRequest: Request | undefined;
  const mockFetch = (req: Request) => {
    capturedRequest = req;
    return Promise.resolve(new Response('ok'));
  };

  const origFetch = globalThis.fetch;
  (globalThis as unknown as Record<string, unknown>).fetch = mockFetch;

  try {
    const req = new Request('http://localhost:4096/test');
    await authFetch(req);
    assert.ok(capturedRequest !== undefined, 'fetch should have been called');
    assert.equal(capturedRequest!.url, 'http://localhost:4096/test');
    assert.equal(capturedRequest!.headers.get('Authorization'), null);
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
  }
});

test('authFetch injects Authorization header when LEGATE_SERVER_PASSWORD is set', async () => {
  const prevPw = process.env.LEGATE_SERVER_PASSWORD;
  process.env.LEGATE_SERVER_PASSWORD = 'secret';
  delete process.env.LEGATE_SERVER_USERNAME;

  let capturedRequest: Request | undefined;
  const mockFetch = (req: Request) => {
    capturedRequest = req;
    return Promise.resolve(new Response('ok'));
  };

  const origFetch = globalThis.fetch;
  (globalThis as unknown as Record<string, unknown>).fetch = mockFetch;

  try {
    const req = new Request('http://localhost:4096/test');
    await authFetch(req);
    assert.ok(capturedRequest !== undefined, 'fetch should have been called');
    const expected = `Basic ${Buffer.from('opencode:secret').toString('base64')}`;
    assert.equal(capturedRequest!.headers.get('Authorization'), expected);
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
    if (prevPw === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prevPw;
  }
});

// ── RENAME-04 deprecation warning tests ────────────────────────────────────
// These tests assert that after Plan 02 renames PREFECT_* → LEGATE_*, the
// PREFECT_* vars emit a one-time deprecation warning to console.error (stderr).
// These tests MUST FAIL (RED) against the current source — Plan 02 implements
// the LEGATE_* support that makes them pass.

// Warning text Plan 02 will emit: '[Legate] PREFECT_SERVER_PASSWORD is deprecated, use LEGATE_SERVER_PASSWORD'
test('buildAuthHeader emits one-time deprecation warning for PREFECT_SERVER_PASSWORD when LEGATE_SERVER_PASSWORD is not set', () => {
  _resetWarnFlags();
  const prevLegate = process.env.LEGATE_SERVER_PASSWORD;
  const prevPrefect = process.env.PREFECT_SERVER_PASSWORD;
  const prevOpencode = process.env.OPENCODE_SERVER_PASSWORD;
  delete process.env.LEGATE_SERVER_PASSWORD;
  process.env.PREFECT_SERVER_PASSWORD = 'legacy-pw';
  delete process.env.OPENCODE_SERVER_PASSWORD;

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    buildAuthHeader();
    const pwWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_PASSWORD'));
    assert.equal(pwWarnings.length, 1, `expected exactly 1 PREFECT_SERVER_PASSWORD warning, got ${pwWarnings.length}: ${JSON.stringify(warnings)}`);
    assert.ok(pwWarnings[0].includes('LEGATE_SERVER_PASSWORD'), `warning should mention LEGATE_SERVER_PASSWORD: ${pwWarnings[0]}`);
  } finally {
    console.error = origError;
    if (prevLegate === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prevLegate;
    if (prevPrefect === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPrefect;
    if (prevOpencode === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
    else process.env.OPENCODE_SERVER_PASSWORD = prevOpencode;
  }
});

test('buildAuthHeader emits PREFECT_SERVER_PASSWORD warning exactly once when called twice (one-time-per-process guard)', () => {
  _resetWarnFlags();
  const prevLegate = process.env.LEGATE_SERVER_PASSWORD;
  const prevPrefect = process.env.PREFECT_SERVER_PASSWORD;
  const prevOpencode = process.env.OPENCODE_SERVER_PASSWORD;
  delete process.env.LEGATE_SERVER_PASSWORD;
  process.env.PREFECT_SERVER_PASSWORD = 'legacy-pw';
  delete process.env.OPENCODE_SERVER_PASSWORD;

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    buildAuthHeader();
    buildAuthHeader(); // second call — must NOT emit a second warning
    const pwWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_PASSWORD'));
    assert.equal(pwWarnings.length, 1, `expected exactly 1 PREFECT_SERVER_PASSWORD warning across 2 calls, got ${pwWarnings.length}`);
  } finally {
    console.error = origError;
    if (prevLegate === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prevLegate;
    if (prevPrefect === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPrefect;
    if (prevOpencode === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
    else process.env.OPENCODE_SERVER_PASSWORD = prevOpencode;
  }
});

test('buildAuthHeader emits NO PREFECT_SERVER_PASSWORD warning when LEGATE_SERVER_PASSWORD is also set (LEGATE_* takes precedence)', () => {
  _resetWarnFlags();
  const prevLegate = process.env.LEGATE_SERVER_PASSWORD;
  const prevPrefect = process.env.PREFECT_SERVER_PASSWORD;
  const prevOpencode = process.env.OPENCODE_SERVER_PASSWORD;
  process.env.LEGATE_SERVER_PASSWORD = 'new-pw';
  process.env.PREFECT_SERVER_PASSWORD = 'old-pw';
  delete process.env.OPENCODE_SERVER_PASSWORD;

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    buildAuthHeader();
    const pwWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_PASSWORD'));
    assert.equal(pwWarnings.length, 0, `expected 0 PREFECT_SERVER_PASSWORD warnings when LEGATE_SERVER_PASSWORD is set, got ${pwWarnings.length}`);
  } finally {
    console.error = origError;
    if (prevLegate === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prevLegate;
    if (prevPrefect === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPrefect;
    if (prevOpencode === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
    else process.env.OPENCODE_SERVER_PASSWORD = prevOpencode;
  }
});

// Warning text Plan 02 will emit: '[Legate] PREFECT_SERVER_USERNAME is deprecated, use LEGATE_SERVER_USERNAME'
test('buildAuthHeader emits one-time deprecation warning for PREFECT_SERVER_USERNAME when LEGATE_SERVER_USERNAME is not set', () => {
  _resetWarnFlags();
  const prevLegatePw = process.env.LEGATE_SERVER_PASSWORD;
  const prevPrefectPw = process.env.PREFECT_SERVER_PASSWORD;
  const prevLegateUser = process.env.LEGATE_SERVER_USERNAME;
  const prevPrefectUser = process.env.PREFECT_SERVER_USERNAME;
  const prevOpencodePw = process.env.OPENCODE_SERVER_PASSWORD;
  const prevOpcodeUser = process.env.OPENCODE_SERVER_USERNAME;
  // Need a password set so username resolution is reached
  process.env.LEGATE_SERVER_PASSWORD = 'pw';
  delete process.env.PREFECT_SERVER_PASSWORD;
  delete process.env.OPENCODE_SERVER_PASSWORD;
  delete process.env.LEGATE_SERVER_USERNAME;
  process.env.PREFECT_SERVER_USERNAME = 'legacy-user';
  delete process.env.OPENCODE_SERVER_USERNAME;

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    buildAuthHeader();
    const userWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_USERNAME'));
    assert.equal(userWarnings.length, 1, `expected exactly 1 PREFECT_SERVER_USERNAME warning, got ${userWarnings.length}: ${JSON.stringify(warnings)}`);
    assert.ok(userWarnings[0].includes('LEGATE_SERVER_USERNAME'), `warning should mention LEGATE_SERVER_USERNAME: ${userWarnings[0]}`);
  } finally {
    console.error = origError;
    if (prevLegatePw === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prevLegatePw;
    if (prevPrefectPw === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPrefectPw;
    if (prevLegateUser === undefined) delete process.env.LEGATE_SERVER_USERNAME;
    else process.env.LEGATE_SERVER_USERNAME = prevLegateUser;
    if (prevPrefectUser === undefined) delete process.env.PREFECT_SERVER_USERNAME;
    else process.env.PREFECT_SERVER_USERNAME = prevPrefectUser;
    if (prevOpencodePw === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
    else process.env.OPENCODE_SERVER_PASSWORD = prevOpencodePw;
    if (prevOpcodeUser === undefined) delete process.env.OPENCODE_SERVER_USERNAME;
    else process.env.OPENCODE_SERVER_USERNAME = prevOpcodeUser;
  }
});

test('buildAuthHeader emits PREFECT_SERVER_USERNAME warning exactly once when called twice (one-time-per-process guard)', () => {
  _resetWarnFlags();
  const prevLegatePw = process.env.LEGATE_SERVER_PASSWORD;
  const prevPrefectPw = process.env.PREFECT_SERVER_PASSWORD;
  const prevLegateUser = process.env.LEGATE_SERVER_USERNAME;
  const prevPrefectUser = process.env.PREFECT_SERVER_USERNAME;
  const prevOpencodePw = process.env.OPENCODE_SERVER_PASSWORD;
  const prevOpcodeUser = process.env.OPENCODE_SERVER_USERNAME;
  process.env.LEGATE_SERVER_PASSWORD = 'pw';
  delete process.env.PREFECT_SERVER_PASSWORD;
  delete process.env.OPENCODE_SERVER_PASSWORD;
  delete process.env.LEGATE_SERVER_USERNAME;
  process.env.PREFECT_SERVER_USERNAME = 'legacy-user';
  delete process.env.OPENCODE_SERVER_USERNAME;

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    buildAuthHeader();
    buildAuthHeader(); // second call — must NOT emit a second warning
    const userWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_USERNAME'));
    assert.equal(userWarnings.length, 1, `expected exactly 1 PREFECT_SERVER_USERNAME warning across 2 calls, got ${userWarnings.length}`);
  } finally {
    console.error = origError;
    if (prevLegatePw === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prevLegatePw;
    if (prevPrefectPw === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPrefectPw;
    if (prevLegateUser === undefined) delete process.env.LEGATE_SERVER_USERNAME;
    else process.env.LEGATE_SERVER_USERNAME = prevLegateUser;
    if (prevPrefectUser === undefined) delete process.env.PREFECT_SERVER_USERNAME;
    else process.env.PREFECT_SERVER_USERNAME = prevPrefectUser;
    if (prevOpencodePw === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
    else process.env.OPENCODE_SERVER_PASSWORD = prevOpencodePw;
    if (prevOpcodeUser === undefined) delete process.env.OPENCODE_SERVER_USERNAME;
    else process.env.OPENCODE_SERVER_USERNAME = prevOpcodeUser;
  }
});

test('buildAuthHeader emits NO PREFECT_SERVER_USERNAME warning when LEGATE_SERVER_USERNAME is also set (LEGATE_* takes precedence)', () => {
  _resetWarnFlags();
  const prevLegatePw = process.env.LEGATE_SERVER_PASSWORD;
  const prevPrefectPw = process.env.PREFECT_SERVER_PASSWORD;
  const prevLegateUser = process.env.LEGATE_SERVER_USERNAME;
  const prevPrefectUser = process.env.PREFECT_SERVER_USERNAME;
  const prevOpencodePw = process.env.OPENCODE_SERVER_PASSWORD;
  const prevOpcodeUser = process.env.OPENCODE_SERVER_USERNAME;
  process.env.LEGATE_SERVER_PASSWORD = 'pw';
  delete process.env.PREFECT_SERVER_PASSWORD;
  delete process.env.OPENCODE_SERVER_PASSWORD;
  process.env.LEGATE_SERVER_USERNAME = 'new-user';
  process.env.PREFECT_SERVER_USERNAME = 'old-user';
  delete process.env.OPENCODE_SERVER_USERNAME;

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    buildAuthHeader();
    const userWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_USERNAME'));
    assert.equal(userWarnings.length, 0, `expected 0 PREFECT_SERVER_USERNAME warnings when LEGATE_SERVER_USERNAME is set, got ${userWarnings.length}`);
  } finally {
    console.error = origError;
    if (prevLegatePw === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prevLegatePw;
    if (prevPrefectPw === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPrefectPw;
    if (prevLegateUser === undefined) delete process.env.LEGATE_SERVER_USERNAME;
    else process.env.LEGATE_SERVER_USERNAME = prevLegateUser;
    if (prevPrefectUser === undefined) delete process.env.PREFECT_SERVER_USERNAME;
    else process.env.PREFECT_SERVER_USERNAME = prevPrefectUser;
    if (prevOpencodePw === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
    else process.env.OPENCODE_SERVER_PASSWORD = prevOpencodePw;
    if (prevOpcodeUser === undefined) delete process.env.OPENCODE_SERVER_USERNAME;
    else process.env.OPENCODE_SERVER_USERNAME = prevOpcodeUser;
  }
});
