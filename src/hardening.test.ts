import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redactSecrets } from './redact.js';

// legate-tcg: hardening coverage for the three prompt-injection-mediated primitives.
//   1. redactSecrets (unit) — the always-on server-side redaction for legate_get_config.
//   2. The LEGATE_ENABLE_EXEC_TOOLS opt-in gate on legate_session_shell /
//      legate_inject_mcp_server (driven end-to-end over MCP stdio).
//   3. legate_get_config end-to-end — an apiKey in the mock config is redacted.
//
// The e2e harness mirrors src/server-e2e.test.ts: drive the BUILT server
// (build/index.js) over MCP stdio with a mock OpenCode HTTP server behind it via
// LEGATE_SERVER_URL, HOME pointed at a temp dir so real ~/.config/legate is untouched.

// ─────────────────────────────────────────────────────────────────────────────
// redactSecrets — unit
// ─────────────────────────────────────────────────────────────────────────────

test('legate-tcg: redactSecrets — flat secret key is replaced, siblings untouched', () => {
  const out = redactSecrets({ apiKey: 'sk-live-123', name: 'thor', port: 4096 });
  assert.deepEqual(out, { apiKey: '[REDACTED]', name: 'thor', port: 4096 });
});

test('legate-tcg: redactSecrets — descends into non-secret nested objects', () => {
  const out = redactSecrets({
    provider: { anthropic: { apiKey: 'secret-abc', model: 'claude' } },
  });
  assert.deepEqual(out, {
    provider: { anthropic: { apiKey: '[REDACTED]', model: 'claude' } },
  });
});

test('legate-tcg: redactSecrets — key matching is case-insensitive and substring', () => {
  const out = redactSecrets({
    API_KEY: 'a',
    Authorization: 'Bearer x',
    myPassword: 'p',
    Secret_Value: 's',
    accessToken: 't',
  });
  assert.deepEqual(out, {
    API_KEY: '[REDACTED]',
    Authorization: '[REDACTED]',
    myPassword: '[REDACTED]',
    Secret_Value: '[REDACTED]',
    accessToken: '[REDACTED]',
  });
});

test('legate-tcg: redactSecrets — array under a secret key is replaced wholesale (not descended)', () => {
  const out = redactSecrets({ tokens: ['a', 'b', 'c'], items: ['x', 'y'] });
  // secret key → whole array becomes the sentinel string; non-secret array passes through.
  assert.deepEqual(out, { tokens: '[REDACTED]', items: ['x', 'y'] });
});

test('legate-tcg: redactSecrets — nested object under a secret key is replaced wholesale', () => {
  const out = redactSecrets({ credential: { user: 'u', pass: 'p' } });
  assert.deepEqual(out, { credential: '[REDACTED]' });
});

test('legate-tcg: redactSecrets — cycles are handled without throwing', () => {
  const a: Record<string, unknown> = { name: 'root' };
  a.self = a;
  const out = redactSecrets(a) as Record<string, unknown>;
  assert.equal(out.name, 'root');
  assert.equal(out.self, '[REDACTED:cycle]');
});

test('legate-tcg: redactSecrets — non-object inputs pass through', () => {
  assert.equal(redactSecrets('hello'), 'hello');
  assert.equal(redactSecrets(42), 42);
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(undefined), undefined);
  assert.equal(redactSecrets(true), true);
});

