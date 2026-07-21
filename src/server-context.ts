// legate-hry: shared server context for the tool-registration modules.
//
// This is the structural spine of the index.ts split. Everything that the 40 tool
// handlers used to close over as module-level state in index.ts now lives here as an
// explicit, importable ServerContext object: the per-URL client cache, BASE_URL /
// TIMEOUT_MS env resolution, the resolveServerUrl fallback wrapper, the response-
// envelope helpers, the exec-tool gate helpers, the stale-session text/handlers, and
// the two shared registration wrappers. createServer() (index.ts) builds one context
// and threads it through each registerX(server, ctx) module.
//
// Importing this module is SIDE-EFFECT FREE — no McpServer is constructed, no env is
// read, no migrations run — until createServerContext() is called. That is what lets
// the source-parsing tests import the tool modules without spawning a server.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { fetchWithAuth } from './fetch.js';
import { resolveDirectory } from './config.js';
// legate-dxw: typed SDK errors. isNotFound re-exported from errors.ts.
import { apiError, isNotFound } from './errors.js';
// legate-lcg: env chain + warn-once bookkeeping lives in env.ts.
import { resolveEnv, resolveEnvInt } from './env.js';
import { lookupSession, removeSession } from './sessions.js';
import { readRegistry } from './registry.js';
// legate-e1i: D-06/D-07 fallback chain lives in routing.ts (unit-testable). The
// context's resolveServerUrl wrapper binds BASE_URL so all call sites stay unchanged.
import { resolveServerUrl as resolveServerUrlImpl } from './routing.js';

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
export type OpencodeClient = ReturnType<typeof createOpencodeClient>;

// legate-epe: the two shared registration wrappers are generic over the tool's Zod
// schema. Their signatures are surfaced on the context so tool modules can destructure
// them (`const { registerSessionTool } = ctx`) without losing binding — they are arrow
// properties, already bound to the server passed to createServerContext.
export interface ServerContext {
  // CORE-08: base URL (LEGATE_SERVER_URL, with deprecated PREFECT_/OPENCODE_ fallbacks).
  readonly BASE_URL: string;
  // legate-lcg: run/await/delegate/session_init timeout (LEGATE_TIMEOUT_MS + fallbacks).
  readonly TIMEOUT_MS: number;

  // D-01..D-03: per-URL client cache.
  getClient(serverUrl: string): OpencodeClient;
  // D-06/D-07: server URL resolution fallback chain (BASE_URL bound in).
  resolveServerUrl(sessionId?: string, serverName?: string): string;
  // D-08: canonical registry name for a URL (entry points write name + URL).
  serverNameForUrl(serverUrl: string, serverParam?: string): string;

  // legate-epe: response-envelope helpers — ONE definition of each content shape.
  okJson(value: unknown): ToolResult;
  okText(text: string): ToolResult;
  errText(err: unknown): ToolResult;

  // legate-tcg: exec-tool opt-in gate helpers.
  execToolsEnabled(): boolean;
  execDisabledMessage(toolName: string, whatItDoes: string): string;

  // legate-epe / D-12: the ONE definition of the stale-session error text + handlers.
  staleSessionMessage(sessionId: string, serverName: string, url: string): string;
  handleNotFound(error: unknown, sessionId: string, serverUrl: string): never;
  staleErrorResponse(sessionId: string): ToolResult;

  // legate-epe: shared registration wrappers (bound to the server).
  registerSessionTool<S extends z.ZodTypeAny>(
    name: string,
    config: { description: string; inputSchema: S },
    handler: (ctx: {
      client: OpencodeClient;
      serverUrl: string;
      dir: string | undefined;
      args: z.infer<S> & { sessionId: string; directory?: string };
    }) => Promise<unknown>,
    options?: { gate?: () => string | null },
  ): void;
  registerServerTool<S extends z.ZodTypeAny>(
    name: string,
    config: { description: string; inputSchema: S },
    handler: (ctx: {
      client: OpencodeClient;
      serverUrl: string;
      dir: string | undefined;
      args: z.infer<S> & { directory?: string };
    }) => Promise<unknown>,
    options?: { gate?: () => string | null },
  ): void;
}

/**
 * legate-hry: build the shared context for one McpServer. All env reads happen here
 * (at createServer() time), not at module import — so importing the tool modules is
 * side-effect free. Behavior is byte-identical to the old module-level state in
 * index.ts; only its home changed.
 */
