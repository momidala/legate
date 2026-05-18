---
phase: 06-skill-card
plan: 02
subsystem: cli
tags:
  - cli
  - skill-card
  - install
  - tdd
  - green-gate

dependency_graph:
  requires:
    - phase: 06-01
      provides: 9 failing RED tests locking SKILL-01 through SKILL-05 behavioral contracts
  provides:
    - LEGATE_SKILL_CARD_STATIC constant (compact 80-line legate.md reference card)
    - buildWorkersSection() pure function generating ## Available Workers from registry
    - installSkillCards(destDir) shared helper writing both skill card files
    - legate init writes both ~/.claude/commands/legate.md and legate-update.md
    - legate install-command writes both files via shared helper
    - legate uninstall-command removes both files
    - All 7 SKILL tests from Plan 01 GREEN; 127 total tests passing
  affects:
    - 06-verify (validation phase reads legate.md content)

tech-stack:
  added: []
  patterns:
    - installSkillCards(destDir) shared helper pattern (called from both init and install-command)
    - Pattern B inline try/catch for non-fatal feature installs in init case
    - buildWorkersSection() pure function returning markdown string from readRegistry()
    - LEGATE_SKILL_CARD_STATIC TypeScript template literal constant (not runtime file read)

key-files:
  created: []
  modified:
    - src/cli.ts

key-decisions:
  - "installSkillCards() has no isGlobal guard — init is user-invoked, not a lifecycle hook"
  - "Skill card content is a TypeScript constant compiled into build/cli.js (not read from disk at runtime)"
  - "buildWorkersSection() uses exact same bullet format as updateClaudemdWorkers() for consistency"
  - "legate.md uses short tool names in grouped table; 7 explicit legate_* names in Canonical Loop section satisfies test >=6 contract"
  - "installSkillCards call NOT added to conflict-exit branch (exits 1 before normal completion)"

patterns-established:
  - "Pattern B: inline try/catch for non-fatal feature installs in CLI switch cases"
  - "Shared install helper pattern: extract file-write logic into helper, call from multiple entry points"

requirements-completed: [SKILL-01, SKILL-02, SKILL-03, SKILL-04, SKILL-05]

duration: 4min
completed: 2026-05-18
---

# Phase 6 Plan 02: Skill Card Implementation Summary

**`legate init` now installs `~/.claude/commands/legate.md` (compact 40-tool skill card) and `legate-update.md` via shared `installSkillCards()` helper; all 9 failing Plan 01 RED tests turned GREEN with 127/127 total passing.**

## Performance

- **Duration:** ~4 minutes
- **Started:** 2026-05-18T02:21:21Z
- **Completed:** 2026-05-18T02:25:28Z
- **Tasks:** 3
- **Files modified:** 1 (src/cli.ts)

## Accomplishments

- Added `LEGATE_SKILL_CARD_STATIC` template literal constant: 8-step canonical loop + 7-group tool table (40 tools) + 5 operational rules; under 80 lines
- Added `buildWorkersSection()` pure function reading `readRegistry()` and generating `## Available Workers` markdown block (empty registry shows placeholder with hint)
- Added `installSkillCards(destDir)` shared helper writing both skill cards; called from `handleInstallCommand` (global npm path) and both `init` branches (user-invoked path)
- Extended `handleUninstallCommand` to `rmSync` both `legate.md` and `legate-update.md`
- Updated `usageAndExit` strings and install/uninstall warning messages to reflect both files
- All 7 SKILL tests from Plan 01 RED gate now GREEN; 35 pre-existing SELFUP tests remain green; full suite 127/127

## Task Commits

1. **Task 1: Add LEGATE_SKILL_CARD_STATIC constant and buildWorkersSection() helper** - `239244d` (feat)
2. **Task 2: Extract installSkillCards(), refactor handlers, update usage strings** - `5c46b56` (feat)
3. **Task 3: Wire installSkillCards into legate init case** - `c96afe3` (feat)

## Files Created/Modified

- `/mnt/c/Users/larry/Documents/repos/momidala/prefect/src/cli.ts` - Added LEGATE_SKILL_CARD_STATIC, buildWorkersSection, installSkillCards; refactored handleInstallCommand, handleUninstallCommand; extended init case; updated usageAndExit strings

## Decisions Made

- **No isGlobal guard on installSkillCards**: `legate init` is user-invoked (not a lifecycle hook); Pitfall 1 from RESEARCH explicitly forbids gating skill-card writes behind `isGlobal` in init.
- **Constant not file-based**: Skill card content compiled into `build/cli.js` as a TypeScript template literal — cannot fail on machines without source files co-located with global install.
- **Short tool names in table, explicit legate_* in loop**: The grouped tool table uses short names (without `legate_` prefix) per RESEARCH Pattern 1. The Canonical Loop section uses 7 explicit `legate_*` names which satisfies the test contract (`>= 6` distinct references).
- **installSkillCards NOT called in conflict-exit branch**: The `'legate' in servers && !force` branch exits 1 immediately — no skill card install on error path.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Manual Verification Note for SKILL-02

Per 06-VALIDATION.md "Manual-Only Verifications" table, SKILL-02 (skill card replaces verbose tool descriptions in Claude Code context) is a behavioral expectation verified by reading the installed `legate.md`:

The `## Tools (40 total — prefix all with legate_)` table groups all 40 tools into 7 functional rows. The `## Canonical Loop` provides the 8-step workflow. The `## Rules` section covers operational constraints. The card is 60 lines total (well under the ~80 line budget from Pitfall 5). This structured compact format is sufficient for an informed Claude to use legate tools without loading full MCP schema descriptions.

## Test Results: Before vs After

| Metric | Before Plan 02 | After Plan 02 |
|--------|---------------|---------------|
| Total tests | 44 (cli suite) / 120 (full) | 44 (cli suite) / 127 (full) |
| Passing | 35 (cli) / 120 (full) | 44 (cli) / 127 (full) |
| Failing | 9 (all SKILL + 2 SELFUP) | 0 |
| SKILL tests GREEN | 0 | 7 |
| SELFUP tests GREEN | 6/8 | 8/8 |

## Self-Check: PASSED

- src/cli.ts exists and contains all 4 new symbols (LEGATE_SKILL_CARD_STATIC, buildWorkersSection, installSkillCards, updated handlers) ✓
- Commits 239244d, 5c46b56, c96afe3 exist in git log ✓
- `npm test` exits 0 with `# fail 0` and 127 tests ✓
- All 7 SKILL tests from Plan 01 are GREEN ✓
- 0 previously-passing tests now fail ✓
