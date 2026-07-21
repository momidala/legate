import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAuthHeader,
  authFetch,
  _resetWarnFlags,
  _isTrustedHost,
  _setRegistryPathForTest,
} from './auth.js';
// legate-4ah: shared try/finally helpers — see testutil.ts for rationale.
import { withEnv, withMockedFetch, captureWarnings } from './testutil.js';

beforeEach(() => _resetWarnFlags());
afterEach(() => _setRegistryPathForTest(undefined));

// ── buildAuthHeader tests ───────────────────────────────────────────────────

test('buildAuthHeader returns {} when LEGATE_SERVER_PASSWORD is not set', async () => {
  await withEnv({ LEGATE_SERVER_PASSWORD: undefined, LEGATE_SERVER_USERNAME: undefined }, () => {
    const result = buildAuthHeader();
    assert.deepEqual(result, {});
  });
});

test('buildAuthHeader returns Authorization header when LEGATE_SERVER_PASSWORD is set', async () => {
  await withEnv({ LEGATE_SERVER_PASSWORD: 'secret', LEGATE_SERVER_USERNAME: undefined }, () => {
    const result = buildAuthHeader();
    // Buffer.from('opencode:secret').toString('base64') === 'b3BlbmNvZGU6c2VjcmV0'
    const expected = Buffer.from('opencode:secret').toString('base64');
    assert.deepEqual(result, { Authorization: `Basic ${expected}` });
  });
});

test('buildAuthHeader uses LEGATE_SERVER_USERNAME when provided', async () => {
  await withEnv({ LEGATE_SERVER_PASSWORD: 'pw', LEGATE_SERVER_USERNAME: 'alice' }, () => {
    const result = buildAuthHeader();
    // Buffer.from('alice:pw').toString('base64') === 'YWxpY2U6cHc='
    const expected = Buffer.from('alice:pw').toString('base64');
    assert.deepEqual(result, { Authorization: `Basic ${expected}` });
  });
});

// ── authFetch tests ─────────────────────────────────────────────────────────

test('authFetch forwards request unchanged when no password set', async () => {
  await withEnv({ LEGATE_SERVER_PASSWORD: undefined, LEGATE_SERVER_USERNAME: undefined }, async () => {
    let capturedRequest: Request | undefined;
    await withMockedFetch((req: Request) => {
      capturedRequest = req;
      return Promise.resolve(new Response('ok'));
    }, async () => {
      const req = new Request('http://localhost:4096/test');
      await authFetch(req);
      assert.ok(capturedRequest !== undefined, 'fetch should have been called');
      assert.equal(capturedRequest!.url, 'http://localhost:4096/test');
      assert.equal(capturedRequest!.headers.get('Authorization'), null);
    });
  });
});

test('authFetch injects Authorization header when LEGATE_SERVER_PASSWORD is set', async () => {
  await withEnv({ LEGATE_SERVER_PASSWORD: 'secret', LEGATE_SERVER_USERNAME: undefined }, async () => {
    let capturedRequest: Request | undefined;
    await withMockedFetch((req: Request) => {
      capturedRequest = req;
      return Promise.resolve(new Response('ok'));
    }, async () => {
      const req = new Request('http://localhost:4096/test');
      await authFetch(req);
      assert.ok(capturedRequest !== undefined, 'fetch should have been called');
      const expected = `Basic ${Buffer.from('opencode:secret').toString('base64')}`;
      assert.equal(capturedRequest!.headers.get('Authorization'), expected);
    });
  });
});

// ── RENAME-04 deprecation warning tests ────────────────────────────────────
// These tests assert that after Plan 02 renames PREFECT_* → LEGATE_*, the
// PREFECT_* vars emit a one-time deprecation warning to console.error (stderr).
// These tests MUST FAIL (RED) against the current source — Plan 02 implements
// the LEGATE_* support that makes them pass.

// Warning text Plan 02 will emit: '[Legate] PREFECT_SERVER_PASSWORD is deprecated, use LEGATE_SERVER_PASSWORD'
test('buildAuthHeader emits one-time deprecation warning for PREFECT_SERVER_PASSWORD when LEGATE_SERVER_PASSWORD is not set', async () => {
  _resetWarnFlags();
  await withEnv({
    LEGATE_SERVER_PASSWORD: undefined,
    PREFECT_SERVER_PASSWORD: 'legacy-pw',
    OPENCODE_SERVER_PASSWORD: undefined,
  }, async () => {
    const { warnings } = await captureWarnings(() => buildAuthHeader());
    const pwWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_PASSWORD'));
    assert.equal(pwWarnings.length, 1, `expected exactly 1 PREFECT_SERVER_PASSWORD warning, got ${pwWarnings.length}: ${JSON.stringify(warnings)}`);
    assert.ok(pwWarnings[0].includes('LEGATE_SERVER_PASSWORD'), `warning should mention LEGATE_SERVER_PASSWORD: ${pwWarnings[0]}`);
  });
});

