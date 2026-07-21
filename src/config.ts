// INFRA-02 + INFRA-03: Resolve the target OpenCode project directory.
// Extracted from index.ts to break the circular import:
//   index.ts → fetch.ts → autostart.ts → index.ts (was)
//   index.ts → fetch.ts → autostart.ts → config.ts (now — no cycle)

// legate-lcg: env chain + warn-once bookkeeping now lives in env.ts.
import { resolveEnv } from './env.js';

/**
 * Fallback chain: per-tool param → LEGATE_DEFAULT_PROJECT env var →
 * PREFECT_DEFAULT_PROJECT (deprecated, one-time warning) →
 * OPENCODE_DEFAULT_PROJECT (deprecated, one-time warning) → undefined.
 * Returns undefined (not process.cwd()) so OpenCode uses its own session-level
 * directory tracking when no explicit directory is provided.
 * process.env is read at call time (not module init) so that changes
 * to LEGATE_DEFAULT_PROJECT take effect without restarting the MCP server.
 * quietEmptyWarn preserves original behavior: an empty PREFECT_/OPENCODE_
 * fallback value still wins the chain (the `??` semantics), but does not
 * itself trigger the deprecation warning.
 */
export function resolveDirectory(perToolParam: string | undefined): string | undefined {
  return (
    perToolParam ??
    resolveEnv(['LEGATE_DEFAULT_PROJECT', 'PREFECT_DEFAULT_PROJECT', 'OPENCODE_DEFAULT_PROJECT'], {
      quietEmptyWarn: true,
    })
  );
}
