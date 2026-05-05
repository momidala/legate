import { authFetch } from './auth.js';
import { ensureOpencodeRunning } from './autostart.js';
import { readRegistry, type ServerEntry } from './registry.js';

// Node.js fetch wraps ECONNREFUSED in err.cause, not in the top-level message.
// String(err) === "TypeError: fetch failed" — no ECONNREFUSED there.
// String(err.cause) === "Error: connect ECONNREFUSED ..." — that's where to look.
function isConnRefused(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const cause = (err as { cause?: unknown }).cause;
  const causeCode = (cause as { code?: string } | undefined)?.code;
  return (
    causeCode === 'ECONNREFUSED' ||
    String(err).includes('ECONNREFUSED') ||
    String(cause).includes('ECONNREFUSED')
  );
}

/**
 * Resolve which ServerEntry matches an inbound request URL.
 * Strategy (Pitfall 1 / Option 1 from Phase 14 RESEARCH.md):
 *   1. Read the registry; find the entry whose host AND port match the request URL.
 *   2. If no match, synthesize a minimal ServerEntry from the URL itself so
 *      ensureOpencodeRunning still has the host/port it needs (default port 4096).
 * The synthesized fallback name is the hostname — used only in error messages.
 */
function resolveServerFromRequest(request: Request): ServerEntry {
  const requestUrl = new URL(request.url);
  const reg = readRegistry();
  const matched = reg.servers.find(
    (s) => s.host === requestUrl.hostname && String(s.port) === requestUrl.port,
  );
  if (matched) return matched;
  return {
    name: requestUrl.hostname,
    host: requestUrl.hostname,
    port: parseInt(requestUrl.port || '4096', 10),
    providerID: '',
    modelID: '',
  };
}

const _warnedRemoteHosts = new Set<string>();

/**
 * Authenticated fetch wrapper with auto-start.
 * Every outbound OpenCode SDK request flows through this function via the
 * Config.fetch hook, so auth injection and auto-start are handled uniformly
 * for all 40 tools — no per-tool wiring required.
 *
 * On ECONNREFUSED: resolves the target ServerEntry from the request URL
 * (Pitfall 1 / Option 1), spawns 'opencode serve' on that server's port via
 * ensureOpencodeRunning(server), then retries the request once with auth headers.
 *
 * The retry uses request.clone() because POST bodies are marked consumed on any
 * send — even a refused connection — so the retry needs a fresh body stream.
 */
export async function fetchWithAuth(request: Request): Promise<Response> {
  const retry = request.clone();
  const reqUrl = new URL(request.url);
  if (reqUrl.protocol === 'http:' && reqUrl.hostname !== 'localhost' && reqUrl.hostname !== '127.0.0.1') {
    if (!_warnedRemoteHosts.has(reqUrl.hostname)) {
      _warnedRemoteHosts.add(reqUrl.hostname);
      console.error(`[Prefect] Warning: routing requests to '${reqUrl.hostname}' over plain HTTP — credentials will be sent in cleartext. Use an SSH tunnel for remote servers.`);
    }
  }
  try {
    return await authFetch(request);
  } catch (err) {
    if (isConnRefused(err)) {
      const server = resolveServerFromRequest(request);
      await ensureOpencodeRunning(server);
      return authFetch(retry);
    }
    throw err;
  }
}
