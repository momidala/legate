import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureOpencodeRunning, _resetStartPromise } from './autostart.js';

// ── ensureOpencodeRunning tests ─────────────────────────────────────────────
// Tests use _resetStartPromise() to reset module state between runs rather than
// the ?v=query-string ESM cache-bust trick, which is undocumented Node.js
// behavior and may not work across loaders or future Node.js versions (WR-03).
//
// globalThis.fetch is monkey-patched to control health-poll behavior without
// spawning a real opencode process.

beforeEach(() => {
  _resetStartPromise();
});

// Helper: mock fetch that returns HTTP 200 after an optional delay.
function mockFetch(delay = 0): (req: Request) => Promise<Response> {
  return (_req: Request) =>
    new Promise((resolve) => setTimeout(() => resolve(new Response('{}', { status: 200 })), delay));
}

// Helper: mock fetch that always throws (simulating ECONNREFUSED).
function errorFetch(delay = 0): (req: Request) => Promise<Response> {
  return (_req: Request) =>
    new Promise((_, reject) => setTimeout(() => reject(new TypeError('ECONNREFUSED')), delay));
}

// ── Remote-host guard ────────────────────────────────────────────────────────

test('ensureOpencodeRunning throws immediately for non-local PREFECT_SERVER_URL', async () => {
  // BASE_URL is a module-level constant read at import time, so we cannot
  // override it via process.env in this test. The remote-guard behavior is
  // covered by the dedicated ?v= isolated module instance test below.
  //
  // Rationale for keeping the ?v= trick here only: the remote-guard test
  // requires a different BASE_URL value baked in at module init, which can
  // only be achieved via a fresh module load. All other tests use the shared
  // module instance (localhost) and _resetStartPromise() for state isolation.
  const origUrl = process.env.PREFECT_SERVER_URL;
  process.env.PREFECT_SERVER_URL = 'http://192.168.1.100:4096';

  try {
    const { ensureOpencodeRunning: ensureRemote } =
      await (import('./autostart.js?v=remote-guard-test' as string) as Promise<typeof import('./autostart.js')>);

    await assert.rejects(
      () => ensureRemote(),
      (err: Error) => {
        assert.ok(
          err.message.includes('Auto-start skipped') && err.message.includes('192.168.1.100'),
          `Expected remote-host error, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    if (origUrl === undefined) delete process.env.PREFECT_SERVER_URL;
    else process.env.PREFECT_SERVER_URL = origUrl;
  }
});

// ── Promise-based spawn lock ─────────────────────────────────────────────────

test('ensureOpencodeRunning deduplicates concurrent calls (exactly one health poll)', async () => {
  const origFetch = globalThis.fetch;
  let fetchCallCount = 0;
  (globalThis as unknown as Record<string, unknown>).fetch = (_req: Request) => {
    fetchCallCount++;
    return Promise.resolve(new Response('{}', { status: 200 }));
  };

  try {
    // Two concurrent calls — dedup must fire exactly one health poll (IN-01 fix).
    await Promise.all([ensureOpencodeRunning(), ensureOpencodeRunning()]);
    assert.equal(fetchCallCount, 1, `dedup failed — health poll called ${fetchCallCount} times for 2 concurrent calls`);
    const dedupedCount = fetchCallCount;

    // After both settle, startPromise is null again — a third call spawns anew (crash recovery).
    await ensureOpencodeRunning();
    assert.ok(fetchCallCount > dedupedCount, 'post-reset call should trigger a new health poll (crash recovery)');
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
  }
});

// ── waitForHealth timeout ────────────────────────────────────────────────────

test('ensureOpencodeRunning throws when OpenCode does not become healthy within timeout', async () => {
  const origFetch = globalThis.fetch;
  const origTimeout = process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
  process.env.PREFECT_AUTOSTART_TIMEOUT_MS = '200';

  (globalThis as unknown as Record<string, unknown>).fetch = errorFetch(0);

  try {
    await assert.rejects(
      () => ensureOpencodeRunning(),
      (err: Error) => {
        assert.ok(
          err.message.includes('OpenCode did not become healthy within'),
          `Expected timeout message, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
    if (origTimeout === undefined) delete process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
    else process.env.PREFECT_AUTOSTART_TIMEOUT_MS = origTimeout;
  }
});

// ── authFetch integration: health poll uses authenticated fetch ───────────────

test('ensureOpencodeRunning health poll uses authFetch (injects auth header when password set)', async () => {
  const prevPw = process.env.PREFECT_SERVER_PASSWORD;
  process.env.PREFECT_SERVER_PASSWORD = 'healthtest';

  const origFetch = globalThis.fetch;
  let capturedAuth: string | null = null;
  (globalThis as unknown as Record<string, unknown>).fetch = (req: Request) => {
    capturedAuth = req.headers.get('Authorization');
    return Promise.resolve(new Response('{}', { status: 200 }));
  };

  try {
    await ensureOpencodeRunning();
    const expected = `Basic ${Buffer.from('opencode:healthtest').toString('base64')}`;
    assert.equal(capturedAuth, expected, 'health poll should inject Authorization header');
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
    if (prevPw === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPw;
  }
});
