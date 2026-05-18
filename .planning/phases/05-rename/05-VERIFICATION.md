---
phase: 05-rename
verified: 2026-05-17T00:00:00Z
status: gaps_found
score: 8/11 must-haves verified
overrides_applied: 0
gaps:
  - truth: "package.json `name` is `@momidala/legate`"
    status: failed
    reason: "package.json name is `legate` (unscoped), not `@momidala/legate`. RENAME-01 requires the scoped package name."
    artifacts:
      - path: "package.json"
        issue: "name field is \"legate\" not \"@momidala/legate\""
    missing:
      - "Change package.json `name` field from `\"legate\"` to `\"@momidala/legate\"`"

  - truth: "README accurately reflects new package name including `@momidala/legate` in install instructions"
    status: failed
    reason: "README install instructions use `npm install -g legate` (unscoped) instead of `npm install -g @momidala/legate`. No `@momidala/legate` string appears anywhere outside the migration section heading. ROADMAP SC #4 and DOC-01 require the scoped package name in install instructions."
    artifacts:
      - path: "README.md"
        issue: "grep -c '@momidala/legate' README.md returns 0 (outside migration section). All install instructions use bare `legate` package name."
    missing:
      - "Replace `npm install -g legate` with `npm install -g @momidala/legate` in the README install section"
      - "README migration section step 2 uses `npm install -g legate` — should also be `npm install -g @momidala/legate`"

  - truth: "REGISTRY_DIR (src/registry.ts) and SESSIONS_DIR (src/sessions.ts) still resolve to ~/.config/prefect/ (config directory rename explicitly out of scope)"
    status: failed
    reason: "Both files now resolve to ~/.config/legate/ — the config directory was renamed contrary to the explicit out-of-scope requirement. A one-time migration (cpSync prefect → legate) was added, but the must-have truth and plan spec required PRESERVATION of the prefect path. This is a behavioral deviation: existing users with ~/.config/prefect/ sessions.json that do NOT have ~/.config/legate/ will be migrated automatically on first run, which is an undocumented side effect not mandated by any plan must-have."
    artifacts:
      - path: "src/sessions.ts"
        issue: "SESSIONS_DIR = join(homedir(), '.config', 'legate') — was required to stay 'prefect'"
      - path: "src/registry.ts"
        issue: "REGISTRY_DIR = join(homedir(), '.config', 'legate') — was required to stay 'prefect'"
    missing:
      - "Determine intended behavior: either (a) revert both dirs to ~/.config/prefect/ to match the plan spec, or (b) accept the config dir rename and document it explicitly including the auto-migration in README migration section"
      - "If accepted: update REQUIREMENTS.md to remove the 'Renaming internal config directory is out of scope' clause and document the auto-migration in the README migration section step 5"
deferred: []
human_verification:
  - test: "Confirm README install instructions are accurate end-to-end"
    expected: "Install instructions reference the correct scoped package name `@momidala/legate` (or unscoped `legate` if that is the intended published name); tool and env var examples use legate_*/LEGATE_*; Migration section has all 5 steps"
    why_human: "Package name decision (scoped vs unscoped) requires human judgment about intended npm publish identity"
  - test: "Verify config directory migration behavior is intentional and safe"
    expected: "The auto-copy of ~/.config/prefect/ to ~/.config/legate/ on first run is the intended migration path and existing users' session data will not be lost"
    why_human: "The plan explicitly declared config dir rename as out of scope; the implementation changed it with a migration shim — human must decide whether this deviation is acceptable or whether it should be reverted"
---

# Phase 5: Rename Verification Report

**Phase Goal:** Rename the project from Prefect to Legate — package identity, all tool names, env vars, log prefixes, CLI binaries, and documentation. Ship a migration path for existing users.
**Verified:** 2026-05-17
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | `npm install -g @momidala/legate` installs the package and exposes `legate` and `legate-mcp` binaries | FAILED | `package.json` name is `"legate"` not `"@momidala/legate"`. bin keys `legate` and `legate-mcp` are correct. |
| SC-2 | All MCP tools visible in Claude Code are named `legate_*` | VERIFIED | `grep -c "registerTool" src/index.ts` = 40; grep shows all tool names as `legate_*`; zero `prefect_*` strings in src/index.ts |
| SC-3 | User who sets `PREFECT_SERVER_URL` gets deprecation warning; user who sets `LEGATE_SERVER_URL` gets no warning | VERIFIED | Three-tier chain in src/index.ts lines 18-36; 117/117 tests pass including deprecation tests |
| SC-4 | README accurately reflects new package name, binary names, env var names, includes migration note | FAILED | README has migration section (1 match for "Migrating from @momidala/prefect"). However `@momidala/legate` does not appear in install instructions — `npm install -g legate` is used throughout. `grep -c "@momidala/legate" README.md` = 0 (no occurrences outside migration heading line). |

### Must-Have Truths (Plan Frontmatter — All Plans)

