---
phase: 05-rename
plan: "03"
subsystem: documentation
tags:
  - documentation
  - migration
  - gitattributes
  - rename

dependency_graph:
  requires:
    - phase: 05-rename/05-02b
      provides: All source modules renamed to LEGATE_* with deprecation chains; 117 tests green
  provides:
    - README.md with full legate branding and Migrating from @momidala/prefect section
    - EXAMPLE_CLAUDE.md, AGENTS.md, CLAUDE.md, examples/test-task.md, examples/uat-v2.md all renamed to legate_*/LEGATE_*/legate branding
    - .gitattributes with *.ts linguist-language=TypeScript
  affects:
    - Human verification checkpoint (Task 3 — awaiting approval)

tech-stack:
  added: []
  patterns:
    - All seven documentation rename rules applied in specificity order to avoid double-substitution
    - Migration section in README.md as single canonical migration entry point (all other docs are forward-looking only)

key-files:
  created:
    - .gitattributes
  modified:
    - README.md
    - EXAMPLE_CLAUDE.md
    - AGENTS.md
    - CLAUDE.md
    - examples/test-task.md
    - examples/uat-v2.md

decisions:
  - "README.md is the sole migration entry point — EXAMPLE_CLAUDE.md, AGENTS.md, and examples/* are forward-looking docs with zero legacy prefect references"
  - ".gitattributes created with single line '*.ts linguist-language=TypeScript' (34 bytes) to fix GitHub Linguist classification"
  - "~/.config/prefect/ runtime config dir paths preserved literally in all 6 docs per REQUIREMENTS.md out-of-scope ruling"

metrics:
  duration: 25min
  completed: "2026-05-17"
  tasks_completed: 2
  files_modified: 7
---

# Phase 05 Plan 03: Documentation Rename and .gitattributes Summary

**Six documentation files updated to legate branding with migration note for existing @momidala/prefect users; .gitattributes created for GitHub Linguist TypeScript classification**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-05-17
- **Tasks:** 2 of 3 complete (Task 3 is human verification checkpoint — awaiting approval)
- **Files modified:** 7 (6 docs updated + 1 new file)

## Accomplishments

### Task 1: README.md

Applied all seven documentation rename rules in specificity order:
1. `@momidala/prefect` → `@momidala/legate` (all occurrences except migration section)
2. `prefect-update` → `legate-update`
3. `prefect-mcp` → `legate-mcp`
4. `prefect_*` tool name prefix → `legate_*` (40 tools referenced)
5. `PREFECT_*` env var prefix → `LEGATE_*` (7 env vars)
6. Standalone `prefect` binary/package name → `legate`
7. `Prefect` capitalized prose brand → `Legate`

Added `## Migrating from @momidala/prefect` section with 5 steps:
- Step 1: `npm uninstall -g @momidala/prefect`
- Step 2: `npm install -g @momidala/legate`
- Step 3: `legate init --force` to overwrite .mcp.json prefect key with legate
- Step 4: rename PREFECT_* env vars to LEGATE_* (with backward compat note)
- Step 5: `~/.config/prefect/` session data is preserved — no manual cleanup

Preserved all `~/.config/prefect/` runtime config dir path references (out of scope per REQUIREMENTS.md).

### Task 2: Secondary docs + .gitattributes

Applied same seven rename rules to:
- **EXAMPLE_CLAUDE.md** — Example project CLAUDE.md showing legate setup
- **AGENTS.md** — Agent-facing reference with legate tool names and env vars
- **CLAUDE.md** (project root) — Project Claude instructions fully renamed; headings like "When to Use the Legate Tools", tool table uses legate_*
- **examples/test-task.md** — End-to-end smoke test updated; commit message in step 5 now says "test: validate full legate loop"
- **examples/uat-v2.md** — Comprehensive UAT script (163 → 0 prefect-prefix tokens); all CLI commands, tool invocations, inline code snippets updated; `~/.config/prefect/` paths preserved at lines 31 and 942

