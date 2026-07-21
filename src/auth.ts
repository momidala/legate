// INFRA-04 + INFRA-05: HTTP Basic Auth header injection for OpenCode requests.
// Credentials are read at call time (not module init) so env var changes take
// effect without restarting the MCP server — same pattern as resolveDirectory().

// legate-lcg: env chain + warn-once bookkeeping now lives in env.ts.
import { resolveEnv, _resetWarnFlags as _resetEnvWarnFlags } from './env.js';
// legate-k2a: the trusted-host allow-list is (loopback ∪ registered servers), so
// authFetch must be able to read the registry to decide whether to attach creds.
import { readRegistry, REGISTRY_PATH } from './registry.js';

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
  const password = resolveEnv(['LEGATE_SERVER_PASSWORD', 'PREFECT_SERVER_PASSWORD', 'OPENCODE_SERVER_PASSWORD'], {
    quietEmptyWarn: true,
  });

  if (!password) return {};

  const username =
    resolveEnv(['LEGATE_SERVER_USERNAME', 'PREFECT_SERVER_USERNAME', 'OPENCODE_SERVER_USERNAME'], {
      quietEmptyWarn: true,
    }) ?? 'opencode';

  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

// legate-k2a: Basic Auth sends the plaintext password (base64 is not encryption)
// on every request that carries it. Before this change authFetch attached the
// header to EVERY destination, so a malicious/compromised registry entry — or a
// server that 3xx-redirects cross-host — could siphon the credentials. We now
// only attach to hosts we have a reason to trust.
//
// Loopback is trusted because it never leaves the machine. A registered server
// (added deliberately via `legate add-server`) is trusted because the operator
// vouched for it. Everything else is untrusted: we send the request WITHOUT
// credentials rather than leak them to an unvetted host.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// legate-k2a: warn-once-per-host, mirroring fetch.ts's _warnedRemoteHosts. Cleared
// by _resetWarnFlags() so unit tests can assert "called twice ⇒ one warning".
const _warnedUntrustedHosts = new Set<string>();
const _warnedRedirectHosts = new Set<string>();

// legate-k2a: test seam. REGISTRY_PATH is frozen at module load from homedir(), so
// a unit test that needs authFetch's trust check to consult a temp registry points
// it here (authFetch itself deliberately keeps its (request) => Response signature).
let _registryPathForTest: string | undefined;

/** @internal — test use only. Overrides the registry file the trust check reads. */
export function _setRegistryPathForTest(path: string | undefined): void {
  _registryPathForTest = path;
}

/**
 * legate-k2a: A host is trusted to receive Basic Auth credentials iff it is
 * loopback OR the `host` of a registered server. Match is on hostname exactly as
 * registered; port is intentionally ignored — the operator authenticated a host,
 * not a specific port, and OpenCode may run on several ports of the same box.
 *
 * @internal — exported for direct unit testing; registryPath is injectable so a
 * test can point it at a temp registry without mutating HOME.
 */
export function _isTrustedHost(
  hostname: string,
  registryPath: string = _registryPathForTest ?? REGISTRY_PATH,
): boolean {
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  // Read fresh each call (no cache): matches fetch.ts's resolveServerFromRequest,
  // and a host added mid-process via `legate add-server` becomes trusted at once.
  const reg = readRegistry(registryPath);
  return reg.servers.some((s) => s.host === hostname);
}

// legate-k2a: cap on manually-followed redirects. Bounds a redirect loop and, more
// importantly, bounds how many hops we'll chase before giving up on an auth'd request.
const MAX_REDIRECTS = 3;

