---
phase: 05-rename
reviewed: 2026-05-17T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - src/index.ts
  - src/auth.ts
  - src/config.ts
  - src/autostart.ts
  - src/sessions.ts
  - src/cli.ts
  - src/registry.ts
  - src/handlers.ts
  - src/fetch.ts
  - src/auth.test.ts
  - src/autostart.test.ts
  - src/sessions.test.ts
  - src/cli.test.ts
  - src/registry.test.ts
  - src/session-command.test.ts
  - package.json
findings:
  critical: 4
  warning: 4
  info: 4
  total: 12
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-05-17T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

This phase renames the project from "prefect" to "legate," introduces a three-tier deprecation chain (LEGATE_* > PREFECT_* > OPENCODE_*), and adds a one-time config-directory migration (`cpSync`). The deprecation chain logic itself is correct in `auth.ts` and `config.ts`, and the test coverage for those modules is thorough. However, four correctness/correctness-adjacent bugs surface, two in the brand migration and two in core session logic.

---

## Critical Issues

### CR-01: `legate-update.md` update command references wrong package name (`@momidala/legate` vs `legate`)

**File:** `src/cli.ts:40-42`
**Issue:** `LEGATE_UPDATE_COMMAND_CONTENT` embeds `npm install -g @momidala/legate@latest` and reads `@momidala/legate/package.json` in the version-detection script. But `package.json` sets `"name": "legate"` (no scope). The README install instructions (`npm install -g legate`) confirm the unscoped name. When a real user runs `/legate-update`, the command will fail with `npm ERR! 404 Not Found` because the scoped package does not exist on the registry. `src/cli.test.ts:505` asserts the broken string, so the test will continue to pass while the live behavior is broken.

**Fix:**
```typescript
// src/cli.ts — replace @momidala/legate with legate everywhere in LEGATE_UPDATE_COMMAND_CONTENT
const LEGATE_UPDATE_COMMAND_CONTENT = `Update the legate package to the latest version, then confirm and prompt restart.

Run this bash command:

