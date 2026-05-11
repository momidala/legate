---
phase: 02-self-update
reviewed: 2026-05-11T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/cli.ts
  - src/cli.test.ts
  - package.json
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

The three files cover the new self-update CLI feature (`install-command` / `uninstall-command`), the multi-server `add-server` extension (`--max-sessions`), and the `updateClaudemdWorkers` helper that keeps `CLAUDE.md` in sync. The code is generally well-structured and the test suite is thorough.

Three warnings were found: one logic bug in the `updateClaudemdWorkers` section-replacement path that can silently corrupt the `CLAUDE.md` file (blank lines lost / wrong join boundary), one missing-await / unhandled-rejection risk in `package.json`'s `postinstall` / `preuninstall` lifecycle hooks, and one unsafe `--max-sessions` argument parsing edge case where the flag appears at the very end of the argument list. Three informational findings cover a duplicate `version` command code path, a `runInit` helper in the test file that ignores `stdout`, and a magic `node_modules/` path-segment string used for global detection.

---

## Warnings

### WR-01: Off-by-one in `updateClaudemdWorkers` — section replacement joins with wrong boundary, can duplicate or drop a blank line

**File:** `src/cli.ts:70-74`

**Issue:** When the `## Available Workers` section already exists and a subsequent `##` heading follows it, the replacement logic constructs:

```ts
updated = [
  ...fileLines.slice(0, startIdx),
  ...newSection.split('\n'),
  ...(tail.length > 0 ? ['', ...tail] : []),
].join('\n');
```

`newSection` is built as `` `## Available Workers\n\n${sectionContent}\n` ``. Splitting that on `\n` produces a trailing empty string as the last element (because the string ends with `\n`). The code then unconditionally prepends `''` before `tail`, so the join produces a double blank line (`\n\n`) separating the replaced section from the next heading. In contrast, when the section is absent (the append path on line 65), a single separator is added intentionally. The inconsistency means repeated `add-server` / `remove-server` calls will accumulate blank lines between the `## Available Workers` block and whatever follows it — confirmed by the normalized-newline test at line 307 which only checks the file *end*, not mid-file separators.

**Fix:**
```ts
// newSection already ends with \n, so split produces ['## Available Workers', '', ...content, ''].
// Drop the trailing empty element before appending tail to avoid the double blank line.
const newSectionLines = newSection.split('\n');
// Remove the trailing empty string that results from the final \n
if (newSectionLines[newSectionLines.length - 1] === '') newSectionLines.pop();

updated = [
  ...fileLines.slice(0, startIdx),
  ...newSectionLines,
  ...(tail.length > 0 ? ['', ...tail] : []),
].join('\n');
```

---

### WR-02: `--max-sessions` flag at end of args list reads `undefined` as the value — parsed as `NaN`, bypasses regex guard

**File:** `src/cli.ts:101-109`

**Issue:** The guard on line 103 is:

```ts
if (!/^\d+$/.test(maxSessionsStr) || parseInt(maxSessionsStr, 10) < 1) {
```

When `--max-sessions` is the very last token in `handlerArgs`, `handlerArgs[maxSessionsIdx + 1]` is `undefined`. The nullish coalescing on line 102 converts this to `''`. The regex `/^\d+$/` correctly rejects `''`, so the error path fires — but the error message emitted is:

```
Error: invalid --max-sessions '' — must be a positive integer
```

