// legate-4ah: shared test-only helpers factoring out the three try/finally
// patterns that were hand-copied (~30x) across auth.test.ts, autostart.test.ts,
// sessions.test.ts, env.test.ts, and fetch.test.ts:
//   - withEnv: set/delete env vars for the duration of fn, restore exact prior
//     state (set vs unset) afterward.
//   - withMockedFetch: swap globalThis.fetch for the duration of fn, restore after.
//   - captureWarnings: swap console.error for the duration of fn, collect the
//     string-joined args, restore after, and return both the warnings and fn's result.
//
// IMPORTANT: this file is named `testutil.ts`, NOT `test-helpers.ts`. Node's
// `--test` runner discovers test files by several glob patterns, one of which is
// `test-*.js` — a file named `test-helpers.js` would itself be picked up and run
// as a (trivially passing, empty) test by `node --test build/`. `testutil.js`
// matches none of the discovery patterns, confirmed empirically against this
// Node version before committing to the name.
//
// All three helpers accept a sync-or-async `fn` and return a Promise, so they
// compose freely via nesting (withEnv(..., () => withMockedFetch(..., () => ...))).

/**
 * Sets/deletes `vars` on `process.env` for the duration of `fn`, then restores
 * each variable to its exact prior state — deleted if it was previously unset,
 * re-assigned to its prior value otherwise. `undefined` in `vars` means "delete
 * this var for the duration of fn".
 */
export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(vars)) {
    prev[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/**
 * Swaps `globalThis.fetch` for `mock` for the duration of `fn`, restoring the
 * original afterward.
 */
export async function withMockedFetch<T>(
  mock: (req: Request) => Promise<Response>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const orig = globalThis.fetch;
  (globalThis as unknown as Record<string, unknown>).fetch = mock;
  try {
    return await fn();
  } finally {
    (globalThis as unknown as Record<string, unknown>).fetch = orig;
  }
}

/**
 * Swaps `console.error` for the duration of `fn`, collecting each call's args
 * (String()'d and space-joined, matching `console.error`'s own formatting) into
 * `warnings`. Restores the original afterward. Returns both the collected
 * warnings and fn's return value.
 */
export async function captureWarnings<T>(fn: () => T | Promise<T>): Promise<{ warnings: string[]; result: T }> {
  const warnings: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    const result = await fn();
    return { warnings, result };
  } finally {
    console.error = orig;
  }
}
