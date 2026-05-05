import { spawn } from 'node:child_process';
import { buildAuthHeader } from './auth.js';
import { resolveDirectory } from './config.js';

// INFRA-07 + INFRA-09: Base URL and port for spawning and health-checking OpenCode.
// Read at module init (same as BASE_URL in index.ts — stable for the process lifetime).
const BASE_URL =
  process.env.PREFECT_SERVER_URL ??
  (() => {
    const old = process.env.OPENCODE_URL;
    if (old) console.error('[Prefect] OPENCODE_URL is deprecated, use PREFECT_SERVER_URL');
    return old;
  })() ??
  'http://localhost:4096';

const POLL_INTERVAL_MS = 500; // D-12: hardcoded — fast enough for local startup

// INFRA-13: Read at call time (not module init) so tests can override via process.env.
function autostartTimeoutMs(): number {
  return parseInt(process.env.PREFECT_AUTOSTART_TIMEOUT_MS ?? '', 10) || 30_000;
}

// D-06: Promise-based spawn lock. Concurrent callers await the same promise
// (no double-spawn during startup race). Resets to null after each attempt
// so OpenCode can be re-spawned if it crashes mid-session.
let startPromise: Promise<void> | null = null;

/**
 * Parse the port number from a URL string.
 * Examples: 'http://localhost:4096' → '4096', 'http://127.0.0.1:9000' → '9000'.
 * Falls back to '4096' on any parse failure.
 */
function parsePort(url: string): string {
  try {
    return new URL(url).port || '4096';
  } catch {
    return '4096';
  }
}

/**
 * Poll GET /global/health until the server responds with HTTP 200.
 * Uses buildAuthHeader (INFRA-10) so password-protected servers return 200, not 401.
 * Throws if the server does not become healthy within AUTOSTART_TIMEOUT_MS.
 */
async function waitForHealth(): Promise<void> {
  const timeout = autostartTimeoutMs();
  const deadline = Date.now() + timeout;
  const healthUrl = `${BASE_URL}/global/health`;
  while (Date.now() < deadline) {
    try {
      const res = await globalThis.fetch(new Request(healthUrl, { headers: buildAuthHeader() }));
      if (res.ok) return; // healthy — proceed
    } catch {
      // Connection not yet ready — keep polling
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `OpenCode did not become healthy within ${timeout}ms. ` +
      `Check that 'opencode serve' can start in your environment.`,
  );
}

/**
 * INFRA-07: Spawn 'opencode serve --port <port>' if not already in progress.
 * D-06: Promise lock deduplicates concurrent callers; resets after each attempt
 *        so a crashed OpenCode can be re-spawned without restarting the MCP server.
 * D-08: stdio ['ignore','ignore','inherit'] — stdout/stdin silenced to protect
 *        the MCP JSON-RPC pipe; stderr inherited so startup errors surface.
 * D-09: cwd = resolveDirectory(undefined) — PREFECT_DEFAULT_PROJECT if set,
 *        otherwise undefined (OpenCode uses its own cwd).
 * D-10: Port parsed from PREFECT_SERVER_URL; falls back to 4096.
 * INFRA-10: waitForHealth() uses buildAuthHeader — auth-protected servers detected healthy.
 */
export async function ensureOpencodeRunning(): Promise<void> {
  if (startPromise) return startPromise;

  // Fail fast if PREFECT_SERVER_URL points to a remote host — spawning locally would
  // start the wrong process and then time out polling a machine we didn't touch.
  try {
    const { hostname } = new URL(BASE_URL);
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      throw new Error(
        `[Prefect] Auto-start skipped — PREFECT_SERVER_URL points to remote host '${hostname}'. ` +
          `Start OpenCode manually on that machine.`,
      );
    }
  } catch (err) {
    if ((err as Error).message.startsWith('[Prefect]')) throw err;
    // Malformed BASE_URL — fall through and let the spawn attempt fail naturally.
  }

  const port = parsePort(BASE_URL);
  const cwd = resolveDirectory(undefined);

  console.error(`[Prefect] OpenCode not reachable — spawning 'opencode serve --port ${port}'`);

  startPromise = (async () => {
    const child = spawn('opencode', ['serve', '--port', port], {
      stdio: ['ignore', 'ignore', 'inherit'],
      cwd,
      detached: false,
    });
    child.unref(); // allow parent MCP server to exit without waiting for child

    await waitForHealth();
    console.error(`[Prefect] OpenCode is healthy at ${BASE_URL}`);
  })().finally(() => {
    startPromise = null;
  });

  return startPromise;
}

/** @internal — test use only. Resets the spawn lock so each test starts clean. */
export function _resetStartPromise(): void {
  startPromise = null;
}
