import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRegistry, writeRegistry, addServer, removeServer, _runRegistryMigration, serverUrl, findServerByName, findServerByUrl, firstServer, isValidServerEntry } from './registry.js';
import { ServerEntrySchema } from './schemas.js';
import { countSessionsForServer } from './sessions.js';

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'legate-registry-'));
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

test('addServer throws on host:port conflict with a differently-named server', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'alpha', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3' }, regPath);
    assert.throws(
      () => addServer({ name: 'beta', host: 'localhost', port: 4096, providerID: 'ollama', modelID: 'qwen3' }, regPath),
      /Host\/port conflict/,
    );
    // Registry should still contain only alpha
    const reg = readRegistry(regPath);
    assert.equal(reg.servers.length, 1);
    assert.equal(reg.servers[0].name, 'alpha');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('addServer allows updating a server to the same host:port (same name is not a conflict)', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'alpha', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3' }, regPath);
    assert.doesNotThrow(
      () => addServer({ name: 'alpha', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3-turbo' }, regPath),
    );
    const reg = readRegistry(regPath);
    assert.equal(reg.servers[0].modelID, 'qwen3-turbo');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── legate-8jm: URL-format + lookup helpers ─────────────────────────────────

test('legate-8jm: serverUrl formats http://host:port', () => {
  assert.equal(serverUrl({ host: 'localhost', port: 4096 }), 'http://localhost:4096');
  assert.equal(serverUrl({ host: '127.0.0.1', port: 5000 }), 'http://127.0.0.1:5000');
});

test('legate-8jm: findServerByName returns the matching entry or undefined', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'a', host: 'ha', port: 1, providerID: 'vllm', modelID: 'm' }, regPath);
    addServer({ name: 'b', host: 'hb', port: 2, providerID: 'vllm', modelID: 'm' }, regPath);
    assert.equal(findServerByName('b', regPath)?.host, 'hb');
    assert.equal(findServerByName('nope', regPath), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legate-8jm: findServerByUrl matches on the canonical http://host:port', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    addServer({ name: 'a', host: 'ha', port: 4096, providerID: 'vllm', modelID: 'm' }, regPath);
    assert.equal(findServerByUrl('http://ha:4096', regPath)?.name, 'a');
    assert.equal(findServerByUrl('http://ha:9999', regPath), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legate-8jm: firstServer returns the first entry or undefined when empty', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    assert.equal(firstServer(regPath), undefined);
    addServer({ name: 'a', host: 'ha', port: 1, providerID: 'vllm', modelID: 'm' }, regPath);
    addServer({ name: 'b', host: 'hb', port: 2, providerID: 'vllm', modelID: 'm' }, regPath);
    assert.equal(firstServer(regPath)?.name, 'a');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── legate-8jm: readRegistry entry validation (skip-on-malformed) ────────────

function captureStderr<T>(fn: () => T): { result: T; stderr: string } {
  const original = console.error;
  let stderr = '';
  console.error = (...args: unknown[]) => { stderr += args.map(String).join(' ') + '\n'; };
  try {
    return { result: fn(), stderr };
  } finally {
    console.error = original;
  }
}

test('legate-8jm: readRegistry skips a malformed entry (bad port) and keeps valid ones', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    // Hand-edited registry: one good entry, one with a string port (invalid).
    writeFileSync(regPath, JSON.stringify({
      servers: [
        { name: 'good', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'm' },
        { name: 'bad', host: 'localhost', port: 'not-a-number', providerID: 'vllm', modelID: 'm' },
      ],
    }, null, 2) + '\n');
    const { result, stderr } = captureStderr(() => readRegistry(regPath));
    assert.equal(result.servers.length, 1, 'only the valid entry should survive');
    assert.equal(result.servers[0].name, 'good');
    assert.ok(stderr.includes('Skipping malformed registry entry'), `should warn: ${stderr}`);
    assert.ok(stderr.includes('bad'), `warning should name the bad entry: ${stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legate-8jm: readRegistry skips an entry missing name/host and reports (unnamed)', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    writeFileSync(regPath, JSON.stringify({
      servers: [
        { host: 'localhost', port: 4096 }, // no name
        { name: 'ok', host: 'localhost', port: 4097, providerID: 'vllm', modelID: 'm' },
      ],
    }, null, 2) + '\n');
    const { result, stderr } = captureStderr(() => readRegistry(regPath));
    assert.equal(result.servers.length, 1);
    assert.equal(result.servers[0].name, 'ok');
    assert.ok(stderr.includes('(unnamed)'), `nameless entry should be reported as (unnamed): ${stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legate-8jm: readRegistry keeps sparse-but-routable entries (no providerID/modelID)', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    // Only routing fields present — must still be usable (providerID/modelID are lenient).
    writeFileSync(regPath, JSON.stringify({
      servers: [{ name: 'sparse', host: 'localhost', port: 4096 }],
    }, null, 2) + '\n');
    const reg = readRegistry(regPath);
    assert.equal(reg.servers.length, 1);
    assert.equal(reg.servers[0].name, 'sparse');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legate-8jm: isValidServerEntry (guard) agrees with ServerEntrySchema (zod mirror)', () => {
  const cases: unknown[] = [
    { name: 'a', host: 'h', port: 4096, providerID: 'vllm', modelID: 'm' }, // valid full
    { name: 'a', host: 'h', port: 4096 },                                    // valid sparse
    { name: 'a', host: 'h', port: 4096, maxSessions: 3 },                    // valid capped
    { name: '', host: 'h', port: 4096 },                                     // empty name
    { name: 'a', host: '', port: 4096 },                                     // empty host
    { name: 'a', host: 'h', port: 'x' },                                     // non-number port
    { name: 'a', host: 'h', port: 0 },                                       // non-positive port
    { name: 'a', host: 'h', port: 4096.5 },                                  // non-integer port
    { name: 'a', host: 'h', port: 4096, providerID: 5 },                     // wrong providerID type
    { host: 'h', port: 4096 },                                              // missing name
    null,
    'not-an-object',
  ];
  for (const c of cases) {
    assert.equal(
      isValidServerEntry(c),
      ServerEntrySchema.safeParse(c).success,
      `guard and zod schema must agree for ${JSON.stringify(c)}`,
    );
  }
});

test('legate-8jm: readRegistry still throws on a totally malformed top-level shape', () => {
  const dir = freshTmp();
  try {
    const regPath = join(dir, 'servers.json');
    writeFileSync(regPath, JSON.stringify({ notServers: 1 }) + '\n');
    assert.throws(() => readRegistry(regPath), /malformed registry|could not parse/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Migration guard regression tests (legate-5di) ───────────────────────────
// Mirrors the two sessions._runMigration tests. Regression for: the guard was
// `!existsSync(dir)` but `legate add-server` creates ~/.config/legate/ before the
// MCP runs, so a directory-existence check silently skipped servers.json migration.

test('_runRegistryMigration copies old dir when target servers.json absent, even if target dir already exists', () => {
  const root = freshTmp();
  try {
    // Simulate: CLI created ~/.config/legate/ but no servers.json yet
    const newDir = join(root, 'legate');
    const newPath = join(newDir, 'servers.json');
    mkdirSync(newDir);

    // Simulate: old ~/.config/prefect/ with a servers.json
    const oldDir = join(root, 'prefect');
    mkdirSync(oldDir);
    writeFileSync(join(oldDir, 'servers.json'), JSON.stringify({ servers: [{ name: 'old', host: 'h', port: 1, providerID: 'vllm', modelID: 'qwen3' }] }));

    _runRegistryMigration(newPath, oldDir);

    assert.ok(existsSync(newPath), 'servers.json should have been migrated');
    const migrated = JSON.parse(readFileSync(newPath, 'utf8'));
    assert.equal(migrated.servers[0].name, 'old', 'migrated registry should contain the old entry');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('_runRegistryMigration skips copy when target servers.json already exists (migration already done)', () => {
  const root = freshTmp();
  try {
    const newDir = join(root, 'legate');
    const newPath = join(newDir, 'servers.json');
    mkdirSync(newDir);
    // Target servers.json already present — migration must not overwrite
    writeFileSync(newPath, JSON.stringify({ servers: [{ name: 'existing', host: 'h', port: 2, providerID: 'vllm', modelID: 'qwen3' }] }));

    const oldDir = join(root, 'prefect');
    mkdirSync(oldDir);
    writeFileSync(join(oldDir, 'servers.json'), JSON.stringify({ servers: [{ name: 'old', host: 'h', port: 1, providerID: 'vllm', modelID: 'qwen3' }] }));

    _runRegistryMigration(newPath, oldDir);

    const after = JSON.parse(readFileSync(newPath, 'utf8'));
    assert.equal(after.servers[0].name, 'existing', 'existing entry should be preserved');
    assert.ok(!after.servers.some((s: { name: string }) => s.name === 'old'), 'old entry should NOT have been merged in');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
