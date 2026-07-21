import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
// expects Plan 02 to export autostartTimeoutMs and _resetWarnFlags from autostart.ts
import { ensureOpencodeRunning, _resetStartPromise, _setSpawn, _resetSpawn, autostartTimeoutMs, _resetWarnFlags } from './autostart.js';
import type { ServerEntry } from './registry.js';
import type { spawn as SpawnType } from 'node:child_process';

// Fake spawner: these are UNIT tests — they must never execute a real
// 'opencode serve'. The real spawn orphaned children locally and crashed CI
// (uncaughtException: spawn opencode ENOENT) on runners without the binary.
// The stub satisfies the two members ensureOpencodeRunning uses: on(), unref().
type SpawnCall = { cmd: string; args: string[] };
const spawnCalls: SpawnCall[] = [];
let spawnErrorToEmit: Error | undefined;

function fakeSpawn(cmd: string, args: string[]): ReturnType<typeof SpawnType> {
  spawnCalls.push({ cmd, args });
  const listeners = new Map<string, (arg: unknown) => void>();
  const child = {
    on(event: string, cb: (arg: unknown) => void) {
      listeners.set(event, cb);
      if (event === 'error' && spawnErrorToEmit) {
        const err = spawnErrorToEmit;
        setImmediate(() => cb(err));  // async, like the real ENOENT delivery
      }
      return child;
    },
    unref() { /* no-op */ },
  };
  return child as unknown as ReturnType<typeof SpawnType>;
}

beforeEach(() => {
  _resetStartPromise();
  spawnCalls.length = 0;
  spawnErrorToEmit = undefined;
  _setSpawn(fakeSpawn as unknown as typeof SpawnType);
});

afterEach(() => {
  _resetSpawn();
});

