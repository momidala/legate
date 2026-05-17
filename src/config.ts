// INFRA-02 + INFRA-03: Resolve the target OpenCode project directory.
// Extracted from index.ts to break the circular import:
//   index.ts → fetch.ts → autostart.ts → index.ts (was)
//   index.ts → fetch.ts → autostart.ts → config.ts (now — no cycle)

let warnedDefaultProject = false;
let warnedPrefectDefaultProject = false;

/**
 * Fallback chain: per-tool param → LEGATE_DEFAULT_PROJECT env var →
 * PREFECT_DEFAULT_PROJECT (deprecated, one-time warning) →
 * OPENCODE_DEFAULT_PROJECT (deprecated, one-time warning) → undefined.
 * Returns undefined (not process.cwd()) so OpenCode uses its own session-level
 * directory tracking when no explicit directory is provided.
 * process.env is read at call time (not module init) so that changes
 * to LEGATE_DEFAULT_PROJECT take effect without restarting the MCP server.
 */
export function resolveDirectory(perToolParam: string | undefined): string | undefined {
  return (
    perToolParam ??
    process.env.LEGATE_DEFAULT_PROJECT ??
    (() => {
      const prefect = process.env.PREFECT_DEFAULT_PROJECT;
      if (prefect && !warnedPrefectDefaultProject) {
        console.error('[Legate] PREFECT_DEFAULT_PROJECT is deprecated, use LEGATE_DEFAULT_PROJECT');
        warnedPrefectDefaultProject = true;
      }
      return prefect;
    })() ??
    (() => {
      const old = process.env.OPENCODE_DEFAULT_PROJECT;
      if (old && !warnedDefaultProject) {
        console.error('[Legate] OPENCODE_DEFAULT_PROJECT is deprecated, use LEGATE_DEFAULT_PROJECT');
        warnedDefaultProject = true;
      }
      return old;
    })()
  );
}
