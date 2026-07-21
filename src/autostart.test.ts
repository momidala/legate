import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureOpencodeRunning, _resetStartPromise, _setSpawn, _resetSpawn, autostartTimeoutMs } from './autostart.js';
// legate-4ah: _resetWarnFlags lives in env.ts — autostart.ts no longer re-exports it.
import { _resetWarnFlags } from './env.js';
// legate-4ah: shared try/finally helpers — see testutil.ts for rationale.
import { withEnv, withMockedFetch, captureWarnings } from './testutil.js';
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
  const counter = { n: 0 };
  await withMockedFetch(mockOk(counter), async () => {
    await Promise.all([ensureOpencodeRunning(LOCAL), ensureOpencodeRunning(LOCAL)]);
    assert.equal(counter.n, 1, `dedup failed — health poll called ${counter.n} times for 2 concurrent calls`);
  });
});

test('ensureOpencodeRunning starts two different servers concurrently (separate Map entries)', async () => {
  const counter = { n: 0 };
  await withMockedFetch(mockOk(counter), async () => {
    await Promise.all([ensureOpencodeRunning(LOCAL), ensureOpencodeRunning(LOCAL_ALT)]);
    assert.equal(counter.n, 2, `expected 2 distinct health polls (one per server), got ${counter.n}`);
  });
});

test('ensureOpencodeRunning throws when OpenCode does not become healthy within timeout', async () => {
  await withEnv({ LEGATE_AUTOSTART_TIMEOUT_MS: '200' }, async () => {
    await withMockedFetch(errorFetch(), async () => {
      await assert.rejects(
        () => ensureOpencodeRunning(LOCAL),
        (err: Error) => err.message.includes('OpenCode did not become healthy within'),
      );
    });
  });
});

test('ensureOpencodeRunning health poll uses authFetch (injects auth header when password set)', async () => {
  await withEnv({ LEGATE_SERVER_PASSWORD: 'healthtest' }, async () => {
    let capturedAuth: string | null = null;
    await withMockedFetch((req: Request) => {
      capturedAuth = req.headers.get('Authorization');
      return Promise.resolve(new Response('{}', { status: 200 }));
    }, async () => {
      await ensureOpencodeRunning(LOCAL);
      const expected = `Basic ${Buffer.from('opencode:healthtest').toString('base64')}`;
      assert.equal(capturedAuth, expected, 'health poll should inject Authorization header');
    });
  });
});

test('health poll URL targets server.host:server.port (not BASE_URL)', async () => {
  const urlCapture = { url: '' };
  await withMockedFetch(mockOk(undefined, urlCapture), async () => {
    await ensureOpencodeRunning(CUSTOM);
    assert.ok(urlCapture.url.includes(':4099/global/health'), `expected :4099/global/health in URL, got: ${urlCapture.url}`);
  });
});

test('ensureOpencodeRunning passes serve --port <port> to the spawner', async () => {
  await withMockedFetch(mockOk(), async () => {
    await ensureOpencodeRunning(CUSTOM);
    assert.equal(spawnCalls.length, 1, `expected exactly 1 spawn, got ${spawnCalls.length}`);
    assert.deepEqual(spawnCalls[0].args, ['serve', '--port', '4099']);
  });
});

test('ensureOpencodeRunning fails fast with a clear message when spawn errors (ENOENT)', async () => {
  // Health poll never succeeds — the spawn error must reject FIRST (fast), not
  // after the full health timeout.
  spawnErrorToEmit = Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' });
  const started = Date.now();
  await withMockedFetch(errorFetch(), async () => {
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
  });
});

// ── RENAME-04 deprecation warning tests ────────────────────────────────────
// Warning text Plan 02 will emit: '[Legate] PREFECT_AUTOSTART_TIMEOUT_MS is deprecated, use LEGATE_AUTOSTART_TIMEOUT_MS'
// These tests MUST FAIL (RED) against current source — Plan 02 exports autostartTimeoutMs
// and _resetWarnFlags from autostart.ts to make them pass.

test('autostartTimeoutMs emits one-time deprecation warning for PREFECT_AUTOSTART_TIMEOUT_MS when LEGATE_AUTOSTART_TIMEOUT_MS is not set', async () => {
  _resetWarnFlags();
  await withEnv({ LEGATE_AUTOSTART_TIMEOUT_MS: undefined, PREFECT_AUTOSTART_TIMEOUT_MS: '5000' }, async () => {
    const { warnings } = await captureWarnings(() => autostartTimeoutMs());
    const timeoutWarnings = warnings.filter((w) => w.includes('PREFECT_AUTOSTART_TIMEOUT_MS'));
    assert.equal(timeoutWarnings.length, 1, `expected exactly 1 PREFECT_AUTOSTART_TIMEOUT_MS warning, got ${timeoutWarnings.length}: ${JSON.stringify(warnings)}`);
    assert.ok(timeoutWarnings[0].includes('LEGATE_AUTOSTART_TIMEOUT_MS'), `warning should mention LEGATE_AUTOSTART_TIMEOUT_MS: ${timeoutWarnings[0]}`);
  });
});

test('autostartTimeoutMs emits PREFECT_AUTOSTART_TIMEOUT_MS warning exactly once when called twice (one-time-per-process guard)', async () => {
  _resetWarnFlags();
  await withEnv({ LEGATE_AUTOSTART_TIMEOUT_MS: undefined, PREFECT_AUTOSTART_TIMEOUT_MS: '5000' }, async () => {
    const { warnings } = await captureWarnings(() => {
      autostartTimeoutMs();
      autostartTimeoutMs(); // second call — must NOT emit a second warning
    });
    const timeoutWarnings = warnings.filter((w) => w.includes('PREFECT_AUTOSTART_TIMEOUT_MS'));
    assert.equal(timeoutWarnings.length, 1, `expected exactly 1 PREFECT_AUTOSTART_TIMEOUT_MS warning across 2 calls, got ${timeoutWarnings.length}`);
  });
});

test('autostartTimeoutMs emits NO PREFECT_AUTOSTART_TIMEOUT_MS warning when LEGATE_AUTOSTART_TIMEOUT_MS is also set (LEGATE_* takes precedence)', async () => {
  _resetWarnFlags();
  await withEnv({ LEGATE_AUTOSTART_TIMEOUT_MS: '10000', PREFECT_AUTOSTART_TIMEOUT_MS: '5000' }, async () => {
    const { warnings } = await captureWarnings(() => autostartTimeoutMs());
    const timeoutWarnings = warnings.filter((w) => w.includes('PREFECT_AUTOSTART_TIMEOUT_MS'));
    assert.equal(timeoutWarnings.length, 0, `expected 0 PREFECT_AUTOSTART_TIMEOUT_MS warnings when LEGATE_AUTOSTART_TIMEOUT_MS is set, got ${timeoutWarnings.length}`);
  });
});
