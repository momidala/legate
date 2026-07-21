import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { lock } from 'proper-lockfile';
import { buildAuthHeader } from './auth.js';
import { migrateIfNeeded } from './migration.js';
// legate-lcg: env chain + warn-once bookkeeping now lives in env.ts.
import { resolveEnvNum } from './env.js';

const DEFAULT_SESSION_TTL_MS = 86_400_000; // 24 hours

export interface SessionEntry {
  server: string; // name from registry (must match a ServerEntry.name in servers.json)
  url: string; // full http://host:port URL — stored alongside name so error messages show both without re-lookup
  model?: { providerID: string; modelID: string }; // registered model for this server — auto-injected on every prefect_run
  parentId?: string; // set when session was created via prefect_fork — used by prefect_session_children
  createdAt?: number; // unix ms — used for TTL pruning; absent on legacy entries (treated as non-expired)
  directory?: string; // absolute project dir the session was created in — threaded into the liveness probe (legate-ale) so OpenCode's per-project session scoping doesn't 404 live sessions in non-default projects; absent on legacy/default-cwd entries (probe omits the query param, matching prior behavior)
}

export interface SessionMap {
  sessions: Record<string, SessionEntry>;
}

const SESSIONS_DIR = join(homedir(), '.config', 'legate');
export const SESSIONS_PATH = join(SESSIONS_DIR, 'sessions.json');

/**
 * One-time migration: copy ~/.config/prefect/ → ~/.config/legate/ when sessions.json
 * does not yet exist in the new location.
 *
 * Guard is on SESSIONS_PATH (the file), not the directory — the directory is created
 * by `legate add-server` before the MCP ever runs, so checking directory existence
 * would cause the migration to be silently skipped on any machine that used the CLI
 * before the rename.
 *
 * legate-hry: this used to be invoked at module top level (a load-time side effect).
 * The call now lives in runStartupMigrations() (src/startup.ts), invoked once by the
 * MCP server main() and the CLI at startup — so importing this module is side-effect
 * free. The helper itself is unchanged.
 *
 * @internal — exported for testing only and for runStartupMigrations().
 */
export function _runMigration(newPath: string, oldDir: string): void {
  // Delegates to the shared helper (legate-5di). Copies into dirname(newPath) — identical
  // to the original inline behavior, including "copy even if the target dir already exists".
  migrateIfNeeded(newPath, oldDir, dirname(newPath));
}

/**
 * Resolve the session TTL from env vars, emitting a one-time deprecation warning for the
 * old PREFECT_/OPENCODE_ names. Extracted so both readSessionMap and pruneExpiredSessions
 * apply the same TTL. Called before file I/O so the warning still fires on the ENOENT path.
 * legate-lcg: uses resolveEnvNum (Number()-based, no positivity check) rather than
 * resolveEnvInt deliberately — a TTL of 0 ("prune everything immediately") and negative
 * TTLs are accepted as-is today, and this refactor does not change that; only
 * NaN/Infinity fall back to DEFAULT_SESSION_TTL_MS.
 */
function resolveSessionTtlMs(): number {
  return resolveEnvNum(
    ['LEGATE_SESSION_TTL_MS', 'PREFECT_SESSION_TTL_MS', 'OPENCODE_SESSION_TTL_MS'],
    DEFAULT_SESSION_TTL_MS,
  );
}

/**
 * Parse sessions.json from disk with the same corrupt-file / ENOENT recovery as before,
 * but WITHOUT any filtering. Returns the raw map so callers that hold the lock can prune
 * physically (pruneExpiredSessions) rather than only see a filtered view.
 */
function parseSessionsFile(sessionsPath: string): SessionMap {
  try {
    const parsed = JSON.parse(readFileSync(sessionsPath, 'utf8'));
    if (!parsed || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) {
      throw new Error(`malformed sessions map at ${sessionsPath}: expected { sessions: { ... } }`);
    }
    return parsed as SessionMap;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { sessions: {} };
    // Corrupt file — log warning and recover with empty map rather than crashing all tools
    console.error(`[Legate] Warning: sessions.json is corrupt and will be ignored: ${(err as Error).message}`);
    return { sessions: {} };
  }
}

/**
 * Read the session map. SIDE-EFFECT FREE (legate-yho): expired entries are filtered out of
 * the returned map so callers never see them, but the file is NOT rewritten here. Physical
 * removal of expired entries happens under the lock in atomicCheckAndAdd via
 * pruneExpiredSessions — read must never race a concurrent instance's write.
 */
