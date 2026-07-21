import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveServerUrl } from './routing.js';
import { addSession } from './sessions.js';
import { writeRegistry } from './registry.js';

// legate-e1i: behavioral coverage for the D-06/D-07 server-URL fallback chain.
// resolveServerUrl is pure once its config paths are injected, so each branch is
// exercised against temp sessions.json/servers.json files — no host state, no network.

const BASE = 'http://base.example:9999';

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'legate-routing-'));
}

test('legate-e1i: resolveServerUrl — sessionId hit returns the session URL', async () => {
  const dir = freshTmp();
  try {
    const sPath = join(dir, 'sessions.json');
    const rPath = join(dir, 'servers.json');
    await addSession('ses_known', { server: 'thor', url: 'http://thor:4096' }, sPath);
    const url = resolveServerUrl('ses_known', undefined, BASE, sPath, rPath);
    assert.equal(url, 'http://thor:4096');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legate-e1i: resolveServerUrl — sessionId miss throws the exact not-found-in-sessions.json message', () => {
  const dir = freshTmp();
  try {
    const sPath = join(dir, 'sessions.json');
    const rPath = join(dir, 'servers.json');
    // No sessions written — sessionId cannot resolve.
    assert.throws(
      () => resolveServerUrl('ses_missing', undefined, BASE, sPath, rPath),
      (err: Error) => {
        assert.equal(
          err.message,
          `Session 'ses_missing' not found in sessions.json. It may have been deleted or never created via legate_create_session.`,
        );
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legate-e1i: resolveServerUrl — serverName hit returns the registry URL (http://host:port)', () => {
  const dir = freshTmp();
  try {
    const sPath = join(dir, 'sessions.json');
    const rPath = join(dir, 'servers.json');
    writeRegistry(
      {
        servers: [
          { name: 'lab', host: 'labhost', port: 4097, providerID: 'vllm', modelID: 'qwen' },
          { name: 'bee', host: 'beehost', port: 4098, providerID: 'ollama', modelID: 'qwen3-coder' },
        ],
      },
      rPath,
    );
    const url = resolveServerUrl(undefined, 'bee', BASE, sPath, rPath);
    assert.equal(url, 'http://beehost:4098');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legate-e1i: resolveServerUrl — serverName miss throws the exact not-found-in-registry message', () => {
  const dir = freshTmp();
  try {
    const sPath = join(dir, 'sessions.json');
    const rPath = join(dir, 'servers.json');
    writeRegistry(
      {
        servers: [{ name: 'lab', host: 'labhost', port: 4097, providerID: 'vllm', modelID: 'qwen' }],
      },
      rPath,
    );
    assert.throws(
      () => resolveServerUrl(undefined, 'ghost', BASE, sPath, rPath),
      (err: Error) => {
        assert.equal(
          err.message,
          `Server 'ghost' not found in registry. Run 'legate list-servers' to see registered servers.`,
        );
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legate-e1i: resolveServerUrl — no inputs + non-empty registry returns the first entry', () => {
  const dir = freshTmp();
  try {
    const sPath = join(dir, 'sessions.json');
    const rPath = join(dir, 'servers.json');
    writeRegistry(
      {
        servers: [
          { name: 'first', host: 'firsthost', port: 4096, providerID: 'vllm', modelID: 'qwen' },
          { name: 'second', host: 'secondhost', port: 4097, providerID: 'vllm', modelID: 'qwen' },
        ],
      },
      rPath,
    );
    const url = resolveServerUrl(undefined, undefined, BASE, sPath, rPath);
    assert.equal(url, 'http://firsthost:4096');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legate-e1i: resolveServerUrl — no inputs + empty registry falls back to baseUrl', () => {
  const dir = freshTmp();
  try {
    const sPath = join(dir, 'sessions.json');
    const rPath = join(dir, 'servers.json');
    // No registry file written — readRegistry returns { servers: [] } (ENOENT path).
    const url = resolveServerUrl(undefined, undefined, BASE, sPath, rPath);
    assert.equal(url, BASE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