const LOCAL: ServerEntry = { name: 'local', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3' };
const LOCAL_ALT: ServerEntry = { name: 'b', host: 'localhost', port: 4097, providerID: 'vllm', modelID: 'qwen3' };
const CUSTOM: ServerEntry = { name: 'custom', host: 'localhost', port: 4099, providerID: 'vllm', modelID: 'qwen3' };
const REMOTE: ServerEntry = { name: 'remote', host: '192.168.1.100', port: 4096, providerID: 'vllm', modelID: 'qwen3' };

function mockOk(counter?: { n: number }, urlCapture?: { url: string }): (req: Request) => Promise<Response> {
  return (req: Request) => {
    if (counter) counter.n++;
    if (urlCapture) urlCapture.url = req.url;
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
}

function errorFetch(): (req: Request) => Promise<Response> {
  return () => Promise.reject(new TypeError('ECONNREFUSED'));
}

test('ensureOpencodeRunning throws immediately for non-localhost server.host', async () => {
  await assert.rejects(
    () => ensureOpencodeRunning(REMOTE),
    (err: Error) => {
      assert.ok(err.message.includes('Auto-start skipped'), `got: ${err.message}`);
      assert.ok(err.message.includes('192.168.1.100'), `got: ${err.message}`);
      assert.ok(err.message.includes("'remote'"), `got: ${err.message}`);
      return true;
    },
  );
});

test('ensureOpencodeRunning deduplicates concurrent calls for the same server (exactly one health poll)', async () => {
  const origFetch = globalThis.fetch;
  const counter = { n: 0 };
  (globalThis as unknown as Record<string, unknown>).fetch = mockOk(counter);
  try {
    await Promise.all([ensureOpencodeRunning(LOCAL), ensureOpencodeRunning(LOCAL)]);
    assert.equal(counter.n, 1, `dedup failed — health poll called ${counter.n} times for 2 concurrent calls`);
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
  }
});

test('ensureOpencodeRunning starts two different servers concurrently (separate Map entries)', async () => {
  const origFetch = globalThis.fetch;
  const counter = { n: 0 };
  (globalThis as unknown as Record<string, unknown>).fetch = mockOk(counter);
  try {
    await Promise.all([ensureOpencodeRunning(LOCAL), ensureOpencodeRunning(LOCAL_ALT)]);
    assert.equal(counter.n, 2, `expected 2 distinct health polls (one per server), got ${counter.n}`);
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
  }
});

test('ensureOpencodeRunning throws when OpenCode does not become healthy within timeout', async () => {
  const origFetch = globalThis.fetch;
  const origTimeout = process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
  process.env.LEGATE_AUTOSTART_TIMEOUT_MS = '200';
  (globalThis as unknown as Record<string, unknown>).fetch = errorFetch();
  try {
    await assert.rejects(
      () => ensureOpencodeRunning(LOCAL),
      (err: Error) => err.message.includes('OpenCode did not become healthy within'),
    );
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
    if (origTimeout === undefined) delete process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
    else process.env.LEGATE_AUTOSTART_TIMEOUT_MS = origTimeout;
  }
});

test('ensureOpencodeRunning health poll uses authFetch (injects auth header when password set)', async () => {
  const prevPw = process.env.LEGATE_SERVER_PASSWORD;
  process.env.LEGATE_SERVER_PASSWORD = 'healthtest';
  const origFetch = globalThis.fetch;
  let capturedAuth: string | null = null;
  (globalThis as unknown as Record<string, unknown>).fetch = (req: Request) => {
    capturedAuth = req.headers.get('Authorization');
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  try {
    await ensureOpencodeRunning(LOCAL);
    const expected = `Basic ${Buffer.from('opencode:healthtest').toString('base64')}`;
    assert.equal(capturedAuth, expected, 'health poll should inject Authorization header');
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
    if (prevPw === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prevPw;
  }
});

test('health poll URL targets server.host:server.port (not BASE_URL)', async () => {
  const origFetch = globalThis.fetch;
  const urlCapture = { url: '' };
  (globalThis as unknown as Record<string, unknown>).fetch = mockOk(undefined, urlCapture);
  try {
    await ensureOpencodeRunning(CUSTOM);
    assert.ok(urlCapture.url.includes(':4099/global/health'), `expected :4099/global/health in URL, got: ${urlCapture.url}`);
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
  }
});

test('ensureOpencodeRunning passes serve --port <port> to the spawner', async () => {
  const origFetch = globalThis.fetch;
  (globalThis as unknown as Record<string, unknown>).fetch = mockOk();
  try {
    await ensureOpencodeRunning(CUSTOM);
    assert.equal(spawnCalls.length, 1, `expected exactly 1 spawn, got ${spawnCalls.length}`);
    assert.deepEqual(spawnCalls[0].args, ['serve', '--port', '4099']);
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
  }
});

test('ensureOpencodeRunning fails fast with a clear message when spawn errors (ENOENT)', async () => {
  const origFetch = globalThis.fetch;
  // Health poll never succeeds — the spawn error must reject FIRST (fast), not
  // after the full health timeout.
  (globalThis as unknown as Record<string, unknown>).fetch = errorFetch();
  spawnErrorToEmit = Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' });
  const started = Date.now();
  try {
    await assert.rejects(
      () => ensureOpencodeRunning(LOCAL),
      (err: Error) => {
        assert.ok(err.message.includes('Failed to spawn'), `got: ${err.message}`);
        assert.ok(err.message.includes('ENOENT'), `got: ${err.message}`);
        assert.ok(err.message.includes('on PATH'), `got: ${err.message}`);
        return true;
      },
    );
    // Well under the 30s default health timeout — proves the race short-circuits.
    assert.ok(Date.now() - started < 5000, 'spawn error should reject fast, not wait out the health timeout');
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
  }
});

// ── RENAME-04 deprecation warning tests ────────────────────────────────────
// Warning text Plan 02 will emit: '[Legate] PREFECT_AUTOSTART_TIMEOUT_MS is deprecated, use LEGATE_AUTOSTART_TIMEOUT_MS'
// These tests MUST FAIL (RED) against current source — Plan 02 exports autostartTimeoutMs
// and _resetWarnFlags from autostart.ts to make them pass.

test('autostartTimeoutMs emits one-time deprecation warning for PREFECT_AUTOSTART_TIMEOUT_MS when LEGATE_AUTOSTART_TIMEOUT_MS is not set', () => {
  _resetWarnFlags();
  const prevLegate = process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
  const prevPrefect = process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
  delete process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
  process.env.PREFECT_AUTOSTART_TIMEOUT_MS = '5000';

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    autostartTimeoutMs();
    const timeoutWarnings = warnings.filter((w) => w.includes('PREFECT_AUTOSTART_TIMEOUT_MS'));
    assert.equal(timeoutWarnings.length, 1, `expected exactly 1 PREFECT_AUTOSTART_TIMEOUT_MS warning, got ${timeoutWarnings.length}: ${JSON.stringify(warnings)}`);
    assert.ok(timeoutWarnings[0].includes('LEGATE_AUTOSTART_TIMEOUT_MS'), `warning should mention LEGATE_AUTOSTART_TIMEOUT_MS: ${timeoutWarnings[0]}`);
  } finally {
    console.error = origError;
    if (prevLegate === undefined) delete process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
    else process.env.LEGATE_AUTOSTART_TIMEOUT_MS = prevLegate;
    if (prevPrefect === undefined) delete process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
    else process.env.PREFECT_AUTOSTART_TIMEOUT_MS = prevPrefect;
  }
});

test('autostartTimeoutMs emits PREFECT_AUTOSTART_TIMEOUT_MS warning exactly once when called twice (one-time-per-process guard)', () => {
  _resetWarnFlags();
  const prevLegate = process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
  const prevPrefect = process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
  delete process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
  process.env.PREFECT_AUTOSTART_TIMEOUT_MS = '5000';

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    autostartTimeoutMs();
    autostartTimeoutMs(); // second call — must NOT emit a second warning
    const timeoutWarnings = warnings.filter((w) => w.includes('PREFECT_AUTOSTART_TIMEOUT_MS'));
    assert.equal(timeoutWarnings.length, 1, `expected exactly 1 PREFECT_AUTOSTART_TIMEOUT_MS warning across 2 calls, got ${timeoutWarnings.length}`);
  } finally {
    console.error = origError;
    if (prevLegate === undefined) delete process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
    else process.env.LEGATE_AUTOSTART_TIMEOUT_MS = prevLegate;
    if (prevPrefect === undefined) delete process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
    else process.env.PREFECT_AUTOSTART_TIMEOUT_MS = prevPrefect;
  }
});

test('autostartTimeoutMs emits NO PREFECT_AUTOSTART_TIMEOUT_MS warning when LEGATE_AUTOSTART_TIMEOUT_MS is also set (LEGATE_* takes precedence)', () => {
  _resetWarnFlags();
  const prevLegate = process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
  const prevPrefect = process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
  process.env.LEGATE_AUTOSTART_TIMEOUT_MS = '10000';
  process.env.PREFECT_AUTOSTART_TIMEOUT_MS = '5000';

  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    autostartTimeoutMs();
    const timeoutWarnings = warnings.filter((w) => w.includes('PREFECT_AUTOSTART_TIMEOUT_MS'));
    assert.equal(timeoutWarnings.length, 0, `expected 0 PREFECT_AUTOSTART_TIMEOUT_MS warnings when LEGATE_AUTOSTART_TIMEOUT_MS is set, got ${timeoutWarnings.length}`);
  } finally {
    console.error = origError;
    if (prevLegate === undefined) delete process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
    else process.env.LEGATE_AUTOSTART_TIMEOUT_MS = prevLegate;
    if (prevPrefect === undefined) delete process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
    else process.env.PREFECT_AUTOSTART_TIMEOUT_MS = prevPrefect;
  }
});