test('legate-tcg: redactSecrets — non-secret values are deep-equal and input is NOT mutated', () => {
  const input = {
    name: 'thor',
    nested: { list: [1, 2, { deep: 'value' }], flag: false },
    count: 7,
    apiKey: 'leak-me',
  };
  // Snapshot the input to prove it is not mutated by the walk.
  const snapshot = structuredClone(input);
  const out = redactSecrets(input) as typeof input;

  // Input untouched.
  assert.deepEqual(input, snapshot);
  // Only the secret changed; everything else is byte-identical (deep equal).
  assert.equal(out.apiKey, '[REDACTED]');
  assert.deepEqual(out.name, input.name);
  assert.deepEqual(out.nested, input.nested);
  assert.deepEqual(out.count, input.count);
  // Returned structure is a fresh clone, not the same reference.
  assert.notEqual(out.nested, input.nested);
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end harness (mirrors src/server-e2e.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_ENTRY = resolve(process.cwd(), 'build/index.js');
if (!existsSync(SERVER_ENTRY)) {
  throw new Error(`Build artifact missing: run 'npm run build' first`);
}

interface MockReq {
  method: string;
  path: string;
  body: string;
}
interface MockRes {
  status?: number;
  json?: unknown;
}
interface MockServer {
  port: number;
  log: MockReq[];
  close: () => Promise<void>;
}

function startMock(handler: (req: MockReq) => MockRes): Promise<MockServer> {
  const log: MockReq[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      const entry: MockReq = { method: req.method ?? '', path, body };
      log.push(entry);
      const r = handler(entry);
      const status = r.status ?? 200;
      if (r.json !== undefined) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.json));
      } else {
        res.writeHead(status);
        res.end();
      }
    });
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolvePromise({
        port,
        log,
        close: () =>
          new Promise<void>((r) => {
            (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

interface ToolCallResult {
  text: string;
  isError: boolean;
}

class McpClient {
  private child!: ChildProcess;
  private buf = '';
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private nextId = 1;

  async start(env: NodeJS.ProcessEnv): Promise<void> {
    this.child = spawn(process.execPath, [SERVER_ENTRY], {
      stdio: ['pipe', 'pipe', 'ignore'],
      cwd: process.cwd(),
      env,
    });
    this.child.stdout!.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const id = msg.id as number | undefined;
        if (id !== undefined && this.pending.has(id)) {
          this.pending.get(id)!(msg);
          this.pending.delete(id);
        }
      }
    });
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'legate-tcg-e2e', version: '0' },
    });
    this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }

  private rpc(method: string, params: unknown, timeoutMs = 25_000): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`rpc timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        res(msg);
      });
      this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const resp = await this.rpc('tools/call', { name, arguments: args });
    const result = resp.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
    return { text: result?.content?.[0]?.text ?? '', isError: Boolean(result?.isError) };
  }

  async listToolNames(): Promise<string[]> {
    const resp = await this.rpc('tools/list', {});
    const result = resp.result as { tools?: Array<{ name: string }> } | undefined;
    return (result?.tools ?? []).map((t) => t.name);
  }

  stop(): void {
    if (this.child && !this.child.killed) this.child.kill('SIGKILL');
  }
}

interface Home {
  home: string;
  sessionsPath: string;
}

function makeHome(): Home {
  const home = mkdtempSync(join(tmpdir(), 'legate-tcg-home-'));
  const cfg = join(home, '.config', 'legate');
  mkdirSync(cfg, { recursive: true });
  return { home, sessionsPath: join(cfg, 'sessions.json') };
}

function writeSessions(h: Home, sessions: Record<string, unknown>): void {
  writeFileSync(h.sessionsPath, JSON.stringify({ sessions }, null, 2) + '\n');
}

function childEnv(home: string, serverUrl: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    LEGATE_SERVER_URL: serverUrl,
    LEGATE_TIMEOUT_MS: '30000',
  };
  for (const k of [
    'LEGATE_DEFAULT_PROJECT',
    'PREFECT_DEFAULT_PROJECT',
    'OPENCODE_DEFAULT_PROJECT',
    'LEGATE_SERVER_PASSWORD',
    'PREFECT_SERVER_PASSWORD',
    'OPENCODE_SERVER_PASSWORD',
    'PREFECT_SERVER_URL',
    'OPENCODE_URL',
    'LEGATE_ENABLE_EXEC_TOOLS',
  ])
    delete env[k];
  return { ...env, ...extra };
}

const now = () => Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// Exec-tool gate — legate_session_shell
// ─────────────────────────────────────────────────────────────────────────────

test('legate-tcg: gate — LEGATE_ENABLE_EXEC_TOOLS unset → session_shell isError, no HTTP reaches OpenCode', async () => {
  const mock = await startMock(() => ({ json: {} }));
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, { ses_x: { server: 'mock', url, createdAt: now() } });
    await client.start(childEnv(h.home, url)); // LEGATE_ENABLE_EXEC_TOOLS unset
    const r = await client.callTool('legate_session_shell', { sessionId: 'ses_x', command: 'id', agent: 'general' });
    assert.equal(r.isError, true, `expected disabled isError, got: ${r.text}`);
    assert.ok(r.text.includes('legate_session_shell is disabled'), `should name the tool: ${r.text}`);
    assert.ok(r.text.includes('LEGATE_ENABLE_EXEC_TOOLS=1'), `should give enable instructions: ${r.text}`);
    // Critically: the gate short-circuits before any HTTP — the mock saw nothing.
    assert.equal(mock.log.length, 0, `no HTTP should reach OpenCode; log=${JSON.stringify(mock.log)}`);
    // Contract preserved: 40 tools in disabled mode.
    assert.equal((await client.listToolNames()).length, 40);
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

test('legate-tcg: gate — LEGATE_ENABLE_EXEC_TOOLS=1 → session_shell passes through to OpenCode', async () => {
  const shellResponse = { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'uid=1000' }] };
  const mock = await startMock((req) =>
    req.method === 'POST' && req.path.endsWith('/shell') ? { json: shellResponse } : { json: {} },
  );
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, { ses_x: { server: 'mock', url, createdAt: now() } });
    await client.start(childEnv(h.home, url, { LEGATE_ENABLE_EXEC_TOOLS: '1' }));
    const r = await client.callTool('legate_session_shell', { sessionId: 'ses_x', command: 'id', agent: 'general' });
    assert.equal(r.isError, false, `expected pass-through success, got: ${r.text}`);
    // The call reached the mock's /shell endpoint.
    assert.ok(
      mock.log.some((e) => e.method === 'POST' && e.path === '/session/ses_x/shell'),
      `shell POST should reach OpenCode; log=${JSON.stringify(mock.log.map((l) => l.method + ' ' + l.path))}`,
    );
    // Contract preserved: 40 tools in enabled mode too.
    assert.equal((await client.listToolNames()).length, 40);
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

test('legate-tcg: gate — LEGATE_ENABLE_EXEC_TOOLS unset → inject_mcp_server isError, no HTTP reaches OpenCode', async () => {
  const mock = await startMock(() => ({ json: {} }));
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, {});
    await client.start(childEnv(h.home, url)); // unset
    const r = await client.callTool('legate_inject_mcp_server', {
      name: 'evil',
      configType: 'local',
      commandArgs: ['node', '/tmp/x.js'],
    });
    assert.equal(r.isError, true, `expected disabled isError, got: ${r.text}`);
    assert.ok(r.text.includes('legate_inject_mcp_server is disabled'), `should name the tool: ${r.text}`);
    assert.ok(r.text.includes('LEGATE_ENABLE_EXEC_TOOLS=1'), `should give enable instructions: ${r.text}`);
    assert.equal(mock.log.length, 0, `no HTTP should reach OpenCode; log=${JSON.stringify(mock.log)}`);
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// legate_get_config — server-side redaction end-to-end
// ─────────────────────────────────────────────────────────────────────────────

test('legate-tcg: get_config — apiKey in the OpenCode config is redacted before returning', async () => {
  const secret = 'sk-super-secret-value-9999';
  const mock = await startMock((req) =>
    req.method === 'GET' && req.path === '/config'
      ? { json: { provider: { anthropic: { apiKey: secret, model: 'claude' } }, theme: 'dark' } }
      : { json: {} },
  );
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, {});
    await client.start(childEnv(h.home, url));
    const r = await client.callTool('legate_get_config', {});
    assert.equal(r.isError, false, `expected success, got: ${r.text}`);
    assert.ok(r.text.includes('[REDACTED]'), `response should carry the redaction sentinel: ${r.text}`);
    assert.ok(!r.text.includes(secret), `raw secret must NOT appear in the response: ${r.text}`);
    // Non-secret fields survive.
    assert.ok(r.text.includes('claude') && r.text.includes('dark'), `non-secret fields should pass through: ${r.text}`);
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});
