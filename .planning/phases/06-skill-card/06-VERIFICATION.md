---
phase: 06-skill-card
verified: 2026-05-17T00:00:00Z
status: human_needed
score: 4/5 must-haves verified (1 requires human)
overrides_applied: 0
human_verification:
  - test: "Install legate globally (npm install -g legate), open Claude Code in a fresh project, run /legate, and confirm the command is available and the skill card renders in Claude's context without requiring full MCP schema loading"
    expected: "Claude Code presents the skill card content from ~/.claude/commands/legate.md as a condensed reference; Claude does not need to enumerate 40 individual legate_* tool descriptions from the MCP schema"
    why_human: "Behavioral — requires observing Claude Code's context-window usage and confirming the skill card is being used as the primary reference source rather than verbose MCP schemas. Cannot be verified programmatically."
---

# Phase 6: Skill Card Verification Report

**Phase Goal:** `legate init` installs versioned skill cards that give Claude Code a compact reference to the canonical loop and all tools, replacing verbose MCP schema loading
**Verified:** 2026-05-17T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running `legate init` creates `~/.claude/commands/legate.md` and `~/.claude/commands/legate-update.md` on a fresh machine | VERIFIED | `ok 38 - SKILL-01` + `ok 39 - SKILL-04`; `installSkillCards()` called in both init branches (lines 267, 300 of src/cli.ts); `writeFileSync(join(destDir, 'legate.md'), ...)` + `writeFileSync(join(destDir, 'legate-update.md'), ...)` at lines 191-192 |
| 2 | Running `legate init` a second time overwrites both files with the current version (idempotent reinstall) | VERIFIED | `ok 40 - SKILL-05`; test writes `STALE_MARKER` between two init calls and asserts post-second-init file does not contain `STALE_MARKER`; `writeFileSync` with no `{ flag: 'wx' }` guard means it overwrites unconditionally |
| 3 | The installed `legate.md` card includes the canonical loop, one-line descriptions for each tool group, and an auto-generated workers section reflecting the current servers.json | VERIFIED | `ok 41-43` (SKILL-03 × 3); `LEGATE_SKILL_CARD_STATIC` (lines 46-77) contains `## Canonical Loop` (8 steps with explicit tool names), 7-group tool table under `## Tools (40 total — prefix all with legate_)`, and `## Rules`; `buildWorkersSection()` (lines 79-86) appends `## Available Workers` from `readRegistry()` with exact bullet format; empty registry yields `*(no servers registered — run: legate add-server)*` |
| 4 | Running `legate uninstall-command` removes both installed files | VERIFIED | `ok 44 - SKILL-05`; `handleUninstallCommand` (lines 215-228) calls `rmSync(join(destDir, 'legate.md'), { force: true })` then `rmSync(join(destDir, 'legate-update.md'), { force: true })` |
| 5 | The skill card replaces verbose tool descriptions in Claude Code context — Claude reads the skill card instead of loading full MCP schemas (SKILL-02) | UNCERTAIN — HUMAN NEEDED | The `legate.md` content is structurally correct (60-line card, 7 tool groups, all 40 tool short-names, canonical loop with 7 explicit `legate_*` tool names) and designed to be compact. Whether Claude Code actually uses it as a replacement for schema loading requires behavioral observation in a live Claude Code session. Documented as Manual-Only in 06-VALIDATION.md. |