/**
 * legate-k2a: manual redirect follower used ONLY on the authenticated path.
 *
 * globalThis.fetch's default `redirect: 'follow'` re-sends request headers —
 * including Authorization — to the redirect target, even cross-host. That is the
 * exact credential-leak we are closing, so when we attach creds we set
 * `redirect: 'manual'` and follow the chain ourselves:
 *   - same host:port  → follow, re-attaching credentials (safe, same origin).
 *   - cross-host      → follow WITHOUT Authorization (matches browser fetch
 *                       semantics, which strip auth on cross-origin redirects),
 *                       warning once per target host.
 * The chain is capped at MAX_REDIRECTS hops; beyond that we throw rather than
 * spin. A 3xx with no Location header is returned to the caller as-is.
 *
 * Note: non-GET redirects are re-issued without a body. OpenCode's local API does
 * not 3xx-redirect authenticated writes, so this only affects the adversarial
 * "redirect trying to harvest creds" path — where dropping the body is desirable.
 */
async function followManualRedirects(initial: Request): Promise<Response> {
  let current = initial;
  for (let hop = 0; ; hop++) {
    const res = await globalThis.fetch(current);
    if (res.status < 300 || res.status >= 400) return res; // not a redirect
    const location = res.headers.get('Location');
    if (!location) return res; // 3xx without a target — hand it back untouched

    if (hop >= MAX_REDIRECTS) {
      throw new Error(
        `[Legate] authFetch: exceeded ${MAX_REDIRECTS} redirects starting from ${initial.url} — refusing to follow further (possible redirect loop).`,
      );
    }

    const from = new URL(current.url);
    const to = new URL(location, current.url); // resolve relative Location against current
    const sameHostPort = to.hostname === from.hostname && to.port === from.port;

    // Object.fromEntries(Headers) lowercases every key, so strip the lowercase form.
    const nextHeaders = Object.fromEntries(current.headers);
    if (!sameHostPort) {
      delete nextHeaders['authorization'];
      if (!_warnedRedirectHosts.has(to.host)) {
        _warnedRedirectHosts.add(to.host);
        console.error(`[Legate] authFetch: cross-host redirect to ${to.host} — following WITHOUT credentials.`);
      }
    }

    current = new Request(to.toString(), {
      method: current.method,
      headers: nextHeaders,
      redirect: 'manual',
    });
  }
}

/**
 * Authenticated fetch wrapper matching Config.fetch from @opencode-ai/sdk.
 * Injects Basic Auth headers when LEGATE_SERVER_PASSWORD is set AND the target
 * host is trusted (legate-k2a). Forwards the request unchanged when no password
 * is configured, or when the host is untrusted (warning once per host).
 * Pass this to createOpencodeClient({ fetch: authFetch }) in src/index.ts.
 */
export async function authFetch(request: Request): Promise<Response> {
  const headers = buildAuthHeader();
  if (Object.keys(headers).length === 0) {
    // legate-k2a: no credentials to leak → unauthenticated path is entirely
    // unchanged (default redirect: 'follow', no host check, no registry read).
    return globalThis.fetch(request);
  }

  // legate-k2a: gate credential attachment on host trust.
  const host = new URL(request.url).hostname;
  if (!_isTrustedHost(host)) {
    if (!_warnedUntrustedHosts.has(host)) {
      _warnedUntrustedHosts.add(host);
      console.error(
        `[Legate] Not sending credentials to unregistered host ${host} — add it with legate add-server to authenticate.`,
      );
    }
    // Send the request WITHOUT credentials. Default redirect behavior is fine —
    // there is nothing sensitive to leak on the redirect either.
    return globalThis.fetch(request);
  }

  // Auth header always wins — we intentionally overwrite any pre-existing Authorization.
  if (request.headers.get('Authorization')) {
    console.error('[Legate] authFetch: overwriting existing Authorization header with Basic Auth');
  }
  const merged = { ...Object.fromEntries(request.headers), ...headers };
  // legate-k2a: redirect: 'manual' so followManualRedirects controls whether creds
  // are re-attached across each hop (see that function for the security rationale).
  const authed = new Request(request, { headers: merged, redirect: 'manual' });
  return followManualRedirects(authed);
}

/** @internal — test use only. Delegates to env.ts's shared warn-once state. */
export function _resetWarnFlags(): void {
  _resetEnvWarnFlags();
  // legate-k2a: also clear this module's per-host warn-once sets.
  _warnedUntrustedHosts.clear();
  _warnedRedirectHosts.clear();
}
