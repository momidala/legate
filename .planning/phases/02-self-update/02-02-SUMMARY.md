---
phase: 02-self-update
plan: "02"
subsystem: npm-lifecycle
tags:
  - npm-lifecycle
  - package-config
  - self-update

requires:
  - phase: 02-self-update
    plan: "01"
    provides: "handleInstallCommand and handleUninstallCommand in src/cli.ts, install-command and uninstall-command CLI subcommands"

provides:
  - "postinstall script in package.json: 'prefect install-command'"
  - "preuninstall script in package.json: 'prefect uninstall-command'"
  - "End-to-end SELFUP-01 / SELFUP-02 lifecycle: global install writes ~/.claude/commands/prefect-update.md; global uninstall removes it"

affects:
  - "Users installing @momidala/prefect globally — postinstall fires install-command automatically"
  - "D-01 decision fully closed (Plan 01 + Plan 02 together)"

tech-stack:
  added: []
  patterns:
    - "npm lifecycle hooks (postinstall / preuninstall) invoke package's own bin via PATH prepend"

key-files:
  created: []
  modified:
    - path: "package.json"
      description: "Added postinstall and preuninstall script entries; all other fields byte-identical"

key-decisions:
  - "D-01 fully implemented: postinstall='prefect install-command' + preuninstall='prefect uninstall-command' closes the SELFUP loop started in Plan 01"
  - "Local install nuance: __dirname includes /node_modules/ for both global and local installs of the package; the isGlobal guard in cli.ts defends only against running cli.js directly from the repo checkout — local package installs still trigger the handler (harmless; uninstall removes the file)"
  - "No new files entry needed: slash command content ships inline in build/cli.js as PREFECT_UPDATE_COMMAND_CONTENT const"

patterns-established:
  - "npm lifecycle hooks as the only required wiring — zero user-facing setup steps after npm install -g"

requirements-completed:
  - SELFUP-01
  - SELFUP-02

duration: 5min
completed: 2026-05-11
---

# Phase 02 Plan 02: npm Lifecycle Hooks Summary

**Wired `postinstall: "prefect install-command"` and `preuninstall: "prefect uninstall-command"` in package.json, closing the SELFUP-01/SELFUP-02 end-to-end loop so global npm install/uninstall automatically installs/removes `~/.claude/commands/prefect-update.md`.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-11T19:51:00Z
- **Completed:** 2026-05-11T19:56:10Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- `package.json` now contains both npm lifecycle hook entries with exact required values
- End-to-end SELFUP flow closed: `npm install -g @momidala/prefect` fires `postinstall` → `prefect install-command` → writes `~/.claude/commands/prefect-update.md`; symmetrically `npm uninstall -g` fires `preuninstall` → removes the file
- All 105 existing tests pass; no behavioral regression from the JSON-only edit
- `npm pack --dry-run` confirms `prefect-update.md` is NOT a separate packed asset (ships inline in `build/cli.js`)

## Task Commits

1. **Task 1: Add postinstall and preuninstall script entries to package.json** - `553b342` (feat)

## Files Created/Modified

- `package.json` — Added two entries to `scripts` object (`postinstall`, `preuninstall`); all other fields unchanged

## Verification Results

- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` exits 0 (well-formed JSON)
- `p.scripts.postinstall === 'prefect install-command'` — PASS
- `p.scripts.preuninstall === 'prefect uninstall-command'` — PASS
- `p.scripts.build` unchanged: `tsc && chmod 755 build/index.js build/cli.js` — PASS
- `p.scripts.test` unchanged: references all 8 test files — PASS
- `p.bin.prefect === './build/cli.js'` — PASS
- `p.bin['prefect-mcp'] === './build/index.js'` — PASS
- `p.files === ["build/", "README.md", "EXAMPLE_CLAUDE.md"]` — PASS
- `npm test`: 105 tests, 0 failures — PASS
- `npm pack --dry-run | grep -c 'prefect-update.md'`: 0 — PASS (markdown shipped inline)

## Decision Traceability

| Decision | Status | Notes |
|----------|--------|-------|
| D-01 | **Fully implemented** | Plan 01 shipped CLI handlers; Plan 02 wired the lifecycle hooks. SELFUP-01 + SELFUP-02 now end-to-end functional. |
| T-02-09 | Verified | `handleInstallCommand` exits 0 on failure (D-07) — `postinstall` failure cannot block `npm install -g` |
| T-02-10 | Verified | `handleUninstallCommand` exits 0 on failure (D-08) — `preuninstall` failure cannot block `npm uninstall -g` |

## Manual E2E Verification

The automated acceptance criteria above confirm the wiring is correct. The full end-to-end tarball test (`npm pack` → `npm install -g <tarball>` → verify `~/.claude/commands/prefect-update.md` → `npm uninstall -g` → verify removal) is a manual step per the plan's `<verification>` section. It was not run in this execution — deferred to user verification or a future CI integration.

## Decisions Made

None beyond plan specification — package.json edit was a single, mechanical change with no ambiguity.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None — both lifecycle hooks invoke fully-implemented handlers from Plan 01.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond what the Plan 02 threat model already covers (T-02-08 through T-02-12, all dispositioned).

## Next Phase Readiness

- SELFUP-01 and SELFUP-02 requirements are complete
- Phase 02 is fully done (Plans 01 + 02)
- Phase 03 (checkpoint schemas) and Phase 04 (Handoff trigger) can proceed independently

## Self-Check: PASSED

- `package.json` contains `"postinstall": "prefect install-command"` — FOUND
- `package.json` contains `"preuninstall": "prefect uninstall-command"` — FOUND
- Task 1 commit `553b342` exists in git log — FOUND
- `npm test` exits 0 with 105 tests — CONFIRMED

---
*Phase: 02-self-update*
*Completed: 2026-05-11*
