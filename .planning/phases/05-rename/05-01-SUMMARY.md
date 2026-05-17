---
phase: 05-rename
plan: "01"
subsystem: testing
tags:
  - typescript
  - testing
  - env-vars
  - deprecation
  - tdd
dependency_graph:
  requires: []
  provides:
    - RENAME-04 deprecation warning acceptance contract (RED tests)
  affects:
    - src/auth.test.ts
    - src/autostart.test.ts
    - src/sessions.test.ts
tech_stack:
  added: []
  patterns:
    - console.error capture pattern for deprecation warning assertions
    - env var save/restore try/finally pattern (existing)
    - _resetWarnFlags() test isolation (existing in auth; expected in autostart/sessions after Plan 02)
key_files:
  created: []
  modified:
    - src/auth.test.ts
    - src/autostart.test.ts
    - src/sessions.test.ts
decisions:
  - "Write autostart and sessions tests to import not-yet-exported symbols, letting TypeScript compilation failure be the RED state (per plan acceptance criteria)"
  - "Use console.error capture pattern (save original, replace with array-push function, restore in finally) for warning assertions"
  - "Filter warnings by w.includes('PREFECT_SERVER_PASSWORD') rather than exact match to tolerate brand prefix variation"
metrics:
  duration: 252s
  completed: "2026-05-17"
  tasks_completed: 2
  files_modified: 3
---

# Phase 05 Plan 01: Add Deprecation Warning Tests (RED) Summary

**One-liner:** Added 12 failing RED tests across auth.test.ts, autostart.test.ts, and sessions.test.ts locking in the RENAME-04 PREFECT_* deprecation warning contract before Plan 02 implementation.

## What Was Built

Three test files were updated with new failing (RED) tests asserting that after Plan 02 renames PREFECT_* env vars to LEGATE_*, the old PREFECT_* vars emit a one-time deprecation warning to stderr.

### Tests Added in Each File

**src/auth.test.ts** (lines 107–320, 6 new tests):
- Line 109: `buildAuthHeader emits one-time deprecation warning for PREFECT_SERVER_PASSWORD when LEGATE_SERVER_PASSWORD is not set` — FAILS (RED)
- Line 138: `buildAuthHeader emits PREFECT_SERVER_PASSWORD warning exactly once when called twice` — FAILS (RED)
- Line 167: `buildAuthHeader emits NO PREFECT_SERVER_PASSWORD warning when LEGATE_SERVER_PASSWORD is also set` — passes (correct: current code emits no PREFECT_ warning; still needed for GREEN gate in Plan 02)
- Line 196: `buildAuthHeader emits one-time deprecation warning for PREFECT_SERVER_USERNAME when LEGATE_SERVER_USERNAME is not set` — FAILS (RED)
- Line 238: `buildAuthHeader emits PREFECT_SERVER_USERNAME warning exactly once when called twice` — FAILS (RED)
- Line 283: `buildAuthHeader emits NO PREFECT_SERVER_USERNAME warning when LEGATE_SERVER_USERNAME is also set` — passes

**src/autostart.test.ts** (lines 113–185, 3 new tests):
- Line 118: `autostartTimeoutMs emits one-time deprecation warning for PREFECT_AUTOSTART_TIMEOUT_MS when LEGATE_AUTOSTART_TIMEOUT_MS is not set` — FAILS (TypeScript compile error: autostartTimeoutMs not exported)
- Line 143: `autostartTimeoutMs emits PREFECT_AUTOSTART_TIMEOUT_MS warning exactly once when called twice` — FAILS (same)
- Line 169: `autostartTimeoutMs emits NO PREFECT_AUTOSTART_TIMEOUT_MS warning when LEGATE_AUTOSTART_TIMEOUT_MS is also set` — FAILS (same)

**src/sessions.test.ts** (lines 284–367, 3 new tests):
- Line 289: `readSessionMap emits one-time deprecation warning for PREFECT_SESSION_TTL_MS when LEGATE_SESSION_TTL_MS is not set` — FAILS (TypeScript compile error: _resetWarnFlags not exported)
- Line 317: `readSessionMap emits PREFECT_SESSION_TTL_MS warning exactly once when called twice` — FAILS (same)
- Line 345: `readSessionMap emits NO PREFECT_SESSION_TTL_MS warning when LEGATE_SESSION_TTL_MS is also set` — FAILS (same)

## RED Command Output

```
src/autostart.test.ts(4,53): error TS2459: Module '"./autostart.js"' declares 'autostartTimeoutMs' locally, but it is not exported.
src/autostart.test.ts(4,73): error TS2305: Module '"./autostart.js"' has no exported member '_resetWarnFlags'.
src/sessions.test.ts(7,104): Module '"./sessions.js"' has no exported member '_resetWarnFlags'.
```

auth.test.ts runtime failures (from prior test run before autostart/sessions TypeScript errors):
```
not ok 6 - buildAuthHeader emits one-time deprecation warning for PREFECT_SERVER_PASSWORD...
  error: expected exactly 1 PREFECT_SERVER_PASSWORD warning, got 0: []
not ok 7 - buildAuthHeader emits PREFECT_SERVER_PASSWORD warning exactly once when called twice...
  error: expected exactly 1 PREFECT_SERVER_PASSWORD warning across 2 calls, got 0
not ok 9 - buildAuthHeader emits one-time deprecation warning for PREFECT_SERVER_USERNAME...
  error: expected exactly 1 PREFECT_SERVER_USERNAME warning, got 0: []
not ok 10 - buildAuthHeader emits PREFECT_SERVER_USERNAME warning exactly once when called twice...
  error: expected exactly 1 PREFECT_SERVER_USERNAME warning across 2 calls, got 0
```

## Note for Plan 02

Plan 02 must make the following exports available for tests to compile and pass:

**src/autostart.ts** — currently has:
- `export function ensureOpencodeRunning(server: ServerEntry): Promise<void>`
- `export function _resetStartPromise(): void`

Plan 02 must add:
- `export function autostartTimeoutMs(): number` (move from module-private to exported)
- `export function _resetWarnFlags(): void` (new test isolation helper, resets `warnedAutostartTimeout`)

**src/sessions.ts** — currently has no `_resetWarnFlags`. Plan 02 must add:
- `export function _resetWarnFlags(): void` (new test isolation helper, resets `warnedSessionTtl` or equivalent)

Both modules need the LEGATE_* → PREFECT_* (warn once) deprecation chain added to their env var reads.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Test files only.

## Self-Check: PASSED

Files exist:
- FOUND: src/auth.test.ts (modified)
- FOUND: src/autostart.test.ts (modified)
- FOUND: src/sessions.test.ts (modified)

Commits exist:
- 93fef68: test(05-01): add RED deprecation warning tests for PREFECT_SERVER_PASSWORD/USERNAME
- 5ed2b15: test(05-01): add RED deprecation warning tests for PREFECT_AUTOSTART_TIMEOUT_MS/SESSION_TTL_MS
