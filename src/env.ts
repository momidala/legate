// legate-lcg: centralizes the LEGATE_* -> PREFECT_* (deprecated) -> OPENCODE_*
// (deprecated) env-var fallback chain that was previously hand-copied, with its
// own per-variable warn-once boolean flags, in five files (index.ts x2, config.ts,
// auth.ts x2, autostart.ts, sessions.ts). One warn-once Set replaces all of those
// booleans; _resetWarnFlags() is the single test hook every call site delegates to.

const warnedNames = new Set<string>();

export interface ResolveEnvOptions {
  /**
   * When true, only a truthy (non-empty) value counts as "set" for BOTH selection
   * and the deprecation warning — falsy/empty values are skipped over as if unset.
   * Matches call sites that originally gated on `if (val)` rather than
   * `val !== undefined` (e.g. index.ts's old resolveTimeoutMs: an empty
   * LEGATE_TIMEOUT_MS fell through to PREFECT_TIMEOUT_MS silently, and a truthy
   * PREFECT_TIMEOUT_MS always warned).
   */
  requireTruthy?: boolean;
  /**
   * When true (and requireTruthy is false), a winning value that is falsy/empty
   * does NOT trigger the deprecation warning even though it came from a
   * non-primary name — selection still follows the `!== undefined` chain (an
   * empty fallback value still wins and is returned), only the warning is
   * suppressed. Matches call sites that used `??` for selection but a
   * truthy-gated `if (old && !warned)` for the warning itself (index.ts's
   * BASE_URL, auth.ts's buildAuthHeader, config.ts's resolveDirectory).
   */
  quietEmptyWarn?: boolean;
}

interface ResolvedEntry {
  name: string;
  value: string;
}

// Shared chain-walk used by resolveEnv/resolveEnvInt/resolveEnvNum. Returns which
// name won (needed by resolveEnvInt's invalid-value warning) alongside its value.
function resolveEnvEntry(names: string[], options: ResolveEnvOptions = {}): ResolvedEntry | undefined {
  for (const name of names) {
    const value = process.env[name];
    const isSet = options.requireTruthy ? Boolean(value) : value !== undefined;
    if (!isSet) continue;
    if (name !== names[0]) {
      const shouldWarn = options.quietEmptyWarn ? Boolean(value) : true;
      if (shouldWarn && !warnedNames.has(name)) {
        warnedNames.add(name);
        console.error(`[Legate] ${name} is deprecated, use ${names[0]}`);
      }
    }
    return { name, value: value as string };
  }
  return undefined;
}

/**
 * Returns the first defined env var value across `names` (in priority order).
 * When the winning name is not `names[0]`, emits a one-time-per-name stderr
 * deprecation warning: `[Legate] <OLD> is deprecated, use <names[0]>`.
 * See ResolveEnvOptions for the empty-string-handling nuances preserved from
 * each original call site.
 */
export function resolveEnv(names: string[], options?: ResolveEnvOptions): string | undefined {
  return resolveEnvEntry(names, options)?.value;
}

/**
 * resolveEnv + parseInt(10) with validation. legate-lcg: this is a deliberate
 * improvement over the old per-file pattern `parseInt(v, 10) || default`, which
 * silently swallowed 0 (falls through to `|| default` with no warning) AND
 * silently accepted negative values as-is. Now: NaN or <= 0 emits a one-time
 * stderr warning and falls back to `defaultValue`.
 */
export function resolveEnvInt(names: string[], defaultValue: number, options?: ResolveEnvOptions): number {
  const entry = resolveEnvEntry(names, options);
  if (!entry) return defaultValue;
  const n = parseInt(entry.value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    const warnKey = `invalid:${entry.name}`;
    if (!warnedNames.has(warnKey)) {
      warnedNames.add(warnKey);
      console.error(
        `[Legate] ${entry.name}=${entry.value} is invalid — must be a positive integer; using default ${defaultValue}`,
      );
    }
    return defaultValue;
  }
  return n;
}

/**
 * resolveEnv + Number() with only a finite check — NO positivity validation.
 * Kept deliberately separate from resolveEnvInt for sessions.ts's session TTL:
 * a TTL of 0 ("prune everything immediately") and negative TTLs are accepted
 * as-is today, and this issue does not change that behavior — only NaN/Infinity
 * fall back to `defaultValue`.
 */
export function resolveEnvNum(names: string[], defaultValue: number, options?: ResolveEnvOptions): number {
  const entry = resolveEnvEntry(names, options);
  if (!entry) return defaultValue;
  const n = Number(entry.value);
  return Number.isFinite(n) ? n : defaultValue;
}

/** @internal — test use only. Resets all warn-once state (deprecation + invalid-value). */
export function _resetWarnFlags(): void {
  warnedNames.clear();
}
