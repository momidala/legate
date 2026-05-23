import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { lock } from 'proper-lockfile';
import { buildAuthHeader } from './auth.js';

const DEFAULT_SESSION_TTL_MS = 86_400_000; // 24 hours

let warnedSessionTtl = false;
let warnedOpenCodeSessionTtl = false;

/** @internal — test use only. Resets the deprecation warn flag so each test starts clean. */
export function _resetWarnFlags(): void {
  warnedSessionTtl = false;
  warnedOpenCodeSessionTtl = false;
}

export interface SessionEntry {
  server: string;  // name from registry (must match a ServerEntry.name in servers.json)
  url: string;     // full http://host:port URL — stored alongside name so error messages show both without re-lookup
  model?: { providerID: string; modelID: string };  // registered model for this server — auto-injected on every prefect_run
  parentId?: string;  // set when session was created via prefect_fork — used by prefect_session_children
  createdAt?: number; // unix ms — used for TTL pruning; absent on legacy entries (treated as non-expired)
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
 * @internal — exported for testing only.
 */
export function _runMigration(newPath: string, oldDir: string): void {
  if (!existsSync(newPath) && existsSync(oldDir)) {
    try { cpSync(oldDir, dirname(newPath), { recursive: true }); } catch { /* non-fatal */ }
  }
}

const OLD_SESSIONS_DIR = join(homedir(), '.config', 'prefect');
_runMigration(SESSIONS_PATH, OLD_SESSIONS_DIR);

export function readSessionMap(sessionsPath: string = SESSIONS_PATH): SessionMap {
  // Resolve TTL env var (with deprecation warning) before file I/O so the warning
  // fires even when sessions.json does not exist yet (ENOENT path).
  let ttlMs: number;
  const legateVal = process.env.LEGATE_SESSION_TTL_MS;
  if (legateVal !== undefined) {
    ttlMs = Number(legateVal);
    if (!Number.isFinite(ttlMs)) ttlMs = DEFAULT_SESSION_TTL_MS;
  } else {
    const prefectVal = process.env.PREFECT_SESSION_TTL_MS;
    if (prefectVal !== undefined) {
      if (!warnedSessionTtl) {
        console.error('[Legate] PREFECT_SESSION_TTL_MS is deprecated, use LEGATE_SESSION_TTL_MS');
        warnedSessionTtl = true;
      }
      ttlMs = Number(prefectVal);
      if (!Number.isFinite(ttlMs)) ttlMs = DEFAULT_SESSION_TTL_MS;
    } else {
      const opencodeVal = process.env.OPENCODE_SESSION_TTL_MS;
      if (opencodeVal !== undefined) {
        if (!warnedOpenCodeSessionTtl) {
          console.error('[Legate] OPENCODE_SESSION_TTL_MS is deprecated, use LEGATE_SESSION_TTL_MS');
          warnedOpenCodeSessionTtl = true;
        }
        ttlMs = Number(opencodeVal);
        if (!Number.isFinite(ttlMs)) ttlMs = DEFAULT_SESSION_TTL_MS;
      } else {
        ttlMs = DEFAULT_SESSION_TTL_MS;
      }
    }
  }

  try {
    const parsed = JSON.parse(readFileSync(sessionsPath, 'utf8'));
    if (!parsed || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) {
      throw new Error(`malformed sessions map at ${sessionsPath}: expected { sessions: { ... } }`);
    }
    const map = parsed as SessionMap;
    // TTL pruning: remove entries older than LEGATE_SESSION_TTL_MS (default 24h).
    // Legacy entries without createdAt are kept (treated as non-expired).
    const now = Date.now();
    let pruned = false;
    for (const [id, entry] of Object.entries(map.sessions)) {
      if (entry.createdAt !== undefined && now - entry.createdAt > ttlMs) {
        delete map.sessions[id];
        pruned = true;
      }
    }
    if (pruned) writeSessionMap(map, sessionsPath);
    return map;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { sessions: {} };
    // Corrupt file — log warning and recover with empty map rather than crashing all tools
    console.error(`[Legate] Warning: sessions.json is corrupt and will be ignored: ${(err as Error).message}`);
    return { sessions: {} };
  }
}

export function writeSessionMap(map: SessionMap, sessionsPath: string = SESSIONS_PATH): void {
  mkdirSync(dirname(sessionsPath), { recursive: true });
  writeFileSync(sessionsPath, JSON.stringify(map, null, 2) + '\n');
}

export function addSession(sessionId: string, entry: SessionEntry, sessionsPath: string = SESSIONS_PATH): void {
  const map = readSessionMap(sessionsPath);
  map.sessions[sessionId] = { createdAt: Date.now(), ...entry };
  writeSessionMap(map, sessionsPath);
}

export function removeSession(sessionId: string, sessionsPath: string = SESSIONS_PATH): void {
  const map = readSessionMap(sessionsPath);
  if (!(sessionId in map.sessions)) return;  // silent no-op (D-12 cleanup must be idempotent)
  delete map.sessions[sessionId];
  writeSessionMap(map, sessionsPath);
}

export function lookupSession(sessionId: string, sessionsPath: string = SESSIONS_PATH): SessionEntry | undefined {
  return readSessionMap(sessionsPath).sessions[sessionId];
}

export function countSessionsForServer(serverName: string, sessionsPath: string = SESSIONS_PATH): number {
  const map = readSessionMap(sessionsPath);
  return Object.values(map.sessions).filter((e) => e.server === serverName).length;
}

/** Returns true if the server confirms the session exists (HTTP 200), false otherwise. */
async function isSessionLive(sessionId: string, serverUrl: string): Promise<boolean> {
  try {
    const res = await globalThis.fetch(`${serverUrl}/session/${sessionId}`, {
      headers: buildAuthHeader(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function withSessionLock<T>(fn: () => T | Promise<T>, sessionsPath: string = SESSIONS_PATH): Promise<T> {
  mkdirSync(dirname(sessionsPath), { recursive: true });
  const release = await lock(sessionsPath, {
    realpath: false,
    retries: { retries: 10, factor: 1.5, minTimeout: 50, maxTimeout: 500 },
    stale: 30000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * Atomically checks server capacity and registers the session in sessions.json under a file lock.
 * The lock covers the full read → liveness-check → count → check → write sequence so concurrent
 * Claude Code instances cannot both pass the capacity gate for the same server.
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
    .map(([id, e]) => ({ id, url: e.url }));

  const liveChecks = await Promise.all(
    candidateIds.map(async ({ id, url }) => ({ id, live: await isSessionLive(id, url) })),
  );
  const deadIds = new Set(liveChecks.filter(({ live }) => !live).map(({ id }) => id));

  return withSessionLock(async () => {
    const map = readSessionMap(sessionsPath);
    // Prune dead sessions found during pre-lock liveness check.
    let pruned = false;
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
