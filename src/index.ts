#!/usr/bin/env node
// legate-hry: composition root for the Legate MCP server.
//
// This file used to be ~1900 lines — tool registration, 11 bespoke handler bodies,
// response envelopes, the client cache, env resolution, the exec-tool gate, AND a
// module-load main() that connected stdio the instant the file was imported. That made
// it un-importable by tests (importing it started a server) and impossible to review.
//
// The refactor split it into:
//   - src/server-context.ts   — shared state + helpers + registration wrappers
//   - src/tools/core.ts       — create_session, abort, run, prompt_async, get_diff, approve_permission, fork, revert
//   - src/tools/composites.ts — delegate, dispatch, inspect, await
//   - src/tools/session.ts     — session_* wrappers + session_status + session_init
//   - src/tools/discovery.ts   — list_*/find_*/get_*/file_status/vcs_info/config/inject/session_shell
//   - src/startup.ts          — runStartupMigrations() (explicit, no longer a module-load side effect)
//
// What remains here: build the McpServer, compose the four registration modules, and
// gate main() so importing this module is SIDE-EFFECT FREE — no server, no migrations,
// no stdio — until it is the process entry point (or createServer() is called by a test).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServerContext, type ServerContext } from './server-context.js';
import { registerCore } from './tools/core.js';
import { registerComposites } from './tools/composites.js';
import { registerSession } from './tools/session.js';
import { registerDiscovery } from './tools/discovery.js';
import { runStartupMigrations } from './startup.js';

const packageVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

// legate-hry: build a fully-registered server plus its context. createServer() below
// exposes only the McpServer for tests; main() also needs ctx for the startup banner.
function buildServer(): { server: McpServer; ctx: ServerContext } {
  const server = new McpServer({ name: 'legate', version: packageVersion });
  const ctx = createServerContext(server);
  registerCore(server, ctx);
  registerComposites(server, ctx);
  registerSession(server, ctx);
  registerDiscovery(server, ctx);
  return { server, ctx };
}

/**
 * legate-hry: construct a fully-registered Legate McpServer without connecting any
 * transport or running migrations. Pure and side-effect free — tests import this to
 * introspect the 40-tool contract without spawning a subprocess.
 */
export function createServer(): McpServer {
  return buildServer().server;
}

// legate-hry: is this module the process entry point? The primary check is the exact
// `import.meta.url === pathToFileURL(process.argv[1]).href` comparison. The realpath
// fallback preserves behavior for the symlinked global `legate-mcp` bin, where argv[1]
// is the symlink path while import.meta.url is its realpath (the old unconditional
// main() ran in that case too, so skipping it would be a regression).
function isMainModule(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  if (import.meta.url === pathToFileURL(argv1).href) return true;
  try {
    return realpathSync(argv1) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // legate-hry: migrations run explicitly at startup, before the server connects and
  // therefore before any tool call reads sessions.json/servers.json.
  runStartupMigrations();
  const { server, ctx } = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — never stdout (corrupts JSON-RPC stream)
  console.error(`Legate MCP server running (OpenCode: ${ctx.BASE_URL})`);
}

// legate-hry: only run the server when this file is the entry point. Importing it
// (tests, tooling) constructs nothing and touches no I/O.
if (isMainModule()) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
