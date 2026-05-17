// INFRA-04 + INFRA-05: HTTP Basic Auth header injection for OpenCode requests.
// Credentials are read at call time (not module init) so env var changes take
// effect without restarting the MCP server — same pattern as resolveDirectory().

let warnedPassword = false;
let warnedUsername = false;
let warnedPrefectPassword = false;
let warnedPrefectUsername = false;

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
 */
export function buildAuthHeader(): Record<string, string> {
  const password =
    process.env.LEGATE_SERVER_PASSWORD ??
    (() => {
      const prefect = process.env.PREFECT_SERVER_PASSWORD;
      if (prefect && !warnedPrefectPassword) {
        console.error('[Legate] PREFECT_SERVER_PASSWORD is deprecated, use LEGATE_SERVER_PASSWORD');
        warnedPrefectPassword = true;
      }
      return prefect;
    })() ??
    (() => {
      const old = process.env.OPENCODE_SERVER_PASSWORD;
      if (old && !warnedPassword) {
        console.error('[Legate] OPENCODE_SERVER_PASSWORD is deprecated, use LEGATE_SERVER_PASSWORD');
        warnedPassword = true;
      }
      return old;
    })();

  if (!password) return {};

  const username =
    process.env.LEGATE_SERVER_USERNAME ??
    (() => {
      const prefect = process.env.PREFECT_SERVER_USERNAME;
      if (prefect && !warnedPrefectUsername) {
        console.error('[Legate] PREFECT_SERVER_USERNAME is deprecated, use LEGATE_SERVER_USERNAME');
        warnedPrefectUsername = true;
      }
      return prefect;
    })() ??
    (() => {
      const old = process.env.OPENCODE_SERVER_USERNAME;
      if (old && !warnedUsername) {
        console.error('[Legate] OPENCODE_SERVER_USERNAME is deprecated, use LEGATE_SERVER_USERNAME');
        warnedUsername = true;
      }
      return old;
    })() ??
    'opencode';

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

/** @internal — test use only */
export function _resetWarnFlags(): void {
  warnedPassword = false;
  warnedUsername = false;
  warnedPrefectPassword = false;
  warnedPrefectUsername = false;
}
