import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureOpencodeRunning, _resetStartPromise } from './autostart.js';
import type { ServerEntry } from './registry.js';

beforeEach(() => {
  _resetStartPromise();
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
  const origTimeout = process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
  process.env.PREFECT_AUTOSTART_TIMEOUT_MS = '200';
  (globalThis as unknown as Record<string, unknown>).fetch = errorFetch();
  try {
    await assert.rejects(
      () => ensureOpencodeRunning(LOCAL),
      (err: Error) => err.message.includes('OpenCode did not become healthy within'),
    );
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
    if (origTimeout === undefined) delete process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
    else process.env.PREFECT_AUTOSTART_TIMEOUT_MS = origTimeout;
  }
});

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
    await ensureOpencodeRunning(LOCAL);
    const expected = `Basic ${Buffer.from('opencode:healthtest').toString('base64')}`;
    assert.equal(capturedAuth, expected, 'health poll should inject Authorization header');
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = origFetch;
    if (prevPw === undefined) delete process.env.PREFECT_SERVER_PASSWORD;
    else process.env.PREFECT_SERVER_PASSWORD = prevPw;
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
