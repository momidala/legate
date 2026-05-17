---
phase: 05-rename
plan: "02b"
subsystem: api
tags:
  - typescript
  - rename
  - env-vars
  - deprecation
  - cli

dependency_graph:
  requires:
    - phase: 05-rename/05-01
      provides: RED deprecation warning tests for auth/autostart/sessions
    - phase: 05-rename/05-02
      provides: package.json + src/index.ts renamed to legate
  provides:
    - src/auth.ts three-tier LEGATE_->PREFECT_(warn)->OPENCODE_(warn) for SERVER_PASSWORD/USERNAME
    - src/config.ts three-tier LEGATE_->PREFECT_(warn)->OPENCODE_(warn) for DEFAULT_PROJECT
    - src/autostart.ts two-tier LEGATE_->PREFECT_(warn) for AUTOSTART_TIMEOUT_MS + exported autostartTimeoutMs + _resetWarnFlags
    - src/sessions.ts two-tier LEGATE_->PREFECT_(warn) for SESSION_TTL_MS + exported _resetWarnFlags
    - src/cli.ts LEGATE_ENTRY, legate-mcp binary, legate-update.md, mcpServers.legate
    - src/registry.ts legate add-server in user-facing message
    - All 6 test files migrated to LEGATE_* env vars and legate brand strings
    - Plan 01 RED deprecation tests now GREEN (117/117 tests pass)
  affects:
    - 05-rename/05-03 (documentation)

tech-stack:
  added: []
  patterns:
    - Three-tier env var deprecation chain (LEGATE_ -> PREFECT_ warn -> OPENCODE_ warn) for SERVER_PASSWORD, SERVER_USERNAME, DEFAULT_PROJECT
    - Two-tier env var deprecation chain (LEGATE_ -> PREFECT_ warn) for AUTOSTART_TIMEOUT_MS, SESSION_TTL_MS
    - TTL env var resolution moved before file I/O so deprecation warning fires even on ENOENT path

key-files:
  created: []
  modified:
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

decisions:
  - "Sessions.ts TTL env var resolution moved before try/catch so deprecation warning fires even when sessions.json does not exist (ENOENT path exits early without running TTL logic)"
  - "SESSIONS_DIR and REGISTRY_DIR join(homedir(), '.config', 'prefect') paths explicitly preserved — config directory rename is out of scope per REQUIREMENTS.md"
  - "fetch.ts [Prefect] log prefix updated to [Legate] as Rule 2 deviation (file was not in plan but had [Prefect] that would violate the [Prefect]=0 requirement)"

metrics:
  duration: 10min
  completed: "2026-05-17"
  tasks_completed: 2
  files_modified: 14
---

# Phase 05 Plan 02b: Rename Remaining Source Modules and Test Files Summary

**Three-tier LEGATE_->PREFECT_(warn)->OPENCODE_(warn) deprecation chain implemented in auth/config/sessions/autostart/cli; all 117 tests pass including Plan 01 RED tests now GREEN**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-05-17
- **Tasks:** 2
- **Files modified:** 14 (7 source + 1 additional source fix + 6 test)

## Accomplishments

### Task 1: Source Module Renames

**src/auth.ts:** Added `warnedPrefectPassword` and `warnedPrefectUsername` flags. Three-tier chain: `LEGATE_SERVER_PASSWORD` → `PREFECT_SERVER_PASSWORD` (warn once) → `OPENCODE_SERVER_PASSWORD` (warn once). `_resetWarnFlags()` now resets all four flags. All `[Prefect]` → `[Legate]`.

**src/config.ts:** Added `warnedPrefectDefaultProject` flag. Three-tier chain: `LEGATE_DEFAULT_PROJECT` → `PREFECT_DEFAULT_PROJECT` (warn once) → `OPENCODE_DEFAULT_PROJECT` (warn once). All `[Prefect]` → `[Legate]`.

**src/autostart.ts:** Added `warnedAutostartTimeout` flag. `autostartTimeoutMs()` exported (was module-private). Two-tier chain: `LEGATE_AUTOSTART_TIMEOUT_MS` → `PREFECT_AUTOSTART_TIMEOUT_MS` (warn once). `_resetWarnFlags()` exported for test isolation. All `[Prefect]` → `[Legate]`.