export function readSessionMap(sessionsPath: string = SESSIONS_PATH): SessionMap {
  // Resolve TTL (and fire any deprecation warning) before file I/O so it still warns on ENOENT.
  const ttlMs = resolveSessionTtlMs();
  const map = parseSessionsFile(sessionsPath);
  // Filter (do NOT delete-and-write): entries older than the TTL are excluded from the
  // returned view. Legacy entries without createdAt are kept (treated as non-expired).
  const now = Date.now();
  const result: SessionMap = { sessions: {} };
  for (const [id, entry] of Object.entries(map.sessions)) {
    if (entry.createdAt !== undefined && now - entry.createdAt > ttlMs) continue;
    result.sessions[id] = entry;
  }
  return result;
}

/**
 * Delete expired entries (createdAt older than the TTL) IN PLACE from the given map, returning
 * true if anything was removed. Does NOT acquire the lock or write the file — the caller must
 * already hold the session lock and persist the map. Called inside atomicCheckAndAdd's locked
 * section so TTL pruning is the only path that physically rewrites sessions.json (legate-yho).
 */
export function pruneExpiredSessions(map: SessionMap): boolean {
  const ttlMs = resolveSessionTtlMs();
  const now = Date.now();
  let pruned = false;
  for (const [id, entry] of Object.entries(map.sessions)) {
    if (entry.createdAt !== undefined && now - entry.createdAt > ttlMs) {
      delete map.sessions[id];
      pruned = true;
    }
  }
  return pruned;
}

export function writeSessionMap(map: SessionMap, sessionsPath: string = SESSIONS_PATH): void {
  mkdirSync(dirname(sessionsPath), { recursive: true });
  writeFileSync(sessionsPath, JSON.stringify(map, null, 2) + '\n');
}

/**
 * legate-ayq: register a session under the SAME retrying async lock as atomicCheckAndAdd,
 * doing the read-modify-write entirely inside the locked section.
 *
 * Failure semantics — addSession is fork registration: losing the entry breaks routing for
 * the new session (subsequent tool calls can't find its server URL). So if the lock can't be
 * acquired after all retries, PROPAGATE the rejection to the caller — the fork tool's catch
 * turns it into an isError response rather than silently dropping the mapping.
 *
 * lockOpts is an @internal test seam: tests shrink the retry budget (e.g. { retries: 0 }) and
 * hold the lock manually to exercise the lock-acquisition-failure path deterministically.
 */
export async function addSession(
  sessionId: string,
  entry: SessionEntry,
  sessionsPath: string = SESSIONS_PATH,
  lockOpts?: LockOverride,
): Promise<void> {
  await withSessionLock(
    () => {
      const map = readSessionMap(sessionsPath);
      map.sessions[sessionId] = { createdAt: Date.now(), ...entry };
      writeSessionMap(map, sessionsPath);
    },
    sessionsPath,
    lockOpts,
  );
}

/**
 * legate-ayq: remove a session under the same retrying async lock (read-modify-write fully
 * inside the locked section).
 *
 * Failure semantics — removeSession is idempotent cleanup (D-12): the entry it deletes is
 * already stale (session 404'd or was deleted server-side). If the lock can't be acquired
 * after all retries, LOG-AND-SKIP rather than propagate — a leftover stale entry is harmless
 * and gets pruned later by the TTL / liveness sweep in atomicCheckAndAdd. Refusing to skip
 * would turn a best-effort cleanup into a spurious tool error.
 *
 * lockOpts is an @internal test seam (see addSession).
 */
export async function removeSession(
  sessionId: string,
  sessionsPath: string = SESSIONS_PATH,
  lockOpts?: LockOverride,
): Promise<void> {
  try {
    await withSessionLock(
      () => {
        const map = readSessionMap(sessionsPath);
        if (!(sessionId in map.sessions)) return; // silent no-op (D-12 cleanup must be idempotent)
        delete map.sessions[sessionId];
        writeSessionMap(map, sessionsPath);
      },
      sessionsPath,
      lockOpts,
    );
  } catch (err) {
    console.error(
      `[Legate] Warning: could not acquire sessions.json lock to remove ${sessionId}; ` +
        `skipping (stale entry will be pruned by the TTL/liveness sweep): ${(err as Error).message}`,
    );
  }
}

export function lookupSession(sessionId: string, sessionsPath: string = SESSIONS_PATH): SessionEntry | undefined {
  return readSessionMap(sessionsPath).sessions[sessionId];
}

export function countSessionsForServer(serverName: string, sessionsPath: string = SESSIONS_PATH): number {
  const map = readSessionMap(sessionsPath);
  return Object.values(map.sessions).filter((e) => e.server === serverName).length;
}

/**
 * Returns true if the server confirms the session exists (HTTP 200), false otherwise.
 *
 * OpenCode scopes sessions by project directory, so the probe MUST carry the session's stored
 * directory (legate-ale) — otherwise GET /session/:id 404s for live sessions created in a
 * non-default project, and the capacity sweep would falsely prune them. When no directory is
 * stored (legacy/default-cwd entries) the query param is omitted, matching prior behavior.
 */