test('buildAuthHeader emits PREFECT_SERVER_PASSWORD warning exactly once when called twice (one-time-per-process guard)', async () => {
  _resetWarnFlags();
  await withEnv({
    LEGATE_SERVER_PASSWORD: undefined,
    PREFECT_SERVER_PASSWORD: 'legacy-pw',
    OPENCODE_SERVER_PASSWORD: undefined,
  }, async () => {
    const { warnings } = await captureWarnings(() => {
      buildAuthHeader();
      buildAuthHeader(); // second call — must NOT emit a second warning
    });
    const pwWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_PASSWORD'));
    assert.equal(pwWarnings.length, 1, `expected exactly 1 PREFECT_SERVER_PASSWORD warning across 2 calls, got ${pwWarnings.length}`);
  });
});

test('buildAuthHeader emits NO PREFECT_SERVER_PASSWORD warning when LEGATE_SERVER_PASSWORD is also set (LEGATE_* takes precedence)', async () => {
  _resetWarnFlags();
  await withEnv({
    LEGATE_SERVER_PASSWORD: 'new-pw',
    PREFECT_SERVER_PASSWORD: 'old-pw',
    OPENCODE_SERVER_PASSWORD: undefined,
  }, async () => {
    const { warnings } = await captureWarnings(() => buildAuthHeader());
    const pwWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_PASSWORD'));
    assert.equal(pwWarnings.length, 0, `expected 0 PREFECT_SERVER_PASSWORD warnings when LEGATE_SERVER_PASSWORD is set, got ${pwWarnings.length}`);
  });
});

// Warning text Plan 02 will emit: '[Legate] PREFECT_SERVER_USERNAME is deprecated, use LEGATE_SERVER_USERNAME'
test('buildAuthHeader emits one-time deprecation warning for PREFECT_SERVER_USERNAME when LEGATE_SERVER_USERNAME is not set', async () => {
  _resetWarnFlags();
  await withEnv({
    // Need a password set so username resolution is reached
    LEGATE_SERVER_PASSWORD: 'pw',
    PREFECT_SERVER_PASSWORD: undefined,
    OPENCODE_SERVER_PASSWORD: undefined,
    LEGATE_SERVER_USERNAME: undefined,
    PREFECT_SERVER_USERNAME: 'legacy-user',
    OPENCODE_SERVER_USERNAME: undefined,
  }, async () => {
    const { warnings } = await captureWarnings(() => buildAuthHeader());
    const userWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_USERNAME'));
    assert.equal(userWarnings.length, 1, `expected exactly 1 PREFECT_SERVER_USERNAME warning, got ${userWarnings.length}: ${JSON.stringify(warnings)}`);
    assert.ok(userWarnings[0].includes('LEGATE_SERVER_USERNAME'), `warning should mention LEGATE_SERVER_USERNAME: ${userWarnings[0]}`);
  });
});

test('buildAuthHeader emits PREFECT_SERVER_USERNAME warning exactly once when called twice (one-time-per-process guard)', async () => {
  _resetWarnFlags();
  await withEnv({
    LEGATE_SERVER_PASSWORD: 'pw',
    PREFECT_SERVER_PASSWORD: undefined,
    OPENCODE_SERVER_PASSWORD: undefined,
    LEGATE_SERVER_USERNAME: undefined,
    PREFECT_SERVER_USERNAME: 'legacy-user',
    OPENCODE_SERVER_USERNAME: undefined,
  }, async () => {
    const { warnings } = await captureWarnings(() => {
      buildAuthHeader();
      buildAuthHeader(); // second call — must NOT emit a second warning
    });
    const userWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_USERNAME'));
    assert.equal(userWarnings.length, 1, `expected exactly 1 PREFECT_SERVER_USERNAME warning across 2 calls, got ${userWarnings.length}`);
  });
});