\`\`\`bash
npm install -g legate@latest && \\
  NEW_VERSION=$(node --input-type=commonjs -e "const p=require('path');const cp=require('child_process');const root=cp.execSync('npm root -g',{encoding:'utf8'}).trim();const pkg=require(p.join(root,'legate/package.json'));process.stdout.write(pkg.version);") && \\
  echo "legate updated to v$NEW_VERSION. Restart Claude Code to apply."
\`\`\`
`;
// Also update the assertion in src/cli.test.ts:505:
// assert.match(content, /npm install -g legate@latest/);
```

---

### CR-02: Forked session inherits parent's `createdAt`, potentially expiring immediately

**File:** `src/index.ts:534`, `src/sessions.ts:91`
**Issue:** In `legate_fork`, the new session is persisted via:
```typescript
addSession((data as { id: string }).id, { ...sourceEntry, parentId: sessionId });
```
`sourceEntry` comes from `lookupSession(sessionId)` and already contains a `createdAt` timestamp. `addSession` does:
```typescript
map.sessions[sessionId] = { createdAt: Date.now(), ...entry };
```
In JavaScript object spread, later keys override earlier ones. `entry` is `{ ...sourceEntry, parentId }`, which contains `sourceEntry.createdAt`. This value lands **after** `Date.now()` in the spread and therefore wins. The forked session inherits the parent's creation time. If the parent session was created 23 hours ago and the default TTL is 24 hours, the fork will be pruned by the next `readSessionMap` call — 1 hour after forking instead of 24 hours after forking.

**Fix:**
```typescript
// src/index.ts:534 — explicitly set createdAt on the new session
if (data && sourceEntry) {
  const { createdAt: _discarded, ...inheritedEntry } = sourceEntry;
  addSession((data as { id: string }).id, { ...inheritedEntry, parentId: sessionId });
}
```
This ensures `addSession`'s own `Date.now()` stamp is used for the fork's TTL window.

---

### CR-03: Startup banner still brands as "Prefect" after rename

**File:** `src/index.ts:2002`
**Issue:** The startup message logged to stderr is:
```
Prefect MCP server running (OpenCode: ${BASE_URL})
```
This is the most visible user-facing signal of the server's identity. After the rename, it should say "Legate." Every user starting the server will see the old brand name, causing confusion about whether the rename took effect.

**Fix:**
```typescript
console.error(`Legate MCP server running (OpenCode: ${BASE_URL})`);
```

---

### CR-04: `legate_session_shell` tool description still says "Prefect layer"

**File:** `src/index.ts:1797`
**Issue:** The tool's MCP description — which is transmitted to Claude Code and displayed to users — reads:
> "there is no sandboxing at the **Prefect layer**"

This is a user-visible string exposed via the MCP protocol. After the rename it should say "Legate layer."

**Fix:**
```typescript
description: 'WARNING: Executes an arbitrary shell command in the context of an OpenCode session. The command runs in the session\'s working directory with the session\'s environment. Returns AssistantMessage containing command output. Use with caution — there is no sandboxing at the Legate layer. sessionId, agent, and command are all required. model override is optional.',
```

---

## Warnings

### WR-01: `LEGATE_SESSION_TTL_MS` with a non-numeric value silently disables session pruning

**File:** `src/sessions.ts:43`
**Issue:** `ttlMs = Number(legateVal)` — `Number('abc')` returns `NaN`. The subsequent comparison `now - entry.createdAt > NaN` always evaluates to `false`, so all sessions survive regardless of age. The caller gets no warning. Compare `autostart.ts:14-15` which safely uses `parseInt(legate, 10) || 30_000` to fall back to a default.

**Fix:**
```typescript
const legateVal = process.env.LEGATE_SESSION_TTL_MS;
if (legateVal !== undefined) {
  const parsed = parseInt(legateVal, 10);
  ttlMs = Number.isFinite(parsed) ? parsed : DEFAULT_SESSION_TTL_MS;
}
```
Apply the same pattern to the `prefectVal` branch at line 51.

---

### WR-02: `autostart.ts` and `sessions.ts` deprecation chains are asymmetric with `auth.ts` and `config.ts`

**File:** `src/autostart.ts:13-25`, `src/sessions.ts:41-55`
**Issue:** `auth.ts` and `config.ts` implement a full three-tier chain: `LEGATE_*` → `PREFECT_*` → `OPENCODE_*`. But `autostart.ts` only has two tiers (`LEGATE_AUTOSTART_TIMEOUT_MS` → `PREFECT_AUTOSTART_TIMEOUT_MS`, no `OPENCODE_AUTOSTART_TIMEOUT_MS`), and `sessions.ts` similarly only has two tiers for `SESSION_TTL_MS`. Likewise `index.ts` `resolveTimeoutMs` only falls back to `PREFECT_TIMEOUT_MS`, not `OPENCODE_TIMEOUT_MS`. If anyone was using `OPENCODE_AUTOSTART_TIMEOUT_MS` or `OPENCODE_SESSION_TTL_MS` or `OPENCODE_TIMEOUT_MS` with the old prefect package, their config will silently break without a deprecation warning.

**Fix:** Add the `OPENCODE_` fallback tier to each incomplete chain, matching the pattern in `auth.ts`:
```typescript
// autostart.ts — after the PREFECT_ check, add:
const opencode = process.env.OPENCODE_AUTOSTART_TIMEOUT_MS;
if (opencode !== undefined) {
  if (!warnedOldAutostart) {
    console.error('[Legate] OPENCODE_AUTOSTART_TIMEOUT_MS is deprecated, use LEGATE_AUTOSTART_TIMEOUT_MS');
    warnedOldAutostart = true;
  }
  return parseInt(opencode, 10) || 30_000;
}
```

---

### WR-03: Test helper `runCliAsGlobal` installs under stale `@momidala/prefect` path

**File:** `src/cli.test.ts:444-462`
**Issue:** `runCliAsGlobal` creates the fake global install under `node_modules/@momidala/prefect/build/` and writes `package.json` with `name: '@momidala/prefect'`. The actual package is named `legate`. The version-detection portion of the update command script (line 41 in `cli.ts`) looks for `@momidala/legate/package.json` in `npm root -g` — which would not match this fake install path if the script were ever executed. This is a test infrastructure inconsistency that may hide future regressions.

**Fix:**
```typescript
// src/cli.test.ts:444
const fakeGlobalRoot = join(homeDir, 'node_modules', 'legate');
// ...
writeFileSync(join(fakeGlobalRoot, 'package.json'), JSON.stringify({ name: 'legate', version: '0.0.0-test' }));
```

---

### WR-04: `PREFECT_SERVER_URL` deprecation warning variable is misleadingly named

**File:** `src/index.ts:16-24`
**Issue:** The warn-flag variable for the `PREFECT_SERVER_URL` deprecation is named `warnedServerUrl`. The name implies it guards both the `PREFECT_SERVER_URL` and `OPENCODE_URL` checks, but it only guards `PREFECT_SERVER_URL`; `OPENCODE_URL` uses the separate `warnedOpenCodeUrl` variable. A future reader may think `warnedServerUrl` prevents double-warnings for both old names and attempt to merge them, breaking the distinct-warning contract. The asymmetry only exists for this module since `BASE_URL` is computed once at module init (not in a call-time function), making the guard technically redundant anyway — the IIFE can only fire once regardless.

**Fix:** Rename `warnedServerUrl` to `warnedPrefectServerUrl` to match the naming pattern in `auth.ts` (`warnedPrefectPassword`, `warnedPrefectUsername`).

---

## Info

### IN-01: No test coverage for the `OPENCODE_SERVER_PASSWORD` / `OPENCODE_USERNAME` deprecation warnings (third tier)

**File:** `src/auth.test.ts`
**Issue:** The test file thoroughly covers the `PREFECT_*` tier (one-time warning, dedup, precedence). But there are no tests asserting that the `OPENCODE_SERVER_PASSWORD` or `OPENCODE_SERVER_USERNAME` deprecation warnings fire. All tests that set `OPENCODE_SERVER_PASSWORD` clear it first, so the `OPENCODE_*` branch is exercised only incidentally (the `warnedPassword` flag is reset but the warning text is never asserted). A regression in the third tier would go undetected.

**Fix:** Add three tests matching the PREFECT tier pattern for `OPENCODE_SERVER_PASSWORD` (fires once, deduplicates, suppressed when LEGATE_* is set) and a matching set for `OPENCODE_SERVER_USERNAME`.

---

### IN-02: Duplicate migration logic runs independently in `registry.ts` and `sessions.ts`

**File:** `src/registry.ts:21-25`, `src/sessions.ts:31-35`
**Issue:** Both modules contain nearly identical top-level migration blocks. They both check `!existsSync(~/.config/legate) && existsSync(~/.config/prefect)` and call `cpSync`. In a single process, the first module to initialize will create the `legate` directory, and the second will see it already exists and skip. This works correctly in practice but the duplicated logic is fragile: if either module is used without the other (e.g., in a standalone script), only a partial migration occurs. The code comment in both files says "one-time migration" but gives no indication that it's duplicated.

**Fix:** Extract the migration into a shared utility (e.g., `src/migrate.ts`) and call it once from the entry point `src/index.ts`.

---

### IN-03: Multiple tool descriptions still reference `OPENCODE_DEFAULT_PROJECT` instead of `LEGATE_DEFAULT_PROJECT`

**File:** `src/index.ts:160, 205, 323, 421, 465, 505, 552, 938, 1001, 1100, 1193, 1250, 1350, 1379, 1406, 1409` (and more)
**Issue:** Approximately half the tool descriptions say `Falls back to OPENCODE_DEFAULT_PROJECT env var` and the other half say `Falls back to LEGATE_DEFAULT_PROJECT env var`. The actual fallback chain in `config.ts` uses `LEGATE_DEFAULT_PROJECT` first. The `OPENCODE_DEFAULT_PROJECT` references in descriptions are technically correct (the old name is still accepted with a deprecation warning), but they are inconsistent with the brand rename and will direct users toward the deprecated variable name.

**Fix:** Globally replace `OPENCODE_DEFAULT_PROJECT env var` with `LEGATE_DEFAULT_PROJECT env var` in all `inputSchema` descriptions in `src/index.ts`.

---

### IN-04: `package.json` `"name"` is unscoped `"legate"` but `publishConfig` sets `"access": "public"`

**File:** `package.json:2, 19-21`
**Issue:** `"access": "public"` in `publishConfig` is meaningful only for scoped packages (e.g., `@scope/pkg`). For unscoped packages like `"legate"`, it is a no-op — unscoped packages are always public. The presence of this field (combined with the `@momidala/legate` string in `cli.ts` and `@momidala/prefect` in `cli.test.ts`) suggests the intended published name may be `@momidala/legate` but was not set in `package.json` during the rename. If the package is meant to be scoped, the `name` field must be corrected.

**Fix:** Decide on the canonical publish name and apply it consistently:
- If publishing as `legate` (unscoped): remove `publishConfig`, update `cli.ts` to use `legate@latest` / `legate/package.json`, update `cli.test.ts` helper path.
- If publishing as `@momidala/legate` (scoped): set `"name": "@momidala/legate"` in `package.json`, keep `publishConfig.access: "public"`.

---

_Reviewed: 2026-05-17T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