**Score:** 4/5 truths verified (1 requires human)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli.ts` | LEGATE_SKILL_CARD_STATIC constant, buildWorkersSection() helper, installSkillCards() helper, extended handleInstallCommand, extended handleUninstallCommand, init case skill-card invocation, updated usage strings | VERIFIED | All 4 symbols present; `grep -c "const LEGATE_SKILL_CARD_STATIC" src/cli.ts` = 1; `grep -c "function buildWorkersSection" src/cli.ts` = 1; `grep -c "function installSkillCards" src/cli.ts` = 1; `installSkillCards` called 2× in init case; usage strings updated |
| `src/cli.test.ts` | 7 SKILL tests + 2 retargeted SELFUP assertions | VERIFIED | All 7 SKILL tests present (lines 589-707); `Warning: legate commands not installed` present (line 568); `Warning: legate-update command not installed` absent (grep returns 0); `Install /legate and /legate-update Claude commands` present (line 580); `Remove /legate and /legate-update Claude commands` present (line 581) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli.ts: init case (no .mcp.json branch)` | `installSkillCards(join(homedir(), '.claude', 'commands'))` | direct call before `printOnboardingIfNoServers()` | WIRED | Line 267 — inside try/catch block; `grep -c "installSkillCards(join(homedir(), '.claude', 'commands'))" src/cli.ts` = 2 |
| `src/cli.ts: init case (existing .mcp.json branch)` | `installSkillCards(join(homedir(), '.claude', 'commands'))` | direct call before `printOnboardingIfNoServers()` | WIRED | Line 300 — inside try/catch block |
| `src/cli.ts: installSkillCards` | `buildWorkersSection() + readRegistry()` | `LEGATE_SKILL_CARD_STATIC + buildWorkersSection()` | WIRED | Line 191: `writeFileSync(join(destDir, 'legate.md'), LEGATE_SKILL_CARD_STATIC + buildWorkersSection())` |
| `src/cli.ts: handleInstallCommand` | `installSkillCards(destDir)` | shared helper | WIRED | Line 203: `installSkillCards(destDir)` inside try block |
| `src/cli.ts: handleUninstallCommand` | `rmSync(legate.md) + rmSync(legate-update.md)` | sequential rmSync calls | WIRED | Lines 222-223 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `buildWorkersSection()` | `servers` from `readRegistry()` | `~/.config/legate/servers.json` (via `readRegistry()` in registry.ts) | Yes — reads real registry; ENOENT returns `{ servers: [] }` gracefully | FLOWING |
| `LEGATE_SKILL_CARD_STATIC` | static constant compiled into build/cli.js | TypeScript template literal | N/A — static content by design (not runtime file read) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `legate init` creates legate.md | `node --test build/cli.test.js` — ok 38 | PASS | PASS |
| `legate init` creates legate-update.md | `node --test build/cli.test.js` — ok 39 | PASS | PASS |
| Second init overwrites files | `node --test build/cli.test.js` — ok 40 | PASS | PASS |
| legate.md canonical loop + tool table | `node --test build/cli.test.js` — ok 41 | PASS | PASS |
| legate.md workers section reflects registry | `node --test build/cli.test.js` — ok 42 | PASS | PASS |
| legate.md workers placeholder when empty | `node --test build/cli.test.js` — ok 43 | PASS | PASS |
| uninstall-command removes both files | `node --test build/cli.test.js` — ok 44 | PASS | PASS |
| Full suite zero regressions | `npm test` — `# pass 127 # fail 0` | PASS | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SKILL-01 | 06-01-PLAN, 06-02-PLAN | `legate init` installs `~/.claude/commands/legate.md` | SATISFIED | `ok 38 - SKILL-01`; `installSkillCards` wired into both init branches |
| SKILL-02 | 06-02-PLAN | Skill file replaces verbose tool descriptions in Claude Code context | NEEDS HUMAN | Card is structurally correct and compact; behavioral replacement requires live Claude Code observation |
| SKILL-03 | 06-01-PLAN, 06-02-PLAN | Skill file includes canonical loop, workers section, tool group descriptions | SATISFIED | `ok 41-43`; `LEGATE_SKILL_CARD_STATIC` verified to contain all required sections; `buildWorkersSection()` produces dynamic workers content |
| SKILL-04 | 06-01-PLAN, 06-02-PLAN | `legate init` installs `~/.claude/commands/legate-update.md` | SATISFIED | `ok 39 - SKILL-04`; `installSkillCards` writes both files |
| SKILL-05 | 06-01-PLAN, 06-02-PLAN | Skill files versioned — overwrite on reinstall; uninstall removes both | SATISFIED | `ok 40` (idempotent overwrite) + `ok 44` (uninstall both) |

No orphaned requirements: all 5 SKILL requirements declared in plans match REQUIREMENTS.md Phase 6 entries.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scan result: `grep -n "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER" src/cli.ts src/cli.test.ts` returned no output. No debt markers, no placeholder returns, no empty handlers found in phase-modified files.

One observation (not a blocker): `buildWorkersSection()` (the legate.md generator) uses placeholder `*(no servers registered — run: legate add-server)*` while `updateClaudemdWorkers()` (the CLAUDE.md updater) uses the shorter `*(no servers registered)*`. This is intentional per 06-RESEARCH.md Pattern 2 — the legate.md version includes the hint for Claude Code context, the CLAUDE.md version does not. No impact on correctness.

### Human Verification Required

#### 1. SKILL-02: Skill Card Replaces Verbose MCP Schema Loading

**Test:** Install the package globally (`npm install -g legate`), open Claude Code in a project directory, run `legate init` to install the skill cards, restart Claude Code, then issue a task using legate tools (e.g., "use legate to edit this file"). Observe whether Claude references `/legate` or the `## Canonical Loop` section instead of enumerating all 40 tool schemas individually.

**Expected:** Claude Code reads `~/.claude/commands/legate.md` and uses it as the primary compact reference for legate tool usage. The skill card's 7-group table and canonical loop replace the need to load full MCP schema descriptions in context.

**Why human:** Behavioral — requires observing Claude Code's actual context usage and response pattern in a live session. Cannot be verified programmatically; documented as Manual-Only in 06-VALIDATION.md.

### Gaps Summary

No blocking gaps found. The implementation is complete and all 127 tests pass (7 new SKILL tests green, 0 regressions). The single human verification item (SKILL-02) reflects an inherently behavioral requirement that was explicitly designated Manual-Only in the validation strategy.

---

_Verified: 2026-05-17T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