test('buildAuthHeader emits NO PREFECT_SERVER_USERNAME warning when LEGATE_SERVER_USERNAME is also set (LEGATE_* takes precedence)', async () => {
  _resetWarnFlags();
  await withEnv({
    LEGATE_SERVER_PASSWORD: 'pw',
    PREFECT_SERVER_PASSWORD: undefined,
    OPENCODE_SERVER_PASSWORD: undefined,
    LEGATE_SERVER_USERNAME: 'new-user',
    PREFECT_SERVER_USERNAME: 'old-user',
    OPENCODE_SERVER_USERNAME: undefined,
  }, async () => {
    const { warnings } = await captureWarnings(() => buildAuthHeader());
    const userWarnings = warnings.filter((w) => w.includes('PREFECT_SERVER_USERNAME'));
    assert.equal(userWarnings.length, 0, `expected 0 PREFECT_SERVER_USERNAME warnings when LEGATE_SERVER_USERNAME is set, got ${userWarnings.length}`);
  });
});

// ── legate-k2a: trusted-host credential gating ──────────────────────────────
// authFetch must only attach Basic Auth to trusted hosts (loopback OR a
// registered server). Untrusted hosts get the request WITHOUT credentials plus
// a one-time-per-host warning. These tests mock globalThis.fetch (codebase
// pattern) and inject a temp registry via _setRegistryPathForTest.

/** Install a mock fetch that records every Request and returns the scripted
 *  responses in order (last one repeats). Returns { requests, restore }. */
function installMockFetch(responses: Response[]): { requests: Request[]; restore: () => void } {
  const requests: Request[] = [];
  let i = 0;
  const orig = globalThis.fetch;
  (globalThis as unknown as Record<string, unknown>).fetch = (req: Request) => {
    requests.push(req);
    const res = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve(res);
  };
  return { requests, restore: () => { (globalThis as unknown as Record<string, unknown>).fetch = orig; } };
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

/** Write a temp servers.json and point the trust check at it. Returns cleanup. */
function withRegistry(servers: Array<{ name: string; host: string; port: number }>): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'legate-k2a-'));
  const path = join(dir, 'servers.json');
  writeFileSync(path, JSON.stringify({
    servers: servers.map((s) => ({ ...s, providerID: '', modelID: '' })),
  }));
  _setRegistryPathForTest(path);
  return () => { _setRegistryPathForTest(undefined); rmSync(dir, { recursive: true, force: true }); };
}

function withPassword(pw: string): () => void {
  const prev = process.env.LEGATE_SERVER_PASSWORD;
  const prevUser = process.env.LEGATE_SERVER_USERNAME;
  process.env.LEGATE_SERVER_PASSWORD = pw;
  delete process.env.LEGATE_SERVER_USERNAME;
  return () => {
    if (prev === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prev;
    if (prevUser === undefined) delete process.env.LEGATE_SERVER_USERNAME;
    else process.env.LEGATE_SERVER_USERNAME = prevUser;
  };
}

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  return { lines, restore: () => { console.error = orig; } };
}

test('_isTrustedHost: loopback hosts are trusted without any registry', () => {
  for (const h of ['localhost', '127.0.0.1', '::1', '[::1]']) {
    assert.equal(_isTrustedHost(h, '/nonexistent/servers.json'), true, `${h} should be trusted`);
  }
});

test('_isTrustedHost: registered host is trusted, port-insensitively; unknown host is not', () => {
  const cleanup = withRegistry([{ name: 'remote', host: '10.0.0.5', port: 4096 }]);
  try {
    assert.equal(_isTrustedHost('10.0.0.5'), true, 'registered host should be trusted');
    // port ignored — trust is per-host, not per-port
    assert.equal(_isTrustedHost('10.0.0.5', undefined), true);
    assert.equal(_isTrustedHost('evil.example'), false, 'unregistered host must NOT be trusted');
  } finally {
    cleanup();
  }
});

test('authFetch: loopback + password → Authorization attached', async () => {
  const restorePw = withPassword('secret');
  const mock = installMockFetch([new Response('ok', { status: 200 })]);
  try {
    await authFetch(new Request('http://localhost:4096/test'));
    const expected = `Basic ${Buffer.from('opencode:secret').toString('base64')}`;
    assert.equal(mock.requests[0].headers.get('Authorization'), expected);
  } finally {
    mock.restore();
    restorePw();
  }
});

test('authFetch: registered remote host + password → Authorization attached', async () => {
  const restorePw = withPassword('secret');
  const cleanup = withRegistry([{ name: 'remote', host: '10.0.0.5', port: 4096 }]);
  const mock = installMockFetch([new Response('ok', { status: 200 })]);
  try {
    await authFetch(new Request('http://10.0.0.5:4096/test'));
    const expected = `Basic ${Buffer.from('opencode:secret').toString('base64')}`;
    assert.equal(mock.requests[0].headers.get('Authorization'), expected);
  } finally {
    mock.restore();
    cleanup();
    restorePw();
  }
});

