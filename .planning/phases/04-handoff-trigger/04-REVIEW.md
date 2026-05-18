---
phase: 04-handoff-trigger
reviewed: 2026-05-13T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - AGENTS.md
  - CLAUDE.md
  - package.json
  - src/cli.test.ts
  - src/cli.ts
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-05-13
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This milestone added two CLI subcommands (`install-command`, `uninstall-command`) that manage a `/prefect-update` slash command in the user's Claude Code installation, wired to a `postinstall` npm lifecycle hook for automatic setup on global installs. It also added checkpoint/handoff schemas to `AGENTS.md`.

The implementation has two blockers: the `isGlobal` detection logic produces a false positive for locally-installed packages, causing `postinstall` to write `~/.claude/commands/prefect-update.md` on every `npm install` in any project that depends on this package; and there is no `preuninstall` lifecycle hook, so `uninstall-command` is never automatically called during `npm uninstall -g`, leaving the installed command file orphaned.

---

## Critical Issues

### CR-01: `isGlobal` detection fires for local installs — `postinstall` writes to `~/.claude/commands/` for every consumer project

**File:** `src/cli.ts:16`

**Issue:** The global-install detection:

```typescript
const isGlobal = __dirname.replace(/\\/g, '/').includes('/node_modules/');
```

is true for **any** path containing `/node_modules/`, including a locally-installed copy in a consumer project (`/home/user/myproject/node_modules/@momidala/prefect/build`). Since `package.json` runs `postinstall: node ./build/cli.js install-command` on every `npm install`, this means:

1. Any project that adds `@momidala/prefect` as a local dependency will have `~/.claude/commands/prefect-update.md` silently written to the user's home directory without consent.
2. The design intent — "global installs only" — is violated for every local install.

The correct test is whether the package is installed under a **global** npm prefix, not merely under any `node_modules` tree.

**Fix:** Use the `npm_config_global` environment variable npm sets during lifecycle hooks, or compare against the npm global prefix:

```typescript
// Option A: npm sets npm_config_global='true' during 'npm install -g'
const isGlobal = process.env.npm_config_global === 'true';

// Option B: compare __dirname against npm global root (cross-platform)
// import { execSync } from 'node:child_process';
// const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
// const isGlobal = __dirname.startsWith(globalRoot);
```

Option A is simpler and has no subprocess cost. Note that when `install-command`/`uninstall-command` are invoked directly by a user (not via lifecycle hook), `npm_config_global` will be undefined, so the command will silently skip — which is safe behavior and matches the intent.

The `runCliAsGlobal` test helper must also be updated: instead of placing files under `node_modules/`, pass `npm_config_global: 'true'` in the spawned process environment.

---

### CR-02: Missing `preuninstall` lifecycle hook — `/prefect-update` command file is orphaned on uninstall

**File:** `package.json:22-26`

**Issue:** `package.json` wires `postinstall` to `install-command` but has no corresponding `preuninstall` (or `uninstall`) hook wired to `uninstall-command`. When a user runs `npm uninstall -g @momidala/prefect`, the `~/.claude/commands/prefect-update.md` file is never removed. The subcommand `uninstall-command` exists and is implemented correctly, but it is never automatically invoked.

```json
"scripts": {
  "build": "tsc && chmod 755 build/index.js build/cli.js",
  "test": "...",
  "postinstall": "node ./build/cli.js install-command"
  // missing: "preuninstall": "node ./build/cli.js uninstall-command"
}
```

**Fix:**

```json
"scripts": {
  "build": "tsc && chmod 755 build/index.js build/cli.js",
  "test": "...",
  "postinstall": "node ./build/cli.js install-command",
  "preuninstall": "node ./build/cli.js uninstall-command"
}
```

Note: `preuninstall` (not `postuninstall`) is needed because the binary files are still present when `preuninstall` runs; `postuninstall` runs after the files are removed and the node invocation would fail.

---

## Warnings

### WR-01: TOCTOU race in `handleUninstallCommand` — `existsSync` + `rmSync` is not atomic

**File:** `src/cli.ts:174`

**Issue:** The check-then-delete pattern:

```typescript
if (existsSync(dest)) rmSync(dest);
```

has a time-of-check/time-of-use race: another process could create or remove the file between `existsSync` and `rmSync`. On a single-user workstation the window is tiny, but the correct pattern exists in Node's API.

**Fix:** Use `rmSync` with the `force` option, which suppresses the `ENOENT` error when the file is absent — removing the need for the pre-check entirely:

```typescript
rmSync(dest, { force: true });
```

---

### WR-02: `runCliAsGlobal` test helper silently omits missing build artifacts — tests can pass with stale build

