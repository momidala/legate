import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

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

const REGISTRY_DIR = join(homedir(), '.config', 'prefect');
export const REGISTRY_PATH = join(REGISTRY_DIR, 'servers.json');

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
    throw new Error(`could not parse ${registryPath}: ${(err as Error).message}`);
  }
}

export function writeRegistry(reg: Registry, registryPath: string = REGISTRY_PATH): void {
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
}

export function addServer(entry: ServerEntry, registryPath: string = REGISTRY_PATH): void {
  const reg = readRegistry(registryPath);
  const existing = reg.servers.findIndex((s) => s.name === entry.name);
  if (existing !== -1) {
    console.log(`Updated existing server '${entry.name}'.`);
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
  console.log(`Removed server '${name}'.`);
}

export function listServers(registryPath: string = REGISTRY_PATH): void {
  const reg = readRegistry(registryPath);
  if (reg.servers.length === 0) {
    console.log('No servers registered. Use: prefect add-server <name> <host> <port> <model>');
    return;
  }
  console.log('NAME            HOST            PORT   PROVIDER        MODEL            CAPACITY');
  console.log('----            ----            ----   --------        -----            --------');
  const cell = (s: string, w: number): string => s.length > w - 1 ? s.slice(0, w - 4) + '...' : s.padEnd(w);
  for (const s of reg.servers) {
    console.log(cell(s.name, 16) + cell(s.host, 16) + cell(String(s.port), 7) + cell(s.providerID ?? '', 16) + cell(s.modelID ?? '', 17) + (s.maxSessions != null ? String(s.maxSessions) : 'unlimited'));
  }
}
