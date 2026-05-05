import { authFetch } from './auth.js';
import { ensureOpencodeRunning } from './autostart.js';

// Node.js fetch wraps ECONNREFUSED in err.cause, not in the top-level message.
// String(err) === "TypeError: fetch failed" — no ECONNREFUSED there.
// String(err.cause) === "Error: connect ECONNREFUSED ..." — that's where to look.
function isConnRefused(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const cause = (err as { cause?: unknown }).cause;
  return String(err).includes('ECONNREFUSED') || String(cause).includes('ECONNREFUSED');
}

/**
 * Authenticated fetch wrapper with auto-start.
 * Every outbound OpenCode SDK request flows through this function via the
 * Config.fetch hook, so auth injection and auto-start are handled uniformly
 * for all 18 tools — no per-tool wiring required.
 *
 * On ECONNREFUSED: spawns 'opencode serve' once (guarded by autoStartAttempted),
 * waits for health, then retries the request once with auth headers.
 */
export async function fetchWithAuth(request: Request): Promise<Response> {
  // Clone before first attempt — POST body is marked consumed on any send (even
  // a refused connection), so the retry after auto-start needs a fresh clone.
  const retry = request.clone();
  try {
    return await authFetch(request);
  } catch (err) {
    if (isConnRefused(err)) {
      await ensureOpencodeRunning();
      return authFetch(retry);
    }
    throw err;
  }
}