| # | Truth | Source Plan | Status | Evidence |
|---|-------|-------------|--------|----------|
| 1 | package.json `name` is `@momidala/legate` | 05-02 | FAILED | Actual value: `"legate"` (unscoped) |
| 2 | package.json `bin` exposes `legate` and `legate-mcp` | 05-02 | VERIFIED | `"legate": "./build/cli.js"`, `"legate-mcp": "./build/index.js"` |
| 3 | src/index.ts registers MCP server with name `legate` | 05-02 | VERIFIED | Line 131: `new McpServer({ name: 'legate', version: packageVersion })` |
| 4 | All 40 tool registrations use `legate_` prefix | 05-02 | VERIFIED | `grep -c "registerTool" src/index.ts` = 40; all verified as `legate_*` |
| 5 | Three-tier BASE_URL chain (LEGATE_ → PREFECT_ → OPENCODE_) | 05-02 | VERIFIED | Lines 18-36 of index.ts show correct three-tier chain; 4 intentional PREFECT_ occurrences for backward compat |
| 6 | All `[Prefect]` log prefixes changed to `[Legate]` | 05-02b | VERIFIED | `grep -c "[Prefect]" src/*.ts` = 0; [Legate] confirmed in auth.ts, autostart.ts, sessions.ts, cli.ts, index.ts |
| 7 | src/cli.ts writes `mcpServers.legate` key | 05-02b | VERIFIED | Lines 216, 234, 242: legate key written; zero PREFECT_ENTRY occurrences |
| 8 | REGISTRY_DIR and SESSIONS_DIR stay at `~/.config/prefect/` | 05-02b | FAILED | Both now point to `~/.config/legate/` with an auto-migration shim from `prefect`. This contradicts the explicit plan requirement and REQUIREMENTS.md out-of-scope clause. |
| 9 | `npm test` passes — 117/117 tests green | 05-02b | VERIFIED | `npm test` output: `# pass 117 # fail 0` |
| 10 | README has `@momidala/legate` and migration section | 05-03 | FAILED | Migration section heading exists (1 match "Migrating from @momidala/prefect"). But `@momidala/legate` appears zero times in README — install instructions use bare `legate`. |
| 11 | `.gitattributes` exists with `*.ts linguist-language=TypeScript` | 05-03 | VERIFIED | `cat .gitattributes` = `*.ts linguist-language=TypeScript`; 34 bytes |

**Score:** 8/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | name `@momidala/legate`, bin legate/legate-mcp | STUB | name is `legate` not `@momidala/legate`; bin keys correct |
| `src/index.ts` | MCP server `legate`, 40 legate_* tools | VERIFIED | 40 tools, name 'legate', three-tier chains |
| `src/auth.ts` | LEGATE_SERVER_PASSWORD three-tier chain | VERIFIED | Lines 23-38; warnedPrefectPassword flag present |
| `src/autostart.ts` | LEGATE_AUTOSTART_TIMEOUT_MS, exported helpers | VERIFIED | export function autostartTimeoutMs() and _resetWarnFlags() present |
| `src/sessions.ts` | LEGATE_SESSION_TTL_MS, _resetWarnFlags | VERIFIED | Both present; SESSIONS_DIR changed (see gaps) |
| `src/cli.ts` | LEGATE_ENTRY, legate-mcp, mcpServers.legate | VERIFIED | All confirmed |
| `src/registry.ts` | legate add-server message, REGISTRY_DIR unchanged | PARTIAL | Message correct; REGISTRY_DIR changed to ~/.config/legate |
| `README.md` | @momidala/legate, migration section | PARTIAL | Migration section present; @momidala/legate absent from install instructions |
| `EXAMPLE_CLAUDE.md` | legate_create_session | VERIFIED | grep -c = 2 |
| `AGENTS.md` | LEGATE_ references | VERIFIED | grep -c = 3 |
| `CLAUDE.md` | legate_* tool references | VERIFIED | grep -c = 17 |
| `examples/test-task.md` | legate_* | VERIFIED | grep -c = 13 |
| `examples/uat-v2.md` | @momidala/legate | FAILED | Zero occurrences; uses bare `legate` |
| `.gitattributes` | `*.ts linguist-language=TypeScript` | VERIFIED | 34 bytes, exact content |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| package.json bin | build/index.js + build/cli.js | npm install -g exposes binaries | VERIFIED | legate → ./build/cli.js, legate-mcp → ./build/index.js |
| src/index.ts BASE_URL | LEGATE_/PREFECT_/OPENCODE_URL | three-tier fallback | VERIFIED | Chain present lines 16-36 |
| src/cli.ts init | .mcp.json mcpServers.legate | JSON write | VERIFIED | servers.legate = LEGATE_ENTRY confirmed |
| Plan 01 RED tests | auth.ts/autostart.ts/sessions.ts implementations | npm test green | VERIFIED | 117/117 pass |

### Data-Flow Trace

