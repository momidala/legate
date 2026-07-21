// legate-hry: explicit startup migrations.
//
// sessions.ts and registry.ts previously ran their one-time ~/.config/prefect →
// ~/.config/legate migration as a MODULE-LOAD SIDE EFFECT (a top-level call the instant
// the module was imported). That made every importer — including the source-parsing
// tests and any tool that merely reads sessions.json — trigger a filesystem copy on
// import. This module hoists both migrations behind a single explicit entry point that
// the two real process entry points (the MCP server main() in index.ts and the CLI in
// cli.ts) call once at startup, BEFORE any config read. Behavior is unchanged; only the
// trigger moved from "on import" to "on startup".
//
// legate-hry: this module imports ONLY migration.js and registry.js (both lightweight —
// no proper-lockfile) and derives the sessions.json path itself, deliberately NOT
// importing sessions.ts. The CLI (cli.ts) calls runStartupMigrations() but must stay
// importable from an isolated install that has no proper-lockfile; sessions.ts pulls in
// proper-lockfile, so importing it here would break that. The path derivation reuses
// REGISTRY_PATH for the config dir so only the stable filenames stay as literals — the
// same literals sessions.ts/registry.ts already hardcode.
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { migrateIfNeeded } from './migration.js';
import { REGISTRY_PATH } from './registry.js';

// ~/.config/legate — the migration destination (derived from REGISTRY_PATH so it never
// drifts from registry.ts's REGISTRY_DIR).
const CONFIG_DIR = dirname(REGISTRY_PATH);
// ~/.config/legate/sessions.json — mirrors sessions.ts's SESSIONS_PATH.
const SESSIONS_PATH = join(CONFIG_DIR, 'sessions.json');
// Legacy config directory (pre prefect→legate rename). Both migrations copy FROM here.
const OLD_CONFIG_DIR = join(homedir(), '.config', 'prefect');

/**
 * Run the one-time config migrations. Idempotent and best-effort: each migration is
 * guarded on its own data file (sessions.json / servers.json) and swallows copy errors,
 * so calling this repeatedly — or on a machine that never used prefect — is a no-op.
 * MUST be invoked before the first readSessionMap/readRegistry in real operation.
 *
 * Equivalent to the old sessions._runMigration + registry._runRegistryMigration pair:
 * migrateIfNeeded(sentinel, oldDir, newDir) with newDir = ~/.config/legate.
 */
export function runStartupMigrations(): void {
  migrateIfNeeded(SESSIONS_PATH, OLD_CONFIG_DIR, CONFIG_DIR);
  migrateIfNeeded(REGISTRY_PATH, OLD_CONFIG_DIR, CONFIG_DIR);
}
