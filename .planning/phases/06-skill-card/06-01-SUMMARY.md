---
phase: 06-skill-card
plan: 01
subsystem: cli-tests
tags:
  - tdd
  - cli
  - skill-card
  - wave-0
  - red-gate
dependency_graph:
  requires: []
  provides:
    - SKILL-01 integration test (RED)
    - SKILL-03 integration tests x3 (RED)
    - SKILL-04 integration test (RED)
    - SKILL-05 integration tests x2 (RED)
  affects:
    - src/cli.test.ts
tech_stack:
  added: []
  patterns:
    - freshTmp + runCli + HOME override test isolation
    - runCliAsGlobal for isGlobal=true paths
    - try/finally rmSync cleanup wrapper
key_files:
  created: []
  modified:
    - src/cli.test.ts
decisions:
  - SKILL-05a uses --force on second init call to avoid 'already configured' exit 1 from .mcp.json guard
  - SKILL-03b uses runCli add-server before init to populate registry (mirrors MULTI-08 pattern)
  - SKILL-05b precondition asserts both files exist after install-command before testing uninstall
metrics:
  duration: ~10 minutes
  completed: 2026-05-18
  tasks_completed: 3
  files_modified: 1
---

# Phase 6 Plan 01: Skill Card RED Tests Summary

**One-liner:** Seven failing RED tests + two updated SELFUP assertions locking SKILL-01/03/04/05 behavioral contracts before Plan 02 implements them.

## What Was Built

This plan adds the Wave 0 RED test gate for the Phase 6 skill card installation feature. All 7 new tests fail because `src/cli.ts` does not yet call `installSkillCards()` (Plan 02's job).

### Tests Added (7 new)

1. `test('SKILL-01: legate init writes ~/.claude/commands/legate.md'` — asserts `existsSync(join(dir, '.claude', 'commands', 'legate.md'))` after `runCli(dir, env, 'init')`
2. `test('SKILL-04: legate init writes ~/.claude/commands/legate-update.md'` — same as SKILL-01 but for legate-update.md
3. `test('SKILL-05: second legate init overwrites both skill card files'` — writes STALE_MARKER between two init calls, asserts post-second-init file does not contain STALE_MARKER
4. `test('SKILL-03: legate.md contains canonical loop and tool table'` — asserts `# Legate — Skill Card`, `## Canonical Loop`, `legate_create_session`, `legate_run`, `legate_session_delete`, `## Tools`, and >=6 `legate_*` tool references
5. `test('SKILL-03: legate.md workers section reflects registered servers'` — pre-populates registry with `add-server thor localhost 4096 vllm qwen3-coder`, asserts `## Available Workers` and `**thor** — vllm/qwen3-coder, localhost:4096`
6. `test('SKILL-03: legate.md workers section shows placeholder when registry empty'` — asserts `## Available Workers` and `/no servers registered/` with empty registry
7. `test('SKILL-05: uninstall-command removes both legate.md and legate-update.md'` — asserts both files absent after `runCliAsGlobal(dir, 'uninstall-command')`

### Existing Assertions Retargeted (2 edits)

1. **Line 568** (warning-message test): changed from `/Warning: legate-update command not installed —/` to `/Warning: legate commands not installed —/`
2. **Lines 580-581** (bogus-usage test): changed from `/install-command\s+Install \/legate-update Claude command/` + `/uninstall-command\s+Remove \/legate-update Claude command/` to `/install-command\s+Install \/legate and \/legate-update Claude commands/` + `/uninstall-command\s+Remove \/legate and \/legate-update Claude commands/`

## Test Command and Observed RED Output

```
npm run build && node --test build/cli.test.js 2>&1 | grep "^not ok"
```

```
not ok 36 - SELFUP: install-command warns to stderr and exits 0 when mkdir/write fails
not ok 37 - SELFUP: legate bogus usage lists install-command and uninstall-command
not ok 38 - SKILL-01: legate init writes ~/.claude/commands/legate.md
not ok 39 - SKILL-04: legate init writes ~/.claude/commands/legate-update.md
not ok 40 - SKILL-05: second legate init overwrites both skill card files
not ok 41 - SKILL-03: legate.md contains canonical loop and tool table
not ok 42 - SKILL-03: legate.md workers section reflects registered servers
not ok 43 - SKILL-03: legate.md workers section shows placeholder when registry empty
not ok 44 - SKILL-05: uninstall-command removes both legate.md and legate-update.md
# tests 44
# pass 35
# fail 9
```

35 previously-passing tests remain green. 9 total failures = 7 new SKILL tests + 2 retargeted SELFUP assertions.

## Plan 02 Readiness

Plan 02 can now begin. It must turn all 9 failing tests GREEN by implementing:
- `LEGATE_SKILL_CARD_STATIC` constant in `src/cli.ts`
- `buildWorkersSection()` function reading from `readRegistry()`
- `installSkillCards(destDir)` helper writing both files
- Extending `handleInstallCommand` to call `installSkillCards` (and update its warning/success messages)
- Extending `handleUninstallCommand` to `rmSync` both files
- Adding `installSkillCards` call to the `init` case (non-global)
- Updating usage strings in `usageAndExit()` to mention both files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SKILL-05a uses --force on second init call**
- **Found during:** Task 1
- **Issue:** The `init` case exits 1 when `.mcp.json` already contains a legate entry. The second `runCli(dir, env, 'init')` call in SKILL-05a would fail with status 1 before testing overwrite behavior.
- **Fix:** Changed second init call to `runCli(dir, env, 'init', '--force')` so it proceeds past the guard and exercises the overwrite path.
- **Files modified:** src/cli.test.ts
- **Commit:** ad61502

## TDD Gate Compliance

- RED gate commit: `ad61502` (test(06-01): SKILL-01 SKILL-04 SKILL-05)
- GREEN gate: pending (Plan 02)
- REFACTOR gate: not applicable for test-only plan

## Self-Check: PASSED

- src/cli.test.ts exists and contains all 7 new test names ✓
- Commits ad61502, 79858fc, 30724a0 exist in git log ✓
- `node --test build/cli.test.js` exits non-zero with 9 failures ✓
- SELFUP test count unchanged at 8 ✓
- Old assertion strings `legate-update command not installed` and `legate-update Claude command` (in usage) fully removed ✓
