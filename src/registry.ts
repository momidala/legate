import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { migrateIfNeeded } from './migration.js';

export interface ServerEntry {
  name: string;
  host: string;
  port: number;
  providerID: string;
  modelID: string;
  maxSessions?: number;   // optional — undefined means unlimited; persisted only when set
}

export interface Registry {
  servers: ServerEntry[];
}

// legate-8jm: per-entry validation for readRegistry. The routing-critical fields
// (name/host/port) are strict — a broken one would feed a bad URL into serverUrl()
// and misroute every tool call, so such an entry is SKIPPED rather than trusted.
// providerID/modelID/maxSessions are intentionally lenient (optional): every code
// path already treats them as possibly-absent (`entry?.providerID && entry?.modelID`),
// so a sparse-but-routable hand-edited entry must keep working, not be dropped.
//
// This is a hand-written guard rather than zod ON PURPOSE: registry.ts sits on the CLI's
// import graph (cli.js → startup.js → registry.js), and that graph must resolve inside an
// isolated global install that has NO third-party node_modules (enforced by cli.test.js's
// runCliAsGlobal). Pulling zod in here would break `legate install-command`. The canonical
// zod mirror of this shape lives in src/schemas.ts (ServerEntrySchema); its drift against
// this guard is asserted in registry.test.ts.
export function isValidServerEntry(entry: unknown): entry is ServerEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.name !== 'string' || e.name.length === 0) return false;
  if (typeof e.host !== 'string' || e.host.length === 0) return false;
  if (typeof e.port !== 'number' || !Number.isInteger(e.port) || e.port <= 0) return false;
  if (e.providerID !== undefined && typeof e.providerID !== 'string') return false;
  if (e.modelID !== undefined && typeof e.modelID !== 'string') return false;
  if (e.maxSessions !== undefined && typeof e.maxSessions !== 'number') return false;
  return true;
}

// legate-8jm: the ONE place that formats a registry entry into its base URL. Every
// other site that used to inline `http://${s.host}:${s.port}` now calls this so the
// URL shape has a single definition.
export function serverUrl(entry: Pick<ServerEntry, 'host' | 'port'>): string {
  return `http://${entry.host}:${entry.port}`;
}

// legate-8jm: registry lookup helpers — replace the scattered reg.servers.find(...)
// call sites. Each reads the registry fresh (matching prior inline behavior) and
// accepts an optional path so unit tests / routing.ts can inject a temp registry.
export function findServerByName(name: string, registryPath: string = REGISTRY_PATH): ServerEntry | undefined {
  return readRegistry(registryPath).servers.find((s) => s.name === name);
}

export function findServerByUrl(url: string, registryPath: string = REGISTRY_PATH): ServerEntry | undefined {
  return readRegistry(registryPath).servers.find((s) => serverUrl(s) === url);
}

export function firstServer(registryPath: string = REGISTRY_PATH): ServerEntry | undefined {
  return readRegistry(registryPath).servers[0];
}

const REGISTRY_DIR = join(homedir(), '.config', 'legate');
export const REGISTRY_PATH = join(REGISTRY_DIR, 'servers.json');

/**
 * One-time migration: copy ~/.config/prefect/ → ~/.config/legate/ when servers.json
 * does not yet exist in the new location.
 *
 * Guard is on REGISTRY_PATH (the FILE), not the directory — the directory is created
 * by `legate add-server` before the MCP ever runs, so a directory-existence guard would
 * silently skip migration on any machine that used the CLI before the rename (legate-5di).
 *
 * legate-hry: this used to be invoked at module top level (a load-time side effect).
 * The call now lives in runStartupMigrations() (src/startup.ts), invoked once by the
 * MCP server main() and the CLI at startup — so importing this module is side-effect
 * free. The helper itself is unchanged.
 *
 * @internal — exported for testing only and for runStartupMigrations(). Mirrors sessions._runMigration.
 */
export function _runRegistryMigration(newPath: string, oldDir: string): void {
  migrateIfNeeded(newPath, oldDir, dirname(newPath));
}

export function readRegistry(registryPath: string = REGISTRY_PATH): Registry {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
    // Top-level shape error still throws: a file that isn't { servers: [...] } is
    // unusable, so callers should see it loudly (unchanged from before legate-8jm).
    if (!parsed || !Array.isArray(parsed.servers)) {
      throw new Error(`malformed registry at ${registryPath}: expected { servers: [...] }`);
    }
    // legate-8jm: validate entries individually. A single hand-edited bad entry must
    // NOT brick every tool — warn to stderr (naming the offending entry) and SKIP it,
    // keeping the rest of the registry usable. The ORIGINAL entry object is pushed on
    // success (not the parsed copy) so any extra/forward-compatible fields survive.
    const validated: ServerEntry[] = [];
    (parsed.servers as unknown[]).forEach((entry, i) => {
      if (isValidServerEntry(entry)) {
        validated.push(entry);
      } else {
        const name =
          entry && typeof entry === 'object' && 'name' in entry
            ? String((entry as Record<string, unknown>).name)
            : '(unnamed)';
        console.error(
          `[Legate] Skipping malformed registry entry at index ${i} (name: ${name}) — missing/invalid name, host, or port.`,
        );
      }
    });
    return { servers: validated };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { servers: [] };
    throw new Error(`could not parse ${registryPath}: ${(err as Error).message}`, { cause: err });
  }
}

export function writeRegistry(reg: Registry, registryPath: string = REGISTRY_PATH): void {
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
}

export function addServer(entry: ServerEntry, registryPath: string = REGISTRY_PATH): void {
  const reg = readRegistry(registryPath);
  const conflict = reg.servers.find(
    (s) => s.host === entry.host && s.port === entry.port && s.name !== entry.name,
  );
  if (conflict) {
    throw new Error(
      `Host/port conflict: '${conflict.name}' is already registered at ${entry.host}:${entry.port}. ` +
      `Each server must have a unique host:port combination.`,
    );
  }
  const existing = reg.servers.findIndex((s) => s.name === entry.name);
  if (existing !== -1) {
    console.error(`Updated existing server '${entry.name}'.`);
    reg.servers[existing] = entry;
  } else {
    reg.servers.push(entry);
  }
  writeRegistry(reg, registryPath);
}

export function removeServer(name: string, registryPath: string = REGISTRY_PATH): void {
  const reg = readRegistry(registryPath);
  const before = reg.servers.length;
  reg.servers = reg.servers.filter((s) => s.name !== name);
  if (reg.servers.length === before) {
    throw new Error(`no server named '${name}' in registry`);
  }
  writeRegistry(reg, registryPath);
  console.error(`Removed server '${name}'.`);
}

export function listServers(registryPath: string = REGISTRY_PATH): void {
  const reg = readRegistry(registryPath);
  if (reg.servers.length === 0) {
    console.log('No servers registered. Use: legate add-server <name> <host> <port> <model>');
    return;
  }
  console.log('NAME            HOST            PORT   PROVIDER        MODEL            CAPACITY');
  console.log('----            ----            ----   --------        -----            --------');
  const cell = (s: string, w: number): string => s.length > w - 1 ? s.slice(0, w - 4) + '...' : s.padEnd(w);
  for (const s of reg.servers) {
    console.log(cell(s.name, 16) + cell(s.host, 16) + cell(String(s.port), 7) + cell(s.providerID ?? '', 16) + cell(s.modelID ?? '', 17) + (s.maxSessions != null ? String(s.maxSessions) : 'unlimited'));
  }
}
