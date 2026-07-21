import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// legate-e1i: behavioral end-to-end coverage for the routing / timeout / fallback logic
// that lives in src/index.ts tool handlers (abort fan-out, delegate timeout, await
// poll loop + stale-busy escape, and stale-session cleanup).
//
// Approach (b): drive the BUILT server (build/index.js) over MCP stdio, exactly like
// mcp-smoke.test.ts, with a mock OpenCode HTTP server (node:http on an ephemeral port)
// behind it via LEGATE_SERVER_URL. Fully hermetic:
//   - HOME/USERPROFILE are pointed at a fresh temp dir so sessions.json (routing input)
//     and servers.json (registry) resolve into temp — the real ~/.config/legate is never
//     read or written. (os.homedir() honors $HOME on POSIX / %USERPROFILE% on Windows.)
//   - The only network is 127.0.0.1 to the mock. The mock is always listening before the
//     child spawns, so fetchWithAuth never hits ECONNREFUSED and never triggers autostart.

const SERVER_ENTRY = resolve(process.cwd(), 'build/index.js');
if (!existsSync(SERVER_ENTRY)) {
  throw new Error(`Build artifact missing: run 'npm run build' first`);
}

// ── Mock OpenCode HTTP server ───────────────────────────────────────────────
interface MockReq {
  method: string;
  path: string;
  body: string;
}
interface MockRes {
  status?: number;
  json?: unknown;
  hang?: boolean;
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
      if (r.hang) return; // deliberately never respond — exercises the timeout path
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
            // Destroy any lingering (aborted / hung) sockets so close() resolves promptly.
            (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

// ── Minimal MCP stdio client ────────────────────────────────────────────────
interface ToolResult {
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
      clientInfo: { name: 'legate-e1i-e2e', version: '0' },
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

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const resp = await this.rpc('tools/call', { name, arguments: args });
    const result = resp.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
    return { text: result?.content?.[0]?.text ?? '', isError: Boolean(result?.isError) };
  }

  stop(): void {
    if (this.child && !this.child.killed) this.child.kill('SIGKILL');
  }
}

// ── Temp HOME + child env helpers ───────────────────────────────────────────
interface Home {
  home: string;
  sessionsPath: string;
  serversPath: string;
}

function makeHome(): Home {
  const home = mkdtempSync(join(tmpdir(), 'legate-home-'));
  const cfg = join(home, '.config', 'legate');
  mkdirSync(cfg, { recursive: true });
  return { home, sessionsPath: join(cfg, 'sessions.json'), serversPath: join(cfg, 'servers.json') };
}

function writeSessions(h: Home, sessions: Record<string, unknown>): void {
  writeFileSync(h.sessionsPath, JSON.stringify({ sessions }, null, 2) + '\n');
}
function writeServers(h: Home, servers: unknown[]): void {
  writeFileSync(h.serversPath, JSON.stringify({ servers }, null, 2) + '\n');
}

function childEnv(home: string, serverUrl: string, timeoutMs: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    LEGATE_SERVER_URL: serverUrl,
    LEGATE_TIMEOUT_MS: String(timeoutMs),
  };
  // Strip anything that could make routing / directory / auth host-dependent.
  for (const k of [
    'LEGATE_DEFAULT_PROJECT',
    'PREFECT_DEFAULT_PROJECT',
    'OPENCODE_DEFAULT_PROJECT',
    'LEGATE_SERVER_PASSWORD',
    'PREFECT_SERVER_PASSWORD',
    'OPENCODE_SERVER_PASSWORD',
    'PREFECT_SERVER_URL',
    'OPENCODE_URL',
  ])
    delete env[k];
  return env;
}

const now = () => Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// legate_abort — zombie fan-out
// ─────────────────────────────────────────────────────────────────────────────

