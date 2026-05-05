import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRegistry, writeRegistry, addServer, removeServer } from './registry.js';
import { countSessionsForServer } from './sessions.js';

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'prefect-registry-'));
}

const REGISTRY_BUILD = resolve(process.cwd(), 'build/registry.js');
if (!existsSync(REGISTRY_BUILD)) {
  throw new Error(`Build artifact missing: run 'npm run build' first`);
}

function runDriver(script: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

test('readRegistry returns empty registry when file does not exist', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    // File is NOT created
    const reg = readRegistry(regPath);
    assert.deepEqual(reg, { servers: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRegistry creates parent directory and writes pretty-printed JSON with trailing newline', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'nested', 'subdir', 'servers.json');
    writeRegistry({ servers: [{ name: 'a', host: 'h', port: 1, providerID: 'vllm', modelID: 'qwen3' }] }, regPath);
    assert.equal(existsSync(regPath), true);
    const raw = readFileSync(regPath, 'utf8');
    assert.ok(raw.endsWith('\n'), 'file should end with newline');
    assert.ok(raw.includes('  "name": "a"'), 'file should use 2-space indent');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, { servers: [{ name: 'a', host: 'h', port: 1, providerID: 'vllm', modelID: 'qwen3' }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addServer appends a new entry when name is not present', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'local', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3' }, regPath);
    const reg = readRegistry(regPath);
    assert.equal(reg.servers.length, 1);
    assert.equal(reg.servers[0].port, 4096);
    assert.equal(typeof reg.servers[0].port, 'number');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addServer overwrites entry when name already exists', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'local', host: 'old', port: 1, providerID: 'vllm', modelID: 'a' }, regPath);
    addServer({ name: 'local', host: 'new', port: 2, providerID: 'vllm', modelID: 'b' }, regPath);
    const reg = readRegistry(regPath);
    assert.equal(reg.servers.length, 1);
    assert.equal(reg.servers[0].host, 'new');
    assert.equal(reg.servers[0].port, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeServer deletes a matching entry and persists', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'local', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3' }, regPath);
    addServer({ name: 'dev', host: 'devbox', port: 4097, providerID: 'vllm', modelID: 'qwen3' }, regPath);
    removeServer('local', regPath);
    const reg = readRegistry(regPath);
    assert.equal(reg.servers.length, 1);
    assert.equal(reg.servers[0].name, 'dev');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeServer with missing name exits 1 with stderr error', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    const driver = `import('${pathToFileURL(REGISTRY_BUILD).href}').then(m => m.removeServer('does-not-exist', '${regPath}'));`;
    const res = runDriver(driver);
    assert.equal(res.status, 1);
    assert.ok(res.stderr.includes("no server named 'does-not-exist'"), `stderr was: ${res.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listServers prints empty-registry message to stdout', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    // File does NOT exist — empty registry
    const driver = `import('${pathToFileURL(REGISTRY_BUILD).href}').then(m => m.listServers('${regPath}'));`;
    const res = runDriver(driver);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('No servers registered'), `stdout was: ${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listServers prints tabular header + rows to stdout when entries exist', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'local', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3' }, regPath);
    addServer({ name: 'dev', host: 'devbox', port: 4097, providerID: 'ollama', modelID: 'llama3' }, regPath);
    const driver = `import('${pathToFileURL(REGISTRY_BUILD).href}').then(m => m.listServers('${regPath}'));`;
    const res = runDriver(driver);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('NAME'), `stdout missing NAME, was: ${res.stdout}`);
    assert.ok(res.stdout.includes('PORT'), `stdout missing PORT, was: ${res.stdout}`);
    assert.ok(res.stdout.includes('PROVIDER'), `stdout missing PROVIDER, was: ${res.stdout}`);
    assert.ok(res.stdout.includes('MODEL'), `stdout missing MODEL, was: ${res.stdout}`);
    assert.ok(res.stdout.includes('local'), `stdout missing 'local', was: ${res.stdout}`);
    assert.ok(res.stdout.includes('dev'), `stdout missing 'dev', was: ${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('port stored in registry is typeof number not string', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'a', host: 'h', port: 4096, providerID: 'vllm', modelID: 'qwen3' }, regPath);
    const raw = JSON.parse(readFileSync(regPath, 'utf8'));
    assert.equal(raw.servers[0].port, 4096);
    assert.equal(typeof raw.servers[0].port, 'number');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// MULTI-11: maxSessions round-trip tests
test('MULTI-11: addServer round-trips maxSessions field', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'capped', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3', maxSessions: 5 }, regPath);
    const reg = readRegistry(regPath);
    assert.equal(reg.servers[0].maxSessions, 5);
    assert.equal(typeof reg.servers[0].maxSessions, 'number');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: addServer without maxSessions stores no maxSessions key', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'unlimited', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3' }, regPath);
    const reg = readRegistry(regPath);
    assert.equal(reg.servers[0].maxSessions, undefined);
    const raw = JSON.parse(readFileSync(regPath, 'utf8'));
    assert.ok(!('maxSessions' in raw.servers[0]), 'maxSessions must not appear in JSON when not set');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: countSessionsForServer returns count of matching sessions', () => {
  const dir = freshTmp();
  try {
    const sessionsPath = join(dir, 'sessions.json');
    writeFileSync(sessionsPath, JSON.stringify({
      sessions: {
        's1': { server: 'local', url: 'http://localhost:4096' },
        's2': { server: 'local', url: 'http://localhost:4096' },
        's3': { server: 'dev', url: 'http://devbox:4097' },
      }
    }, null, 2) + '\n');
    assert.equal(countSessionsForServer('local', sessionsPath), 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: countSessionsForServer returns 0 for absent server', () => {
  const dir = freshTmp();
  try {
    const sessionsPath = join(dir, 'sessions.json');
    writeFileSync(sessionsPath, JSON.stringify({
      sessions: {
        's1': { server: 'local', url: 'http://localhost:4096' },
      }
    }, null, 2) + '\n');
    assert.equal(countSessionsForServer('absent', sessionsPath), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: countSessionsForServer returns 0 when sessions.json does not exist', () => {
  const dir = freshTmp();
  try {
    const sessionsPath = join(dir, 'sessions.json');
    assert.equal(countSessionsForServer('local', sessionsPath), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: listServers shows CAPACITY column header and unlimited for uncapped server', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'local', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3' }, regPath);
    const driver = `import('${pathToFileURL(REGISTRY_BUILD).href}').then(m => m.listServers('${regPath}'));`;
    const res = runDriver(driver);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('CAPACITY'), `stdout missing CAPACITY column, was: ${res.stdout}`);
    assert.ok(res.stdout.includes('unlimited'), `stdout missing 'unlimited', was: ${res.stdout}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: listServers shows numeric capacity for capped server', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'capped', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3', maxSessions: 3 }, regPath);
    const driver = `import('${pathToFileURL(REGISTRY_BUILD).href}').then(m => m.listServers('${regPath}'));`;
    const res = runDriver(driver);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('3'), `stdout missing '3', was: ${res.stdout}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