**File:** `src/cli.test.ts:455-459`

**Issue:** The helper conditionally copies build files:

```typescript
const buildFiles = ['cli.js', 'registry.js'];
for (const f of buildFiles) {
  const srcPath = join(srcBuildDir, f);
  if (existsSync(srcPath)) {          // <-- silent skip
    writeFileSync(join(fakeBuildDir, f), readFileSync(srcPath, 'utf8'));
  }
}
```

If `build/cli.js` does not exist (e.g., `npm run build` has not been run), the fake global CLI at `fakeCli` is a non-existent path. `spawnSync` will then fail with a process-level error (`res.error` is set, `res.status` is `null`). The helper returns `status: -1`, causing downstream test assertions to fail with misleading messages like "expected exit 0, got -1" rather than "build artifact missing."

The top of the file already handles the normal `CLI` path with a hard `throw`:

```typescript
if (!existsSync(CLI)) {
  throw new Error(`Build artifact missing: run 'npm run build' first`);
}
```

The same guard should apply inside `runCliAsGlobal`.

**Fix:**

```typescript
for (const f of buildFiles) {
  const srcPath = join(srcBuildDir, f);
  if (!existsSync(srcPath)) {
    throw new Error(`Build artifact missing: ${srcPath} — run 'npm run build' first`);
  }
  writeFileSync(join(fakeBuildDir, f), readFileSync(srcPath, 'utf8'));
}
```

---

### WR-03: `PREFECT_UPDATE_COMMAND_CONTENT` uses `require()` in ESM-hostile environments — brittle version-detection script

**File:** `src/cli.ts:42-44`

**Issue:** The embedded bash command uses a `node -e` inline script that relies on CommonJS `require()`:

```bash
node -e "const p=require('path');const cp=require('child_process');const root=cp.execSync('npm root -g',{encoding:'utf8'}).trim();const pkg=require(p.join(root,'@momidala/prefect/package.json'));process.stdout.write(pkg.version);"
```

This works today because bare `node -e` defaults to CJS. However:

1. If the user has `NODE_OPTIONS=--experimental-vm-modules` or a `package.json` with `"type":"module"` in scope, this could fail.
2. The approach shells out to `npm root -g` as a subprocess within a subprocess, which is fragile and adds latency. If npm is not on PATH at the time the Claude slash command is invoked (e.g., in a restricted shell or sandboxed environment), the version string silently becomes empty.
3. `process.stdout.write` (no newline) inside the subshell substitution could produce unexpected behavior if the outer `echo` doesn't flush correctly on all platforms.

**Fix:** A more robust approach avoids the npm subprocess entirely by reading the version from the installed package.json directly using a glob or well-known path:

```bash
node --input-type=commonjs -e "const root=require('child_process').execSync('npm root -g',{encoding:'utf8'}).trim();process.stdout.write(require(require('path').join(root,'@momidala/prefect/package.json')).version)"
```

Using `--input-type=commonjs` makes the CJS intent explicit and immune to `NODE_OPTIONS` interference. Alternatively, use `npm show @momidala/prefect version` which is simpler and already in PATH context, though it reads from the registry rather than the installed copy.

---

## Info

### IN-01: `AGENTS.md` and `CLAUDE.md` (new section) lack trailing newline

**File:** `AGENTS.md:116`, `CLAUDE.md:127`

**Issue:** `AGENTS.md` ends without a trailing newline (confirmed by `xxd` — last byte is `.` with no `\n`). Git diff also shows `\ No newline at end of file` for the AGENTS.md addition. POSIX text files require a trailing newline; many tools (diff, cat, grep) behave unexpectedly on files without one.

**Fix:** Append a newline to both files:
```bash
echo "" >> AGENTS.md   # adds trailing newline
```
Or edit the final line in each file to ensure it ends with `\n`.

---

### IN-02: `handleInstallCommand` provides no success feedback when run directly by a user

**File:** `src/cli.ts:163-164`

**Issue:** When a user manually runs `prefect install-command` in a global install context, the command exits 0 with no output — no confirmation that `~/.claude/commands/prefect-update.md` was created or where it was written. Contrast with `add-server` which prints `Registered server 'local' at ...` to stderr.

This is intentionally silent for the `postinstall` use case (npm lifecycle hooks should be quiet), but makes the command opaque when used interactively.

**Fix:** Add a stderr confirmation on success, guarded to avoid noise during lifecycle hook execution. One approach: check `process.env.npm_lifecycle_event` to distinguish hook vs. direct invocation:

```typescript
if (!process.env.npm_lifecycle_event) {
  console.error(`Installed /prefect-update command to ${dest}`);
}
```

---

_Reviewed: 2026-05-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