test('legate-e1i: legate_abort — session in sessions.json aborts on its known server', async () => {
  const mock = await startMock((req) =>
    req.method === 'POST' && req.path.endsWith('/abort') ? { json: true } : { json: {} },
  );
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, { ses_known: { server: 'mock', url, createdAt: now() } });
    await client.start(childEnv(h.home, url, 30_000));
    const r = await client.callTool('legate_abort', { sessionId: 'ses_known' });
    assert.equal(r.isError, false, `expected success, got: ${r.text}`);
    assert.equal(r.text, 'true');
    assert.ok(
      mock.log.some((e) => e.method === 'POST' && e.path === '/session/ses_known/abort'),
      `abort should have hit the known server; log=${JSON.stringify(mock.log)}`,
    );
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

test('legate-e1i: legate_abort — unknown session fans out; a registered server returning 200 succeeds and is named', async () => {
  const mock = await startMock((req) =>
    req.method === 'POST' && req.path.endsWith('/abort') ? { json: true } : { json: {} },
  );
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, {}); // session unknown locally → zombie fallback
    writeServers(h, [{ name: 'mocksrv', host: '127.0.0.1', port: mock.port, providerID: '', modelID: '' }]);
    await client.start(childEnv(h.home, url, 30_000));
    const r = await client.callTool('legate_abort', { sessionId: 'ses_zombie' });
    assert.equal(r.isError, false, `expected success, got: ${r.text}`);
    assert.ok(r.text.includes("on server 'mocksrv'"), `success message should name the server: ${r.text}`);
    assert.ok(r.text.includes('ses_zombie'), `success message should name the session: ${r.text}`);
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

test('legate-e1i: legate_abort — unknown session, all registered servers 404, errors listing every miss', async () => {
  const notFound = { status: 404, json: { name: 'NotFoundError', message: 'no such session' } };
  const mock1 = await startMock(() => notFound);
  const mock2 = await startMock(() => notFound);
  const h = makeHome();
  const client = new McpClient();
  try {
    writeSessions(h, {});
    writeServers(h, [
      { name: 'srvA', host: '127.0.0.1', port: mock1.port, providerID: '', modelID: '' },
      { name: 'srvB', host: '127.0.0.1', port: mock2.port, providerID: '', modelID: '' },
    ]);
    await client.start(childEnv(h.home, `http://127.0.0.1:${mock1.port}`, 30_000));
    const r = await client.callTool('legate_abort', { sessionId: 'ses_zombie' });
    assert.equal(r.isError, true, `expected error, got success: ${r.text}`);
    assert.ok(r.text.includes('abort failed on all tried servers'), `should report total failure: ${r.text}`);
    assert.ok(r.text.includes('srvA'), `miss list should include srvA: ${r.text}`);
    assert.ok(r.text.includes('srvB'), `miss list should include srvB: ${r.text}`);
  } finally {
    client.stop();
    await mock1.close();
    await mock2.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// legate_await — poll loop, timeout, and stale-busy escape (legate-tia)
// ─────────────────────────────────────────────────────────────────────────────

const completedAssistantMsg = [
  {
    info: { role: 'assistant', time: { created: 1, completed: 2 } },
    parts: [{ type: 'text', text: 'done' }],
  },
];
const inProgressAssistantMsg = [
  {
    info: { role: 'assistant', time: { created: 1 } }, // NO completed → still generating
    parts: [],
  },
];

function awaitHandler(statusBody: unknown, messages: unknown): (req: MockReq) => MockRes {
  return (req) => {
    if (req.path === '/session/status') return { json: statusBody };
    if (req.path.endsWith('/message')) return { json: messages };
    if (req.path.endsWith('/diff')) return { json: [] };
    return { json: {} };
  };
}

test('legate-e1i: legate_await — session reaches idle and returns { result, diff }', async () => {
  // Empty status map ⇒ session absent ⇒ treated as idle ⇒ break on first poll.
  const mock = await startMock(awaitHandler({}, completedAssistantMsg));
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, { ses_idle: { server: 'mock', url, createdAt: now() } });
    await client.start(childEnv(h.home, url, 30_000));
    const r = await client.callTool('legate_await', { sessionId: 'ses_idle', pollIntervalMs: 10, timeoutMs: 5000 });
    assert.equal(r.isError, false, `expected success, got: ${r.text}`);
    const payload = JSON.parse(r.text) as { result: { info: { role: string } }; diff: unknown[] };
    assert.equal(payload.result.info.role, 'assistant');
    assert.deepEqual(payload.diff, []);
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

test('legate-e1i: legate_await — stays busy past timeoutMs → isError with sessionId in payload', async () => {
  const mock = await startMock(awaitHandler({ ses_busy: { type: 'busy' } }, [])); // never idle, no messages
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, { ses_busy: { server: 'mock', url, createdAt: now() } });
    await client.start(childEnv(h.home, url, 30_000));
    const r = await client.callTool('legate_await', { sessionId: 'ses_busy', pollIntervalMs: 10, timeoutMs: 200 });
    assert.equal(r.isError, true, `expected timeout error, got: ${r.text}`);
    const payload = JSON.parse(r.text) as { error: string; sessionId: string };
    assert.ok(payload.error.includes('timed out'), `error should mention timeout: ${r.text}`);
    assert.equal(payload.sessionId, 'ses_busy');
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

test('legate-e1i: legate_await — stale-busy escape does NOT fire for an in-progress (no time.completed) last message', async () => {
  // Status is perpetually busy and the last assistant message has NO time.completed.
  // The legate-tia fix means the escape must NOT trigger, so the call must TIME OUT
  // rather than return a (premature/empty) result.
  const mock = await startMock(awaitHandler({ ses_prog: { type: 'busy' } }, inProgressAssistantMsg));
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, { ses_prog: { server: 'mock', url, createdAt: now() } });
    await client.start(childEnv(h.home, url, 30_000));
    const r = await client.callTool('legate_await', { sessionId: 'ses_prog', pollIntervalMs: 10, timeoutMs: 300 });
    assert.equal(r.isError, true, `in-progress message must NOT break the loop; expected timeout, got: ${r.text}`);
    const payload = JSON.parse(r.text) as { error: string; sessionId: string };
    assert.ok(payload.error.includes('timed out'));
    assert.equal(payload.sessionId, 'ses_prog');
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

test('legate-e1i: legate_await — stale-busy escape DOES fire for a completed last message (breaks and returns result)', async () => {
  // Status is perpetually busy, but the last assistant message HAS time.completed.
  // The escape must break the loop and return the result — well before the large timeout.
  const mock = await startMock(awaitHandler({ ses_done: { type: 'busy' } }, completedAssistantMsg));
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, { ses_done: { server: 'mock', url, createdAt: now() } });
    await client.start(childEnv(h.home, url, 30_000));
    // Large timeout: if the escape did not fire, this would hang until rpc timeout, not pass.
    const r = await client.callTool('legate_await', { sessionId: 'ses_done', pollIntervalMs: 10, timeoutMs: 20_000 });
    assert.equal(r.isError, false, `stale-busy escape should return a result, got: ${r.text}`);
    const payload = JSON.parse(r.text) as { result: { info: { role: string } } };
    assert.equal(payload.result.info.role, 'assistant');
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// legate_delegate — timeout path + reuse early return
// ─────────────────────────────────────────────────────────────────────────────

test('legate-e1i: legate_delegate (reuse) — prompt never responds → timeout error, and abort is sent to the server', async () => {
  const mock = await startMock((req) => {
    if (req.method === 'POST' && req.path.endsWith('/message')) return { hang: true }; // never responds
    if (req.method === 'POST' && req.path.endsWith('/abort')) return { json: true };
    return { json: {} };
  });
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, { ses_reuse: { server: 'mock', url, createdAt: now() } });
    await client.start(childEnv(h.home, url, 1200)); // short LEGATE_TIMEOUT_MS
    const r = await client.callTool('legate_delegate', { sessionId: 'ses_reuse', prompt: 'do it' });
    assert.equal(r.isError, true, `expected timeout error, got: ${r.text}`);
    assert.ok(r.text.includes('timed out'), `should be a timeout message: ${r.text}`);
    assert.ok(r.text.includes('ses_reuse'), `should name the session: ${r.text}`);
    // The handler must abort the in-flight run on timeout.
    assert.ok(
      mock.log.some((e) => e.method === 'POST' && e.path === '/session/ses_reuse/abort'),
      `abort should have been sent to the mock; log=${JSON.stringify(mock.log.map((l) => l.method + ' ' + l.path))}`,
    );
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

test('legate-e1i: legate_delegate (reuse) — unknown session returns the "not found in sessions registry" early error', async () => {
  const mock = await startMock(() => ({ json: {} }));
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, {}); // empty — reuse target does not exist
    await client.start(childEnv(h.home, url, 30_000));
    const r = await client.callTool('legate_delegate', { sessionId: 'ses_absent', prompt: 'x' });
    assert.equal(r.isError, true, `expected error, got: ${r.text}`);
    assert.ok(r.text.includes('not found in sessions registry'), `should be the early-return message: ${r.text}`);
    // Early return happens before any HTTP call to the session.
    assert.equal(mock.log.length, 0, `no HTTP should be issued; log=${JSON.stringify(mock.log)}`);
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stale-session cleanup — 404 from the SDK surfaces the canonical text
// ─────────────────────────────────────────────────────────────────────────────

test('legate-e1i: stale session — a 404 on a session tool surfaces the canonical "not found on server" message', async () => {
  const mock = await startMock((req) =>
    req.method === 'GET' && req.path === '/session/ses_stale'
      ? { status: 404, json: { name: 'NotFoundError', message: 'gone' } }
      : { json: {} },
  );
  const h = makeHome();
  const client = new McpClient();
  try {
    const url = `http://127.0.0.1:${mock.port}`;
    writeSessions(h, { ses_stale: { server: 'mocksrv', url, createdAt: now() } });
    await client.start(childEnv(h.home, url, 30_000));
    const r = await client.callTool('legate_session_get', { sessionId: 'ses_stale' });
    assert.equal(r.isError, true, `expected stale-session error, got: ${r.text}`);
    assert.ok(r.text.includes('not found on server'), `should be the canonical stale text: ${r.text}`);
    assert.ok(r.text.includes("'mocksrv'"), `should name the server from the (temp) session entry: ${r.text}`);
  } finally {
    client.stop();
    await mock.close();
    rmSync(h.home, { recursive: true, force: true });
  }
});