This is confusing: the user provided `--max-sessions` with no value but the error message shows an empty string rather than "missing value". More importantly, when the flag accidentally ends up adjacent to another flag (e.g. `--max-sessions --other-flag`), `--other-flag` becomes the "value string", passes the regex if it happens to match (it won't here, but the logic is fragile). The real risk is the UX confusion and future accidental bypass.

**Fix:**
```ts
const maxSessionsStr = handlerArgs[maxSessionsIdx + 1];
if (maxSessionsStr === undefined || maxSessionsStr.startsWith('--')) {
  console.error(`Error: --max-sessions requires a value`);
  process.exit(1);
}
if (!/^\d+$/.test(maxSessionsStr) || parseInt(maxSessionsStr, 10) < 1) {
  console.error(`Error: invalid --max-sessions '${maxSessionsStr}' — must be a positive integer`);
  process.exit(1);
}
```

---

### WR-03: `postinstall` / `preuninstall` lifecycle hooks call `prefect` synchronously but errors from that child process are silently swallowed by npm

**File:** `package.json:25-26`

**Issue:**

```json
"postinstall": "prefect install-command",
"preuninstall": "prefect uninstall-command"
```

The `handleInstallCommand` function intentionally exits `0` on all errors (per design note D-07), so npm will never see a non-zero exit. This is correct for the user-facing goal of not blocking installs. However, if `prefect` is not yet on `PATH` when `postinstall` runs (race condition with npm symlinking bin entries in global installs), npm will fail with `command not found`. On some platforms / npm versions, global bin entries are symlinked after `postinstall` runs, meaning the hook runs before the binary is available.

The safer approach used by many packages is to invoke the script directly via `node` so it does not depend on PATH resolution:

**Fix:**
```json
"postinstall": "node ./build/cli.js install-command || true",
"preuninstall": "node ./build/cli.js uninstall-command || true"
```

The `|| true` ensures npm never sees a failure exit (though `handleInstallCommand` already exits 0; this is belt-and-suspenders). Using `node ./build/cli.js` removes the PATH dependency entirely.

---

## Info

### IN-01: Duplicate `version` subcommand implementation

**File:** `src/cli.ts:197-201` and `src/cli.ts:262-265`

**Issue:** The `--version` / `-v` flag handling at line 197 and the `version` switch case at line 262 both read `package.json` and print the version with `console.log`. The logic is identical and duplicated. If the version display logic ever changes (e.g., adding a `v` prefix or colorizing), it must be updated in two places.

**Fix:** Extract a `printVersion()` helper called from both sites, or consolidate by falling through:

```ts
// Near top of switch, before the default:
case 'version':
// ... falls through to the flag handler above, or:
function printVersion(): never {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  console.log(version);
  process.exit(0);
}
```

---

### IN-02: `runInit` test helper silently discards `stdout`

**File:** `src/cli.test.ts:17-20`

**Issue:** `runInit` captures only `status` and `stderr`, dropping `stdout`. Several tests that use `runInit` (Cases 1–5) later read `.mcp.json` directly to verify output, which is correct. However, if the `init` subcommand ever starts writing informational content to `stdout` (e.g., a path message), those tests would not catch regressions. There is also no test verifying that `init` is silent on `stdout` — only `stderr` is checked in the existing cases.

**Fix:** Either extend `runInit` to return `stdout` and add a `assert.equal(stdout, '')` assertion in each init test, or add a dedicated test:

```ts
function runInit(cwd: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}
```

---

### IN-03: Global install detection relies on a hardcoded path-segment string

**File:** `src/cli.ts:16`

**Issue:**

```ts
const isGlobal = __dirname.replace(/\\/g, '/').includes('/node_modules/');
```

The string `'/node_modules/'` is a magic literal. On non-standard npm setups (e.g., pnpm with `node_modules/.pnpm/`, Bun, Yarn PnP), the path may differ or the segment may not appear at all, causing `isGlobal` to incorrectly be `false` for a global install (or `true` for a workspace-local install in a monorepo with `node_modules` in the path). The comment at line 13 acknowledges this approach but does not document the failure modes.

**Fix:** Consider also checking for `node_modules/@` or using an environment variable flag set at install time. At minimum, document the known-unsupported package manager cases in the comment:

```ts
// NOTE: This heuristic works for npm global installs.
// pnpm global installs place files under ~/.local/share/pnpm/... — no node_modules segment.
// For pnpm, isGlobal will be false even for global installs; install-command is then a no-op.
// This is acceptable: pnpm users can run `prefect install-command` manually.
const isGlobal = __dirname.replace(/\\/g, '/').includes('/node_modules/');
```

---

_Reviewed: 2026-05-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