**src/sessions.ts:** Added `warnedSessionTtl` flag. TTL env var resolution moved BEFORE the `try/catch` block so the deprecation warning fires even when sessions.json doesn't exist. Two-tier chain: `LEGATE_SESSION_TTL_MS` → `PREFECT_SESSION_TTL_MS` (warn once). `_resetWarnFlags()` exported. `legate_session_delete` in capacity error message. `[Prefect]` → `[Legate]`. `SESSIONS_DIR` path unchanged.

**src/cli.ts:** `PREFECT_ENTRY` → `LEGATE_ENTRY` (command: `legate-mcp`). `PREFECT_UPDATE_COMMAND_CONTENT` → `LEGATE_UPDATE_COMMAND_CONTENT` (references `/legate-update`, `@momidala/legate`). Init subcommand writes `mcpServers.legate`. All `Usage: prefect` → `Usage: legate`. `prefect-update.md` → `legate-update.md`. `printOnboardingIfNoServers` uses `legate add-server`.

**src/registry.ts:** `No servers registered. Use: prefect add-server ...` → `legate add-server`. `REGISTRY_DIR` path unchanged.

**src/handlers.ts:** JSDoc/comment `prefect_create_session`, `prefect_run`, `prefect_get_diff`, `prefect_delegate` → `legate_*`.

**src/fetch.ts (Rule 2 deviation):** `[Prefect]` in cleartext warning log → `[Legate]`. This file was not in the plan's file list but had a `[Prefect]` string that would violate the verification requirement.

### Task 2: Test File Migrations

**src/auth.test.ts:** Pre-existing tests: `PREFECT_SERVER_PASSWORD/USERNAME` → `LEGATE_SERVER_PASSWORD/USERNAME`. Plan 01 deprecation tests (lines 102–317) preserved verbatim and now GREEN.

**src/autostart.test.ts:** `PREFECT_AUTOSTART_TIMEOUT_MS` → `LEGATE_AUTOSTART_TIMEOUT_MS`. `PREFECT_SERVER_PASSWORD` → `LEGATE_SERVER_PASSWORD` (health poll test). Plan 01 deprecation tests (lines 113–190) now GREEN.

**src/sessions.test.ts:** `PREFECT_SESSION_TTL_MS` → `LEGATE_SESSION_TTL_MS` in pre-existing tests. Temp dir prefix `prefect-sessions-` → `legate-sessions-`. Plan 01 deprecation tests (lines 284–370) now GREEN.

**src/cli.test.ts:** Temp dir `legate-cli-`. All `cfg.mcpServers.prefect` → `cfg.mcpServers.legate`. `Usage: prefect` → `Usage: legate` in assertions. `prefect-update.md` file path assertions → `legate-update.md`. Test setup stubs for Cases 3/4 updated to write `legate` key. `prefect add-server` example in init guidance test → `legate add-server`. `.config/prefect/` path assertions preserved.

**src/registry.test.ts:** Temp dir prefix `prefect-registry-` → `legate-registry-`.

**src/session-command.test.ts:** Comment `prefect_session_command` → `legate_session_command`.

## Final grep counts

| File | `prefect` count | `PREFECT_` count | Notes |
|------|----------------|-----------------|-------|
| src/auth.ts | 6 | 5 | Intentional deprecation chain (PREFECT_SERVER_PASSWORD/USERNAME in code) |
| src/config.ts | 3 | 3 | Intentional deprecation chain (PREFECT_DEFAULT_PROJECT) |
| src/autostart.ts | 3 | 3 | Intentional deprecation chain (PREFECT_AUTOSTART_TIMEOUT_MS) |
| src/sessions.ts | 3 | 2 | Intentional deprecation chain (PREFECT_SESSION_TTL_MS) + SESSIONS_DIR path |
| src/cli.ts | 0 | 0 | Fully renamed |
| src/registry.ts | 1 | 0 | REGISTRY_DIR path only (intentionally preserved) |
| src/handlers.ts | 0 | 0 | Fully renamed |
| src/fetch.ts | 0 | 0 | Fully renamed |
| src/auth.test.ts | n/a | 58 | Plan 01 deprecation tests intentionally exercise PREFECT_* path |
| src/autostart.test.ts | n/a | 22 | Plan 01 deprecation tests |
| src/sessions.test.ts | n/a | 22 | Plan 01 deprecation tests |

