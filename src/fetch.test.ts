import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchWithAuth } from './fetch.js';
import { _resetWarnFlags, _setRegistryPathForTest } from './auth.js';

// legate-k2a: integration coverage for fetchWithAuth's interaction with the new
// trusted-host credential gating in authFetch. The security-critical unit behavior
// (trust rule, redirect stripping, warn-once) is asserted in auth.test.ts; here we
// verify the fetch.ts wrapper still layers its cleartext-HTTP warning on top and
// that auth attachment survives the wrapper for a registered remote host.
//
// NOTE: fetch.ts's own _warnedRemoteHosts set has no reset hook, so each test uses
// a DISTINCT hostname to keep its one-time cleartext warning independent.

beforeEach(() => _resetWarnFlags());
afterEach(() => _setRegistryPathForTest(undefined));

function installMockFetch(): { requests: Request[]; restore: () => void } {
  const requests: Request[] = [];
  const orig = globalThis.fetch;
  (globalThis as unknown as Record<string, unknown>).fetch = (req: Request) => {
    requests.push(req);
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  return { requests, restore: () => { (globalThis as unknown as Record<string, unknown>).fetch = orig; } };
}

function withRegistry(servers: Array<{ name: string; host: string; port: number }>): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'legate-k2a-fetch-'));
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

test('fetchWithAuth: registered remote host + password → auth attached AND cleartext-HTTP warning still fires', async () => {
  const restorePw = withPassword('secret');
  const cleanup = withRegistry([{ name: 'remote', host: '10.0.0.11', port: 4096 }]);
  const mock = installMockFetch();
  const err = captureStderr();
  try {
    await fetchWithAuth(new Request('http://10.0.0.11:4096/config'));
    const expected = `Basic ${Buffer.from('opencode:secret').toString('base64')}`;
    assert.equal(mock.requests[0].headers.get('Authorization'), expected, 'registered host should receive credentials');
    // fetch.ts:60-66 cleartext warning must still fire for plain-http non-loopback.
    assert.ok(
      err.lines.some((l) => l.includes('plain HTTP') && l.includes('10.0.0.11')),
      `expected cleartext-HTTP warning, got: ${JSON.stringify(err.lines)}`,
    );
  } finally {
    err.restore();
    mock.restore();
    cleanup();
    restorePw();
  }
});

test('fetchWithAuth: unregistered remote host + password → NOT attached (both cleartext + untrusted warnings fire)', async () => {
  const restorePw = withPassword('secret');
  const cleanup = withRegistry([]); // empty → host is unregistered
  const mock = installMockFetch();
  const err = captureStderr();
  try {
    await fetchWithAuth(new Request('http://10.0.0.12:4096/config'));
    assert.equal(mock.requests[0].headers.get('Authorization'), null, 'unregistered host must NOT receive credentials');
    assert.ok(err.lines.some((l) => l.includes('plain HTTP') && l.includes('10.0.0.12')), 'cleartext warning fires');
    assert.ok(err.lines.some((l) => l.includes('Not sending credentials') && l.includes('10.0.0.12')), 'untrusted-host warning fires');
  } finally {
    err.restore();
    mock.restore();
    cleanup();
    restorePw();
  }
});

test('fetchWithAuth: no password → forwarded unchanged, no auth, no warnings, redirect stays default (follow)', async () => {
  const prev = process.env.LEGATE_SERVER_PASSWORD;
  delete process.env.LEGATE_SERVER_PASSWORD;
  const mock = installMockFetch();
  const err = captureStderr();
  try {
    // loopback + no password: no cleartext warning (localhost), no auth path at all.
    await fetchWithAuth(new Request('http://localhost:4096/config'));
    assert.equal(mock.requests[0].headers.get('Authorization'), null);
    assert.equal(mock.requests[0].redirect, 'follow', 'unauthenticated path must keep default redirect: follow');
    assert.equal(err.lines.length, 0, `expected no warnings, got: ${JSON.stringify(err.lines)}`);
  } finally {
    err.restore();
    mock.restore();
    if (prev === undefined) delete process.env.LEGATE_SERVER_PASSWORD;
    else process.env.LEGATE_SERVER_PASSWORD = prev;
  }
});
