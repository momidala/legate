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
 * @internal — exported for testing only. Mirrors sessions._runMigration.
 */
export function _runRegistryMigration(newPath: string, oldDir: string): void {
  migrateIfNeeded(newPath, oldDir, dirname(newPath));
}

const OLD_REGISTRY_DIR = join(homedir(), '.config', 'prefect');
_runRegistryMigration(REGISTRY_PATH, OLD_REGISTRY_DIR);

export function readRegistry(registryPath: string = REGISTRY_PATH): Registry {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.servers)) {
      throw new Error(`malformed registry at ${registryPath}: expected { servers: [...] }`);
    }
    return parsed as Registry;
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