Created **`.gitattributes`** at project root:
```
*.ts linguist-language=TypeScript
```
File size: 34 bytes (single line with trailing newline). This forces GitHub Linguist to classify `.ts` files as TypeScript instead of JavaScript (the `#!/usr/bin/env node` shebang on `build/cli.js` and `build/index.js` misleads Linguist's heuristics).

## Final grep counts

| File | `prefect_` | `PREFECT_` | `@momidala/prefect` | `prefect-mcp` | Notes |
|------|-----------|-----------|---------------------|---------------|-------|
| README.md | 0 | 9 | 3 | 0 | PREFECT_/@momidala/prefect only in migration section (intentional) |
| EXAMPLE_CLAUDE.md | 0 | 0 | 0 | 0 | Fully renamed |
| AGENTS.md | 0 | 0 | 0 | 0 | Fully renamed |
| CLAUDE.md | 0 | 0 | 0 | 0 | Fully renamed |
| examples/test-task.md | 0 | 0 | 0 | 0 | Fully renamed |
| examples/uat-v2.md | 0 | 0 | 1 | 0 | @momidala/legate header only (version note); fully renamed |

## .gitattributes verification

```
$ cat .gitattributes
*.ts linguist-language=TypeScript
$ wc -c .gitattributes
34 .gitattributes
```

## Task Commits

1. **Task 1: README.md rewrite** — `c15a378` (docs)
2. **Task 2: Secondary docs + .gitattributes** — `b9520cf` (docs)

## Awaiting

Task 3 is a `checkpoint:human-verify` gate. The executor stopped here to await human approval. The resume signal is "approved" (or a description of issues found).

**Verification steps for the human reviewer:**
1. Open README.md and confirm: install instructions show `npm install -g @momidala/legate`, tool examples reference `legate_*`, env var examples reference `LEGATE_*`, "Migrating from @momidala/prefect" section is present with 5 steps including backward compat note and preserved `~/.config/prefect/` note.
2. Run: `grep -rn "prefect_\|PREFECT_" CLAUDE.md AGENTS.md EXAMPLE_CLAUDE.md examples/test-task.md examples/uat-v2.md` — expect zero matches.
3. Run: `cat .gitattributes` — expect exactly: `*.ts linguist-language=TypeScript`
4. Optional: skim examples/uat-v2.md for stale prefect_ tool calls.
5. Run: `npm test` — expect 117/117 tests pass (doc-only changes; no source touched).

## Deviations from Plan

### None

Plan executed exactly as written. All seven documentation rename rules applied in correct specificity order. Migration section added with all required content. .gitattributes created with exact specified content.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All changes are documentation-only and the new `.gitattributes` file.

Threat mitigations:
- T-05-12: Migration note uses generic placeholder column headers (`LEGATE_SERVER_PASSWORD` name only, no actual credential values)
- T-05-13: README install instructions now show `@momidala/legate` exclusively (outside migration section); `@momidala/prefect` only in migration section headings and uninstall command
- T-05-15: `.gitattributes` content exactly `*.ts linguist-language=TypeScript` (34 bytes); standard Linguist syntax

## Known Stubs

None. All documentation references correct tool names, env vars, and binary names as implemented in Plans 02 and 02b.

## Self-Check: PASSED

Files exist:
- FOUND: README.md (modified — legate branding + migration section)
- FOUND: EXAMPLE_CLAUDE.md (modified — legate branding)
- FOUND: AGENTS.md (modified — legate branding)
- FOUND: CLAUDE.md (modified — legate branding)
- FOUND: examples/test-task.md (modified — legate branding)
- FOUND: examples/uat-v2.md (modified — legate branding)
- FOUND: .gitattributes (created — TypeScript Linguist override)

Commits exist:
- c15a378: docs(05-03): rename README.md to legate branding with migration section
- b9520cf: docs(05-03): rename secondary docs to legate branding; add .gitattributes

---
*Phase: 05-rename*
*Completed: 2026-05-17 (Tasks 1-2); Task 3 awaiting human verification*
