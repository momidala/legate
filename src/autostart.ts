import { spawn } from 'node:child_process';
import { buildAuthHeader } from './auth.js';
import { resolveDirectory } from './config.js';
import { ServerEntry } from './registry.js';
// legate-lcg: env chain + warn-once bookkeeping now lives in env.ts.
import { resolveEnvInt, _resetWarnFlags as _resetEnvWarnFlags } from './env.js';

const POLL_INTERVAL_MS = 500; // D-12: hardcoded — fast enough for local startup

// INFRA-13: Read at call time (not module init) so tests can override via process.env.
// RENAME-04: LEGATE_AUTOSTART_TIMEOUT_MS preferred; PREFECT_AUTOSTART_TIMEOUT_MS and
// OPENCODE_AUTOSTART_TIMEOUT_MS fall back with one-time warnings.
// legate-lcg: resolveEnvInt also adds NaN/<=0 validation that the old
// `parseInt(v, 10) || 30_000` pattern silently lacked.
export function autostartTimeoutMs(): number {
  return resolveEnvInt(
    ['LEGATE_AUTOSTART_TIMEOUT_MS', 'PREFECT_AUTOSTART_TIMEOUT_MS', 'OPENCODE_AUTOSTART_TIMEOUT_MS'],
    30_000,
  );
}

/** @internal — test use only. Delegates to env.ts's shared warn-once state. */
export function _resetWarnFlags(): void {
  _resetEnvWarnFlags();
}

// D-16: Per-server promise lock Map. Concurrent callers for the SAME server await the same
// promise (no double-spawn during startup race). Resets per key after each attempt so a
// crashed OpenCode can be re-spawned without restarting the MCP server.
// Concurrent callers for DIFFERENT servers get independent Map entries — no cross-blocking.
const startPromises = new Map<string, Promise<void>>();

function startKey(server: ServerEntry): string {
  return server.name || `${server.host}:${server.port}`;
}

/**
 * Poll GET /global/health until the server responds with HTTP 200.
 * Uses buildAuthHeader (INFRA-10) so password-protected servers return 200, not 401.
 * Throws if the server does not become healthy within AUTOSTART_TIMEOUT_MS.
 * D-14/Pitfall 3: Takes serverUrl as a parameter — does not close over any module global.
 */
async function waitForHealth(serverUrl: string): Promise<void> {
  const timeout = autostartTimeoutMs();
  const deadline = Date.now() + timeout;
  const healthUrl = `${serverUrl}/global/health`;
  while (Date.now() < deadline) {
    try {
      const res = await globalThis.fetch(new Request(healthUrl, { headers: buildAuthHeader() }));
      if (res.ok) return;
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
 * INFRA-07 + MULTI-07: Spawn 'opencode serve --port <port>' if not already in progress.
 * D-14: Accepts a ServerEntry; uses server.host and server.port (no longer BASE_URL).
 * D-15: Skips auto-start if server.host is not localhost/127.0.0.1.
 * D-16: startPromises is a Map keyed by server name (or host:port) — concurrent
 *       calls for DIFFERENT servers do not block each other.
 * D-17: Caller is responsible for resolving the ServerEntry; this function does
 *       not consult the registry.
 */
export async function ensureOpencodeRunning(server: ServerEntry): Promise<void> {
  const key = startKey(server);
  const existing = startPromises.get(key);
  if (existing) return existing;

  // D-15: localhost guard. Apply BEFORE spawn so remote misconfig fails fast.
  if (server.host !== 'localhost' && server.host !== '127.0.0.1') {
    throw new Error(
      `[Legate] Auto-start skipped — server '${server.name}' points to remote host '${server.host}'. ` +
        `Start OpenCode manually on that machine.`,
    );
  }

  const port = String(server.port);
  const serverUrl = `http://${server.host}:${server.port}`;
  const cwd = resolveDirectory(undefined);
  // On Windows, npm-installed binaries are .cmd wrappers; spawn needs the .cmd suffix.
  const cmd = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';

  console.error(`[Legate] OpenCode not reachable on ${serverUrl} — spawning 'opencode serve --port ${port}'`);

  const promise = (async () => {
    const child = spawnImpl(cmd, ['serve', '--port', port], {
      stdio: ['ignore', 'ignore', 'inherit'],
      cwd,
      detached: false,
    });
    // Spawn failures ('opencode' not on PATH → ENOENT) are delivered as an async
    // 'error' EVENT, not a throw. Without a listener the event escalates to
    // uncaughtException (this crashed CI, where opencode is not installed) and the
    // caller would otherwise wait out the full health timeout instead of failing
    // fast with the real reason. Race the health poll against the spawn error.
    const spawnFailed = new Promise<never>((_, reject) => {
      child.on('error', (err) => {
        reject(new Error(`[Legate] Failed to spawn '${cmd}': ${err.message}. Is OpenCode installed and on PATH?`));
      });
    });
    child.unref();
    await Promise.race([waitForHealth(serverUrl), spawnFailed]);
    console.error(`[Legate] OpenCode is healthy at ${serverUrl}`);
  })().finally(() => {
    startPromises.delete(key);
  });

  startPromises.set(key, promise);
  return promise;
}

/** @internal — test use only. Resets the spawn lock map so each test starts clean. */
export function _resetStartPromise(): void {
  startPromises.clear();
}

// Spawn seam: tests inject a fake spawner so the suite NEVER executes a real
// 'opencode serve' (unit tests were spawning real servers — orphaned children
// locally, uncaughtException ENOENT crashes on CI runners without the binary).
type SpawnFn = typeof spawn;
let spawnImpl: SpawnFn = spawn;

/** @internal — test use only. Replaces the child_process.spawn implementation. */
export function _setSpawn(fn: SpawnFn): void {
  spawnImpl = fn;
}

/** @internal — test use only. Restores the real spawn implementation. */
export function _resetSpawn(): void {
  spawnImpl = spawn;
}