test('authFetch: UNregistered remote host + password → NOT attached + one-time-per-host warning', async () => {
  const restorePw = withPassword('secret');
  const cleanup = withRegistry([]); // empty registry → host is unregistered
  const mock = installMockFetch([new Response('ok', { status: 200 })]);
  const err = captureStderr();
  try {
    await authFetch(new Request('https://evil.example/test'));
    await authFetch(new Request('https://evil.example/test')); // second call, same host
    for (const req of mock.requests) {
      assert.equal(req.headers.get('Authorization'), null, 'credentials must NOT be sent to untrusted host');
    }
    const warns = err.lines.filter((l) => l.includes('Not sending credentials') && l.includes('evil.example'));
    assert.equal(warns.length, 1, `expected exactly one warning across two calls, got ${warns.length}: ${JSON.stringify(err.lines)}`);
    assert.ok(warns[0].includes('legate add-server'), 'warning should point to legate add-server');
  } finally {
    err.restore();
    mock.restore();
    cleanup();
    restorePw();
  }
});

test('authFetch: no password → never attached, no warnings, whatever the host', async () => {
  const prev = process.env.LEGATE_SERVER_PASSWORD;
  delete process.env.LEGATE_SERVER_PASSWORD;
  const cleanup = withRegistry([]);
  const mock = installMockFetch([new Response('ok', { status: 200 })]);
  const err = captureStderr();
  try {
    await authFetch(new Request('https://evil.example/test'));
    assert.equal(mock.requests[0].headers.get('Authorization'), null);
    assert.equal(err.lines.length, 0, `expected no warnings, got: ${JSON.stringify(err.lines)}`);
  } finally {
    err.restore();
    mock.restore();
    cleanup();
    if (prev === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prev;
  }
});

test('authFetch: same-host redirect with auth → followed, auth present on second request', async () => {
  const restorePw = withPassword('secret');
  const mock = installMockFetch([
    redirectResponse('http://localhost:4096/after'),
    new Response('ok', { status: 200 }),
  ]);
  try {
    const res = await authFetch(new Request('http://localhost:4096/before'));
    assert.equal(res.status, 200);
    assert.equal(mock.requests.length, 2, 'redirect should have been followed once');
    const expected = `Basic ${Buffer.from('opencode:secret').toString('base64')}`;
    assert.equal(mock.requests[0].headers.get('Authorization'), expected, 'first hop carries auth');
    assert.equal(mock.requests[1].headers.get('Authorization'), expected, 'same-host second hop re-attaches auth');
    assert.equal(mock.requests[1].url, 'http://localhost:4096/after');
  } finally {
    mock.restore();
    restorePw();
  }
});

test('authFetch: cross-host redirect with auth → second request has NO Authorization header', async () => {
  const restorePw = withPassword('secret');
  const mock = installMockFetch([
    redirectResponse('http://evil.example/steal'),
    new Response('ok', { status: 200 }),
  ]);
  const err = captureStderr();
  try {
    const res = await authFetch(new Request('http://localhost:4096/before'));
    assert.equal(res.status, 200);
    assert.equal(mock.requests.length, 2);
    assert.ok(mock.requests[0].headers.get('Authorization'), 'first (loopback) hop carries auth');
    assert.equal(mock.requests[1].headers.get('Authorization'), null, 'cross-host hop must drop credentials');
    assert.equal(mock.requests[1].url, 'http://evil.example/steal');
    assert.ok(
      err.lines.some((l) => l.includes('cross-host redirect') && l.includes('evil.example')),
      `expected a cross-host warning, got: ${JSON.stringify(err.lines)}`,
    );
  } finally {
    err.restore();
    mock.restore();
    restorePw();
  }
});

test('authFetch: redirect loop → throws after MAX_REDIRECTS (3) hops', async () => {
  const restorePw = withPassword('secret');
  // Always redirects same-host → never resolves. Must be capped, not spin forever.
  const mock = installMockFetch([redirectResponse('http://localhost:4096/loop')]);
  try {
    await assert.rejects(
      () => authFetch(new Request('http://localhost:4096/start')),
      (e: Error) => {
        assert.ok(e.message.includes('exceeded 3 redirects'), `got: ${e.message}`);
        return true;
      },
    );
    // 3 followed hops + the 4th fetch whose redirect we refuse to follow.
    assert.equal(mock.requests.length, 4, `expected 4 fetches (3 follows + refusal), got ${mock.requests.length}`);
  } finally {
    mock.restore();
    restorePw();
  }
});