async function isSessionLive(sessionId: string, serverUrl: string, directory?: string): Promise<boolean> {
  try {
    const url = directory
      ? `${serverUrl}/session/${sessionId}?directory=${encodeURIComponent(directory)}`
      : `${serverUrl}/session/${sessionId}`;
    const res = await globalThis.fetch(url, {
      headers: buildAuthHeader(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * legate-ayq: options override for the session lock — an @internal test seam only.
 * Tests pass a shrunken retry budget so the lock-acquisition-failure path is reachable
 * without waiting out the full retry schedule. Production callers never pass this.
 */
type LockOverride = Parameters<typeof lock>[1];

/**
 * legate-ayq / WR-01: the ONE lock config every sessions.json writer shares. addSession,
 * removeSession AND atomicCheckAndAdd all serialize through withSessionLock with these same
 * retrying options — so no write path can clobber another's (in particular, no best-effort
 * write can race atomicCheckAndAdd's capacity-gated write). realpath:false lets a not-yet-
 * existing sessions.json be locked (creates sessionsPath.lock).
 */
const SESSION_LOCK_OPTS = {
  realpath: false,
  retries: { retries: 10, factor: 1.5, minTimeout: 50, maxTimeout: 500 },
  stale: 30000,
} as const;

async function withSessionLock<T>(
  fn: () => T | Promise<T>,
  sessionsPath: string = SESSIONS_PATH,
  lockOpts?: LockOverride,
): Promise<T> {
  mkdirSync(dirname(sessionsPath), { recursive: true });
  const release = await lock(sessionsPath, { ...SESSION_LOCK_OPTS, ...lockOpts });
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * WR-01: Atomically checks server capacity and registers the session in sessions.json under a
 * file lock. The lock covers the full read → liveness-check → count → check → write sequence so
 * concurrent Claude Code instances cannot both pass the capacity gate for the same server.
 *
 * legate-ayq: this capacity-gated write is now fully serialized against addSession/removeSession
 * too — all three go through withSessionLock / SESSION_LOCK_OPTS (the same retrying lock). There
 * is no longer any unlocked-fallback write path that could clobber this write; EVERY sessions.json
 * write serializes through one lock.
 *
 * Before counting, each existing session for the target server is verified via GET /session/:id.
 * Any entry whose server returns non-200 (including connection refused after a restart) is pruned
 * from sessions.json immediately and not counted toward capacity.
 *
 * Returns an error string if the server is at capacity (caller must abort the just-created
 * OpenCode session), or undefined on success.
 * When maxSessions is null/undefined the capacity check is skipped and the entry is written unconditionally.
 */
export async function atomicCheckAndAdd(
  sessionId: string,
  entry: SessionEntry,
  maxSessions: number | null | undefined,
  sessionsPath: string = SESSIONS_PATH,
): Promise<string | undefined> {
  // Run liveness checks outside the lock — they're HTTP calls and could be slow.
  // Snapshot which sessions need checking before acquiring the lock.
  const preMap = readSessionMap(sessionsPath);
  const candidateIds = Object.entries(preMap.sessions)
    .filter(([, e]) => e.server === entry.server)
    .map(([id, e]) => ({ id, url: e.url, directory: e.directory }));

  const liveChecks = await Promise.all(
    // Thread each candidate's stored directory into the probe (legate-ale).
    candidateIds.map(async ({ id, url, directory }) => ({ id, live: await isSessionLive(id, url, directory) })),
  );
  const deadIds = new Set(liveChecks.filter(({ live }) => !live).map(({ id }) => id));

  return withSessionLock(async () => {
    // Read RAW under the lock (not the filtered readSessionMap) so pruneExpiredSessions can
    // physically remove expired entries here — the one write path that cleans TTL'd sessions.
    const map = parseSessionsFile(sessionsPath);
    let pruned = pruneExpiredSessions(map); // TTL prune under the lock (legate-yho)
    // Prune dead sessions found during pre-lock liveness check.
    for (const deadId of deadIds) {
      if (deadId in map.sessions && map.sessions[deadId].server === entry.server) {
        delete map.sessions[deadId];
        pruned = true;
      }
    }

    if (maxSessions != null) {
      const active = Object.values(map.sessions).filter((e) => e.server === entry.server).length;
      if (active >= maxSessions) {
        if (pruned) writeSessionMap(map, sessionsPath);
        return (
          `Server '${entry.server}' is at capacity (${active}/${maxSessions} active sessions). ` +
          `Delete an existing session with legate_session_delete or choose a different server.`
        );
      }
    }
    map.sessions[sessionId] = { createdAt: Date.now(), ...entry };
    writeSessionMap(map, sessionsPath);
    return undefined;
  }, sessionsPath);
}