## SESSIONS_DIR / REGISTRY_DIR strings (verbatim grep output)

```
src/sessions.ts:28:const SESSIONS_DIR = join(homedir(), '.config', 'prefect');
src/registry.ts:18:const REGISTRY_DIR = join(homedir(), '.config', 'prefect');
```

Config directory paths preserved unchanged as required.

## Exported functions added to autostart.ts and sessions.ts

**src/autostart.ts:**
- `export function autostartTimeoutMs(): number` — was module-private, now exported for Plan 01 tests
- `export function _resetWarnFlags(): void` — new test isolation helper; resets `warnedAutostartTimeout`

**src/sessions.ts:**
- `export function _resetWarnFlags(): void` — new test isolation helper; resets `warnedSessionTtl`

## npm test final output

```
# tests 117
# suites 0
# pass 117
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

All 117 tests pass including all 12 Plan 01 RED deprecation tests (now GREEN).

## Task Commits

1. **Task 1: Rename env-var-reading modules** - `1dba512` (feat)
2. **Task 2: Update test files + sessions.ts TTL fix** - `bd90c05` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] src/fetch.ts had [Prefect] log prefix not in plan file list**
- **Found during:** Task 1 verification
- **Issue:** `src/fetch.ts` line 64 had `[Prefect]` in a console.error log. The plan's file list didn't include fetch.ts, but the verification requirement `grep -rn "\[Prefect\]" src/*.ts` returning 0 would fail unless fixed.
- **Fix:** Changed `[Prefect]` to `[Legate]` in fetch.ts
- **Files modified:** src/fetch.ts
- **Commit:** 1dba512

**2. [Rule 1 - Bug] sessions.ts TTL env var resolution fired after ENOENT early return**
- **Found during:** Task 2 (tests 115-116 failing)
- **Issue:** The `PREFECT_SESSION_TTL_MS` deprecation warning code was inside the `try` block but after a `try/catch` ENOENT early return path. When `sessions.json` doesn't exist, the function returns `{ sessions: {} }` before the TTL code runs, so the warning never fires. Plan 01 tests that call `readSessionMap` on a non-existent file expected the warning but got 0.
- **Fix:** Moved TTL env var resolution (with deprecation warning) to before the `try` block so it always runs regardless of whether the file exists.
- **Files modified:** src/sessions.ts
- **Commit:** bd90c05

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced.

Threat mitigations satisfied:
- T-05-05: All deprecation warning code logs env var NAMES only, never values. Verified: all `console.error` calls in deprecation code reference only variable name strings.
- T-05-06: Precedence tests in Plan 01 now pass GREEN — LEGATE_* wins over PREFECT_* (correct ordering confirmed by test suite).
- T-05-08: `grep -c "PREFECT_ENTRY" src/cli.ts` = 0; `grep -c "mcpServers.*legate" src/cli.ts` >= 1. cli.test.ts assertions verify behavior.
- T-05-09: OPENCODE_ fallback preserved: `grep -c "OPENCODE_SERVER_PASSWORD" src/auth.ts` = 3; `grep -c "OPENCODE_DEFAULT_PROJECT" src/config.ts` = 3.
- T-05-10: SESSIONS_DIR/REGISTRY_DIR paths still `~/.config/prefect/` — confirmed by verbatim grep output above.

## Self-Check: PASSED

Files exist:
- FOUND: src/auth.ts (modified)
- FOUND: src/config.ts (modified)
- FOUND: src/autostart.ts (modified)
- FOUND: src/sessions.ts (modified)
- FOUND: src/cli.ts (modified)
- FOUND: src/registry.ts (modified)
- FOUND: src/handlers.ts (modified)
- FOUND: src/fetch.ts (modified)
- FOUND: src/auth.test.ts (modified)
- FOUND: src/autostart.test.ts (modified)
- FOUND: src/sessions.test.ts (modified)
- FOUND: src/cli.test.ts (modified)
- FOUND: src/registry.test.ts (modified)
- FOUND: src/session-command.test.ts (modified)

Commits exist:
- 1dba512: feat(05-02b): rename env-var-reading modules to LEGATE_* with deprecation chain
- bd90c05: feat(05-02b): update test files to LEGATE_* env vars and legate brand strings
