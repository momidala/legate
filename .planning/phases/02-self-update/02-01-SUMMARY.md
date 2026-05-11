---
phase: 02-self-update
plan: "01"
subsystem: cli
tags:
  - cli
  - npm-lifecycle
  - slash-command
  - tdd
dependency_graph:
  requires: []
  provides:
    - "handleInstallCommand in src/cli.ts"
    - "handleUninstallCommand in src/cli.ts"
    - "PREFECT_UPDATE_COMMAND_CONTENT template in src/cli.ts"
    - "install-command and uninstall-command CLI subcommands"
  affects:
    - "src/cli.ts switch statement and usage text"
    - "src/cli.test.ts (8 new SELFUP tests)"
tech_stack:
  added:
    - "node:os homedir() — cross-platform HOME detection for target path"
    - "node:fs mkdirSync/rmSync — directory creation and file removal"
    - "node:path join — path construction for ~/.claude/commands/prefect-update.md"
  patterns:
    - "isGlobal guard (reused from existing cli.ts) — D-05 silent-skip for local installs"
    - "warn-to-stderr-exit-0 on failure — D-07 prevents npm install -g from failing"
    - "TDD RED/GREEN: tests committed before implementation"
    - "runCliAsGlobal helper — copies build/ into fake node_modules path so isGlobal===true in tests"
key_files:
  modified:
    - path: "src/cli.ts"
      description: "Added PREFECT_UPDATE_COMMAND_CONTENT constant, handleInstallCommand(), handleUninstallCommand(), updated usageAndExit(), wired switch cases"
    - path: "src/cli.test.ts"
      description: "Added runCliAsGlobal helper and 8 SELFUP test cases"
decisions:
  - "D-05: isGlobal guard reused verbatim — local installs exit 0 silently, no file pollution"
  - "D-06: mkdirSync({ recursive: true }) auto-creates ~/.claude/commands/ if absent"
  - "D-07: warn-to-stderr + exit 0 on any fs failure — broken command install must never block npm install -g"
  - "D-08: uninstall failures are non-fatal — empty catch block, exit 0 silently"
  - "D-01 partial: CLI handlers ready; package.json postinstall/preuninstall wiring deferred to Plan 02"
  - "Template stored inline as module-level const (not separate file) — no package.json files field change needed"
  - "runCliAsGlobal test helper copies cli.js + registry.js into <tmp>/node_modules/@momidala/prefect/build/ so isGlobal===true in tests"
metrics:
  duration: "5 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 2
  files_modified: 2
  tests_added: 8
  tests_total_after: 105
---

# Phase 02 Plan 01: CLI install-command and uninstall-command Summary

**One-liner:** Added `install-command` and `uninstall-command` CLI subcommands with inline `PREFECT_UPDATE_COMMAND_CONTENT` template that writes/removes `~/.claude/commands/prefect-update.md`, gated on `isGlobal` with D-07 warn-and-continue error handling.

## What Was Built

Two new CLI subcommands wired into the existing `src/cli.ts` switch-case pattern:

- `handleInstallCommand()`: global-gated, mkdir -p for `~/.claude/commands/`, writes `prefect-update.md` with the npm install + version display bash block, warns to stderr and exits 0 on any fs failure (D-07)
- `handleUninstallCommand()`: global-gated, removes `prefect-update.md` if present, exits 0 silently on any failure (D-08)
- `PREFECT_UPDATE_COMMAND_CONTENT`: inline template constant containing `npm install -g @momidala/prefect@latest`, version extraction via `npm root -g`, and `prefect updated to vX.Y.Z. Restart Claude Code to apply.` format
- `usageAndExit()` updated to list both new subcommands
- `case 'install-command':` and `case 'uninstall-command':` wired before `default:` in the switch

## Test Coverage (8 new SELFUP tests)

| Test | Coverage |
|------|----------|
| `SELFUP: install-command silent-skips when not global` | D-05 silent exit 0, no file, no stderr |
| `SELFUP: uninstall-command silent-skips when not global` | D-05 silent exit 0, no stderr |
| `SELFUP-01: install-command writes ~/.claude/commands/prefect-update.md when global` | file written, content has npm install, version display, restart reminder |
| `SELFUP-01: install-command creates ~/.claude/commands/ if missing (mkdir -p)` | D-06 auto-creates directory |
| `SELFUP-02: uninstall-command removes prefect-update.md when present` | round-trip install then uninstall |
| `SELFUP-02: uninstall-command exits 0 silently when file is absent` | D-08 non-fatal |
| `SELFUP: install-command warns to stderr and exits 0 when mkdir/write fails` | D-07 warn path — file at ~/.claude blocks mkdir |
| `SELFUP: prefect bogus usage lists install-command and uninstall-command` | usage text inclusion |

## TDD Gate Compliance

- RED commit `3478eb0`: `test(02-01): add failing SELFUP tests` — 8 tests failing before implementation
- GREEN commit `dd9012e`: `feat(02-01): implement install-command and uninstall-command` — all 105 tests passing

## Verification Results

- `npm run build`: exits 0 (no TypeScript errors)
- `npm test`: 105 tests, 0 failures
- `node build/cli.js install-command`: exits 0 (silent-skip, isGlobal is false in repo)
- `node build/cli.js uninstall-command`: exits 0 (silent-skip)
- `node build/cli.js bogus`: stderr contains both `install-command` and `uninstall-command`
- `grep -c "D-0" src/cli.ts`: 7 (D-05 twice + D-06, D-07, D-08 in handlers; D-02, D-03 in template comment)

## Decision Traceability

| Decision | Status | Notes |
|----------|--------|-------|
| D-01 | Partial | CLI handlers ready; package.json lifecycle hooks deferred to Plan 02 |
| D-02 | Implemented | `npm install -g @momidala/prefect@latest` in template |
| D-03 | Implemented | `prefect updated to vX.Y.Z. Restart Claude Code to apply.` format |
| D-04 | Implemented | Self-contained markdown with bash block; filename `prefect-update.md` |
| D-05 | Implemented | `if (!isGlobal) process.exit(0)` in both handlers |
| D-06 | Implemented | `mkdirSync(destDir, { recursive: true })` before writeFileSync |
| D-07 | Implemented | `console.error('Warning: prefect-update command not installed — ...')` + `process.exit(0)` in catch |
| D-08 | Implemented | Empty catch block in handleUninstallCommand, exit 0 after try |

## Deviations from Plan

None — plan executed exactly as written. The test file changes (Task 2 action) were written in the Task 1 RED commit as prescribed by the TDD workflow.

## Known Stubs

None — all handlers are fully implemented with real filesystem operations.

## Self-Check: PASSED

- `src/cli.ts` exists and contains all required patterns
- `src/cli.test.ts` exists with 8 new SELFUP test cases
- RED commit `3478eb0` exists in git log
- GREEN commit `dd9012e` exists in git log
- `npm test` exits 0 with 105 tests passing