Not applicable — this phase produces CLI/MCP tooling, not a UI with dynamic data rendering.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Test suite green | `npm test` | 117 pass, 0 fail | PASS |
| 40 legate_* tools registered | `grep -c "registerTool" src/index.ts` | 40 | PASS |
| Zero [Prefect] log prefixes | `grep -c "[Prefect]" src/*.ts` | 0 | PASS |
| Zero stale prefect refs in docs | `grep -rE "prefect_|PREFECT_" CLAUDE.md AGENTS.md EXAMPLE_CLAUDE.md examples/test-task.md examples/uat-v2.md \| grep -v ".config/prefect" \| wc -l` | 0 | PASS |
| package.json name | `grep "\"name\"" package.json` | `"legate"` | FAIL — expected `@momidala/legate` |
| README @momidala/legate | `grep -c "@momidala/legate" README.md` | 0 | FAIL — only in migration section heading |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RENAME-01 | 05-02 | Package name changed to `@momidala/legate` | FAILED | package.json name = `"legate"` (unscoped) |
| RENAME-02 | 05-02 | All CLI binaries renamed legate/legate-mcp | VERIFIED | bin keys confirmed in package.json and cli.ts |
| RENAME-03 | 05-02 | All prefect_* tool names → legate_* | VERIFIED | 40 tools registered as legate_*; zero prefect_* in src/index.ts |
| RENAME-04 | 05-01/02/02b | PREFECT_* env vars read with one-time deprecation warnings; LEGATE_* preferred | VERIFIED | All 7 env vars have two- or three-tier chains; 117 tests green including deprecation tests |
| DOC-01 | 05-03 | All user-facing docs updated with new names + migration note | PARTIAL | Migration section present; install instructions use unscoped `legate` not `@momidala/legate`; secondary docs clean |
| DOC-02 | 05-03 | .gitattributes with TypeScript Linguist override | VERIFIED | File present, 34 bytes, exact content |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| src/sessions.ts line 21 | `SessionEntry` interface still contains comments referencing `prefect_run` and `prefect_fork` and `prefect_session_children` | Warning | Stale internal comments; no runtime impact |
| package.json | `"name": "legate"` uses unscoped name | Blocker | RENAME-01 requires `@momidala/legate`; npm publish under wrong name |

### Human Verification Required

#### 1. Package Name Decision

**Test:** Review whether `"legate"` (unscoped) or `"@momidala/legate"` (scoped) is the intended published npm package name.
**Expected:** If `@momidala/legate` is intended, package.json name and all install instructions must be updated. If bare `legate` is acceptable, RENAME-01 must be updated to reflect the new target.
**Why human:** This is a product/publishing decision, not a code correctness issue. The ROADMAP says `@momidala/legate` but the implementation consistently uses unscoped `legate`. The inconsistency spans package.json, README install commands, cli.ts update content, and uat-v2.md.

#### 2. Config Directory Migration Decision

**Test:** Verify that the config directory change from `~/.config/prefect/` to `~/.config/legate/` (with auto-migration shim) is the intended behavior.
**Expected:** The plan explicitly declared config dir rename as out of scope. The implementation changed both SESSIONS_DIR and REGISTRY_DIR to `~/.config/legate` and added a `cpSync` migration. Human must decide: accept this (and update docs + REQUIREMENTS.md) or revert to `~/.config/prefect/`.
**Why human:** Behavioral deviation from explicit plan specification. The auto-migration cpSync on first run has data-safety implications for existing users.

### Gaps Summary

Three gaps block full goal achievement:

1. **RENAME-01 / SC-1: Package name is unscoped.** `package.json` name is `"legate"` everywhere; the roadmap and plan require `"@momidala/legate"`. This same inconsistency cascades into README install instructions (`npm install -g legate`) and uat-v2.md (no `@momidala/legate` references). This may be an intentional product decision (some packages publish unscoped), but it contradicts the stated requirement.

2. **DOC-01 / SC-4: README install instructions use bare `legate`.** `@momidala/legate` appears zero times outside the "Migrating from @momidala/prefect" migration section heading. All `npm install -g` commands use bare `legate`. If gap #1 above is resolved in favor of the scoped name, README and uat-v2.md also need updating.

3. **Config directory deviation.** Both `src/sessions.ts` and `src/registry.ts` now resolve to `~/.config/legate/` rather than `~/.config/prefect/` as the plans explicitly required. A one-time `cpSync` migration shim was added. While this may be a better long-term design, it contradicts the plan contract and the REQUIREMENTS.md out-of-scope clause. The behavior needs explicit human acceptance, and if accepted, the README migration section step 5 must be updated to document the auto-migration rather than saying "session data is preserved in ~/.config/prefect/".

Gaps 1 and 2 may resolve to the same root cause: a deliberate choice to use the unscoped `legate` package name. If that choice is accepted, RENAME-01 must be updated and the roadmap success criteria reworded accordingly.

---

_Verified: 2026-05-17_
_Verifier: Claude (gsd-verifier)_
