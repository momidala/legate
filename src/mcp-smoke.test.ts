import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// legate-epe: end-to-end smoke test for the registration refactor.
//
// The refactor moved ~29 of the 40 tools behind registerSessionTool/registerServerTool
// wrappers. This test speaks minimal MCP over stdio to the *built* server (build/index.js)
// and asserts that the tools the server actually advertises (tools/list) are exactly the
// tools declared in source. That closes the loop the source-parsing test in
// index.test.ts cannot: it proves the wrappers really register every tool at runtime,
// with no drift between what the source declares and what the server exposes.
//
// legate-hry: after the index.ts split, the tool declarations live across the four
// src/tools/*.ts modules, so this scans that directory rather than index.ts.
//
// It is hermetic — tools/list requires no live OpenCode server, so nothing external is
// needed and the test does not touch the network.

const TOOLS_DIR = resolve(process.cwd(), 'src/tools');
const SERVER_ENTRY = resolve(process.cwd(), 'build/index.js');

// Same registration-site grammar as index.test.ts: the three call forms, each followed
// by the tool-name string literal. Wrapper *definitions* pass the `name` identifier
// (no quote after the paren) and are excluded.
const TOOL_REGISTRATION = /(?:server\.registerTool|registerSessionTool|registerServerTool)\(\s*\n?\s*'([^']+)'/g;

function declaredToolNames(): string[] {
  const src = readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(TOOLS_DIR, f), 'utf8'))
    .join('\n');
  const names: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TOOL_REGISTRATION.source, 'g');
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names.sort();
}

// Speak just enough MCP over stdio: initialize handshake, initialized notification,
// then tools/list. Resolves with the advertised tool names.
function listToolsOverStdio(): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      stdio: ['pipe', 'pipe', 'ignore'],
      cwd: process.cwd(),
    });
    const guard = setTimeout(() => {
      child.kill();
      reject(new Error('mcp-smoke: timed out waiting for tools/list response'));
    }, 15_000);

    let buf = '';
    const pending = new Map<number, (msg: Record<string, unknown>) => void>();
    child.on('error', (err) => { clearTimeout(guard); reject(err); });
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        const id = msg.id as number | undefined;
        if (id !== undefined && pending.has(id)) { pending.get(id)!(msg); pending.delete(id); }
      }
    });

    const rpc = (id: number, method: string, params: unknown): Promise<Record<string, unknown>> =>
      new Promise((res) => {
        pending.set(id, res);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });

    (async () => {
      await rpc(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-smoke', version: '0' },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const resp = await rpc(2, 'tools/list', {});
      const result = resp.result as { tools?: Array<{ name: string }> } | undefined;
      const names = (result?.tools ?? []).map((t) => t.name).sort();
      clearTimeout(guard);
      child.kill();
      resolvePromise(names);
    })().catch((err) => { clearTimeout(guard); child.kill(); reject(err); });
  });
}

test('mcp-smoke: server advertises exactly the tools declared in src/index.ts', async () => {
  const declared = declaredToolNames();
  const advertised = await listToolsOverStdio();
  assert.deepEqual(
    advertised,
    declared,
    `Runtime tools/list must match the tools declared in source.\n` +
    `declared (${declared.length}): ${JSON.stringify(declared)}\n` +
    `advertised (${advertised.length}): ${JSON.stringify(advertised)}`,
  );
  // Belt-and-suspenders: every advertised name is legate_ and none is prefect_.
  assert.ok(advertised.every((n) => n.startsWith('legate_')), 'every advertised tool must start with legate_');
  assert.equal(advertised.filter((n) => n.startsWith('prefect_')).length, 0, 'no prefect_ tools may be advertised');
});
