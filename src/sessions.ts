import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { lock } from 'proper-lockfile';

export interface SessionEntry {
  server: string;  // name from registry (must match a ServerEntry.name in servers.json)
  url: string;     // full http://host:port URL — stored alongside name so error messages show both without re-lookup
  model?: { providerID: string; modelID: string };  // registered model for this server — auto-injected on every prefect_run
  parentId?: string;  // set when session was created via prefect_fork — used by prefect_session_children
}

export interface SessionMap {
  sessions: Record<string, SessionEntry>;
}

const SESSIONS_DIR = join(homedir(), '.config', 'prefect');
export const SESSIONS_PATH = join(SESSIONS_DIR, 'sessions.json');

export function readSessionMap(sessionsPath: string = SESSIONS_PATH): SessionMap {
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
    console.error(`[Prefect] Warning: sessions.json is corrupt and will be ignored: ${(err as Error).message}`);
    return { sessions: {} };
  }
}

export function writeSessionMap(map: SessionMap, sessionsPath: string = SESSIONS_PATH): void {
  mkdirSync(dirname(sessionsPath), { recursive: true });
  writeFileSync(sessionsPath, JSON.stringify(map, null, 2) + '\n');
}

export function addSession(sessionId: string, entry: SessionEntry, sessionsPath: string = SESSIONS_PATH): void {
  const map = readSessionMap(sessionsPath);
  map.sessions[sessionId] = entry;
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
 * The lock covers the full read → count → check → write sequence so concurrent Claude Code
 * instances cannot both pass the capacity gate for the same server.
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
  return withSessionLock(async () => {
    const map = readSessionMap(sessionsPath);
    if (maxSessions != null) {
      const active = Object.values(map.sessions).filter((e) => e.server === entry.server).length;
      if (active >= maxSessions) {
        return (
          `Server '${entry.server}' is at capacity (${active}/${maxSessions} active sessions). ` +
          `Delete an existing session with prefect_session_delete or choose a different server.`
        );
      }
    }
    map.sessions[sessionId] = entry;
    writeSessionMap(map, sessionsPath);
    return undefined;
  }, sessionsPath);
}
