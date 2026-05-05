import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthHeader, authFetch } from './auth.js';

// ── buildAuthHeader tests ───────────────────────────────────────────────────

test('buildAuthHeader returns {} when PREFECT_SERVER_PASSWORD is not set', () => {
  delete process.env.PREFECT_SERVER_PASSWORD;
  delete process.env.PREFECT_SERVER_USERNAME;
  const result = buildAuthHeader();
  assert.deepEqual(result, {});
});

test('buildAuthHeader returns Authorization header when PREFECT_SERVER_PASSWORD is set', () => {
  const prev = process.env.PREFECT_SERVER_PASSWORD;
  process.env.PREFECT_SERVER_PASSWORD = 'secret';
  delete process.env.PREFECT_SERVER_USERNAME;
  try {
    const result = buildAuthHeader();
    // Buffer.from('opencode:secret').toString('base64') === 'b3BlbmNvZGU6c2VjcmV0'
    const expected = Buffer.from('opencode:secret').toString('base64');
    assert.deepEqual(result, { Authorization: `Basic ${expected}` });
  } finally {
    if (prev === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prev;
  }
});

test('buildAuthHeader uses PREFECT_SERVER_USERNAME when provided', () => {
  const prevPw = process.env.PREFECT_SERVER_PASSWORD;
  const prevUser = process.env.PREFECT_SERVER_USERNAME;
  process.env.PREFECT_SERVER_PASSWORD = 'pw';
  process.env.PREFECT_SERVER_USERNAME = 'alice';
  try {
    const result = buildAuthHeader();
    // Buffer.from('alice:pw').toString('base64') === 'YWxpY2U6cHc='
    const expected = Buffer.from('alice:pw').toString('base64');
    assert.deepEqual(result, { Authorization: `Basic ${expected}` });
  } finally {
    if (prevPw === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPw;
    if (prevUser === undefined) delete process.env.PREFECT_SERVER_USERNAME;
    else process.env.PREFECT_SERVER_USERNAME = prevUser;
  }
});

// ── authFetch tests ─────────────────────────────────────────────────────────

test('authFetch forwards request unchanged when no password set', async () => {
  delete process.env.PREFECT_SERVER_PASSWORD;
  delete process.env.PREFECT_SERVER_USERNAME;

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

test('authFetch injects Authorization header when PREFECT_SERVER_PASSWORD is set', async () => {
  const prevPw = process.env.PREFECT_SERVER_PASSWORD;
  process.env.PREFECT_SERVER_PASSWORD = 'secret';
  delete process.env.PREFECT_SERVER_USERNAME;

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
    if (prevPw === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPw;
  }
});