export function createServerContext(server: McpServer): ServerContext {
  // CORE-08: Base URL from LEGATE_SERVER_URL env var (LEGATE_SERVER_URL and OPENCODE_URL
  // accepted with deprecation warnings). quietEmptyWarn preserves original behavior: an
  // empty PREFECT_/OPENCODE_ fallback value still wins the `??` chain, but does not warn.
  const BASE_URL =
    resolveEnv(['LEGATE_SERVER_URL', 'PREFECT_SERVER_URL', 'OPENCODE_URL'], { quietEmptyWarn: true }) ??
    'http://localhost:4096';

  // legate-lcg: requireTruthy preserves the original `if (legateVal)` gate — an empty
  // LEGATE_TIMEOUT_MS falls through to PREFECT_TIMEOUT_MS silently rather than winning.
  // resolveEnvInt also adds NaN/<=0 validation that the old `parseInt(v, 10) || 120_000`
  // pattern silently lacked (0 or negative previously resolved with no warning at all).
  const TIMEOUT_MS = resolveEnvInt(
    ['LEGATE_TIMEOUT_MS', 'PREFECT_TIMEOUT_MS', 'OPENCODE_TIMEOUT_MS'],
    120_000,
    { requireTruthy: true },
  );

  // D-01..D-03: per-URL client cache. Replaces the single global client so the
  // MCP server can route tool calls to multiple OpenCode instances.
  const clientCache = new Map<string, OpencodeClient>();

  function getClient(serverUrl: string): OpencodeClient {
    let c = clientCache.get(serverUrl);
    if (!c) {
      c = createOpencodeClient({ baseUrl: serverUrl, fetch: fetchWithAuth });
      clientCache.set(serverUrl, c);
    }
    return c;
  }

  // D-06: server URL resolution fallback chain.
  //   1. sessionId → sessions.json lookup → that session's server URL
  //   2. serverName (entry points only) → registry lookup by name
  //   3. no inputs → first entry in registry
  //   4. registry empty → BASE_URL (LEGATE_SERVER_URL env var)
  // D-07: unknown serverName throws with the exact message from routing.ts.
  // legate-e1i: implementation lives in routing.ts; this wrapper binds BASE_URL.
  function resolveServerUrl(sessionId?: string, serverName?: string): string {
    return resolveServerUrlImpl(sessionId, serverName, BASE_URL);
  }

  // Resolve the canonical server name for a URL — used by entry points to write
  // sessions.json with both name and URL (D-08). Falls back to the supplied
  // serverParam (entry point's optional input) or the literal 'default' when
  // no registry match exists (registry-empty fallback path).
  function serverNameForUrl(serverUrl: string, serverParam?: string): string {
    if (serverParam) return serverParam;
    const reg = readRegistry();
    const found = reg.servers.find((s) => `http://${s.host}:${s.port}` === serverUrl);
    return found?.name ?? 'default';
  }

  // legate-epe: response-envelope helpers — ONE definition of each content shape.
  function okJson(value: unknown): ToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }
  function okText(text: string): ToolResult {
    return { content: [{ type: 'text', text }] };
  }
  function errText(err: unknown): ToolResult {
    return { content: [{ type: 'text', text: String(err) }], isError: true };
  }

  // legate-tcg: opt-in gate for the exec-capable tools (legate_session_shell,
  // legate_inject_mcp_server). These are prompt-injection-mediated RCE primitives —
  // shell runs arbitrary commands on the OpenCode host; inject registers a command
  // the host will spawn. They still REGISTER unconditionally (the 40-tool contract
  // and the smoke test depend on it), but their handlers refuse to act unless the
  // operator has explicitly opted in via LEGATE_ENABLE_EXEC_TOOLS. Read at CALL time
  // (not module init) so tests and .mcp.json env changes take effect without a
  // rebuild — consistent with the codebase's other env reads.
  function execToolsEnabled(): boolean {
    const v = process.env.LEGATE_ENABLE_EXEC_TOOLS;
    return v === '1' || v?.toLowerCase() === 'true';
  }

  // legate-tcg: the disabled-tool message. `whatItDoes` completes "This tool ..." so
  // each tool names its own hazard while sharing the enable instructions verbatim.
  function execDisabledMessage(toolName: string, whatItDoes: string): string {
    return (
      `${toolName} is disabled. This tool ${whatItDoes}. ` +
      `Set LEGATE_ENABLE_EXEC_TOOLS=1 in the legate MCP server's environment ` +
      `(.mcp.json env block or shell profile) and restart to enable.`
    );
  }

  // legate-epe / D-12: the ONE definition of the stale-session error text. Every
  // tool that discovers a session 404 surfaces exactly this message. serverName is
  // the registry name (typically entry?.server ?? 'unknown'); url is the server URL
  // the failing call was routed to.
  function staleSessionMessage(sessionId: string, serverName: string, url: string): string {
    return (
      `Session ${sessionId} not found on server '${serverName}' (${url}).\n` +
      `The session may have been deleted or the server restarted.\n` +
      `Call legate_session_list to see active sessions, or legate_create_session to start a new one.`
    );
  }

  // legate-epe / D-12: pre-throw 404 handler for SDK { data, error } results. On a
  // 404 it removes the now-stale session from sessions.json and throws the canonical
  // stale-session Error; any other API error is rethrown as a typed OpenCodeApiError.
  // Declared `never` so callers narrow `data` after `if (error) handleNotFound(...)`.
  // legate-dxw: typed 404 check (isNotFound) replaces the old JSON string-matching.
  function handleNotFound(error: unknown, sessionId: string, serverUrl: string): never {
    if (isNotFound(error)) {
      const entry = lookupSession(sessionId);
      removeSession(sessionId);
      throw new Error(staleSessionMessage(sessionId, entry?.server ?? 'unknown', serverUrl));
    }
    throw apiError(error);
  }

  // legate-epe / D-12: post-catch 404 handler for the composite tools (legate_run,
  // legate_get_diff, legate_await) whose helpers throw OpenCodeApiError from deep in
  // handlers.ts. Mirrors handleNotFound but returns an isError envelope instead of
  // throwing, recovering the stale URL from the (already-removed) session entry and
  // falling back to resolveServerUrl() exactly as the original inline copies did.
  function staleErrorResponse(sessionId: string): ToolResult {
    const entry = lookupSession(sessionId);
    removeSession(sessionId);
    const staleUrl = entry?.url ?? resolveServerUrl();
    return {
      content: [{ type: 'text', text: staleSessionMessage(sessionId, entry?.server ?? 'unknown', staleUrl) }],
      isError: true,
    };
  }

  // legate-epe: registration wrapper for the simple session-scoped tools. Resolves
  // directory + server URL (from sessionId) + client, runs the handler, and JSON-
  // stringifies its return into the content envelope. The handler calls
  // handleNotFound(error, sessionId, serverUrl) on SDK errors; any thrown value
  // (the stale-session Error included) becomes a String(err) isError response —
  // byte-identical to the old per-handler catch blocks.
  const registerSessionTool: ServerContext['registerSessionTool'] = (name, config, handler, options) => {
    // legate-epe: the callback is cast because McpServer.registerTool's ToolCallback
    // is a deferred conditional type over the (here-generic) schema S; TS cannot prove
    // a concrete callback assignable to it inside a generic wrapper. Runtime shape is
    // unchanged — the SDK still validates args against `config.inputSchema`.
    const cb = async (rawArgs: unknown): Promise<ToolResult> => {
      // legate-tcg: gate check happens first — before resolveDirectory / resolveServerUrl /
      // getClient / any HTTP — so a disabled tool never touches the OpenCode host.
      const gateMsg = options?.gate?.();
      if (gateMsg) return { content: [{ type: 'text', text: gateMsg }], isError: true };
      const args = rawArgs as z.infer<typeof config.inputSchema> & { sessionId: string; directory?: string };
      const dir = resolveDirectory(args.directory);
      try {
        const serverUrl = resolveServerUrl(args.sessionId);
        const client = getClient(serverUrl);
        const result = await handler({ client, serverUrl, dir, args });
        return okJson(result);
      } catch (err) {
        return errText(err);
      }
    };
    server.registerTool(name, config, cb as never);
  };

  // legate-epe: registration wrapper for the server-scoped tools (no sessionId).
  // Resolves directory + default/first server URL + client, runs the handler, and
  // JSON-stringifies the return. Server tools have no session to invalidate, so
  // there is no stale-session handling — API errors surface as String(err).
  const registerServerTool: ServerContext['registerServerTool'] = (name, config, handler, options) => {
    // legate-epe: callback cast — see registerSessionTool for the rationale.
    const cb = async (rawArgs: unknown): Promise<ToolResult> => {
      // legate-tcg: gate check first — refuse before any HTTP work (see registerSessionTool).
      const gateMsg = options?.gate?.();
      if (gateMsg) return { content: [{ type: 'text', text: gateMsg }], isError: true };
      const args = rawArgs as z.infer<typeof config.inputSchema> & { directory?: string };
      const dir = resolveDirectory(args.directory);
      try {
        const serverUrl = resolveServerUrl();
        const client = getClient(serverUrl);
        const result = await handler({ client, serverUrl, dir, args });
        return okJson(result);
      } catch (err) {
        return errText(err);
      }
    };
    server.registerTool(name, config, cb as never);
  };

  return {
    BASE_URL,
    TIMEOUT_MS,
    getClient,
    resolveServerUrl,
    serverNameForUrl,
    okJson,
    okText,
    errText,
    execToolsEnabled,
    execDisabledMessage,
    staleSessionMessage,
    handleNotFound,
    staleErrorResponse,
    registerSessionTool,
    registerServerTool,
  };
}
