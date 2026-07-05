// INFRA-04 + INFRA-05: HTTP Basic Auth header injection for OpenCode requests.
// Credentials are read at call time (not module init) so env var changes take
// effect without restarting the MCP server — same pattern as resolveDirectory().

// legate-lcg: env chain + warn-once bookkeeping now lives in env.ts.
import { resolveEnv, _resetWarnFlags as _resetEnvWarnFlags } from './env.js';

/**
 * Reads LEGATE_SERVER_PASSWORD and LEGATE_SERVER_USERNAME at call time.
 * Falls back to PREFECT_SERVER_PASSWORD / PREFECT_SERVER_USERNAME with a
 * one-time deprecation warning per variable (RENAME-04).
 * Falls back further to OPENCODE_SERVER_PASSWORD / OPENCODE_SERVER_USERNAME with a
 * one-time deprecation warning per variable (per D-04, D-05, D-07).
 * Returns { Authorization: 'Basic <token>' } if a password is set, otherwise {}.
 * Username defaults to 'opencode' per INFRA-05.
 * Token is Buffer.from('username:password').toString('base64') — Node.js Buffer,
 * not btoa(), for consistency with the Node.js runtime (D-03).
 * quietEmptyWarn preserves original behavior: an empty PREFECT_/OPENCODE_
 * fallback value still wins the chain, but does not itself warn.
 */
export function buildAuthHeader(): Record<string, string> {
  const password = resolveEnv(
    ['LEGATE_SERVER_PASSWORD', 'PREFECT_SERVER_PASSWORD', 'OPENCODE_SERVER_PASSWORD'],
    { quietEmptyWarn: true },
  );

  if (!password) return {};

  const username = resolveEnv(
    ['LEGATE_SERVER_USERNAME', 'PREFECT_SERVER_USERNAME', 'OPENCODE_SERVER_USERNAME'],
    { quietEmptyWarn: true },
  ) ?? 'opencode';

  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/**
 * Authenticated fetch wrapper matching Config.fetch from @opencode-ai/sdk.
 * Injects Basic Auth headers when LEGATE_SERVER_PASSWORD is set.
 * Forwards the request unchanged when no password is configured.
 * Pass this to createOpencodeClient({ fetch: authFetch }) in src/index.ts.
 */
export async function authFetch(request: Request): Promise<Response> {
  const headers = buildAuthHeader();
  if (Object.keys(headers).length === 0) {
    return globalThis.fetch(request);
  }
  // Auth header always wins — we intentionally overwrite any pre-existing Authorization.
  if (request.headers.get('Authorization')) {
    console.error('[Legate] authFetch: overwriting existing Authorization header with Basic Auth');
  }
  const merged = { ...Object.fromEntries(request.headers), ...headers };
  const authed = new Request(request, { headers: merged });
  return globalThis.fetch(authed);
}

/** @internal — test use only. Delegates to env.ts's shared warn-once state. */
export function _resetWarnFlags(): void {
  _resetEnvWarnFlags();
}
