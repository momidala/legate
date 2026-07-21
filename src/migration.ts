import { existsSync, cpSync } from 'node:fs';

/**
 * One-time config migration helper shared by sessions.ts and registry.ts (legate-5di).
 *
 * Copies `oldDir` → `newDir` recursively when `sentinelFile` does NOT yet exist and
 * `oldDir` does exist. The copy is best-effort: any failure is swallowed (non-fatal)
 * to match the original inline behavior — a failed migration must never crash startup.
 *
 * The guard MUST be on a FILE (the sentinel), not a directory. The `~/.config/legate/`
 * directory is pre-created by `legate add-server` before the MCP ever runs, so a
 * directory-existence guard would see the dir already present and silently skip the
 * migration on any machine that used the CLI before the prefect→legate rename.
 * Guarding on the actual data file (sessions.json / servers.json) is the correct signal
 * for "has this config been migrated yet?".
 *
 * @param sentinelFile absolute path to the file whose presence means "already migrated"
 * @param oldDir       absolute path to the legacy config directory to copy FROM
 * @param newDir       absolute path to the config directory to copy INTO
 */
export function migrateIfNeeded(sentinelFile: string, oldDir: string, newDir: string): void {
  if (!existsSync(sentinelFile) && existsSync(oldDir)) {
    // Preserve prior semantics: copy even when newDir already exists (cpSync merges).
    try {
      cpSync(oldDir, newDir, { recursive: true });
    } catch {
      /* non-fatal */
    }
  }
}
