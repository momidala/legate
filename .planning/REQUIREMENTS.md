# Requirements: Prefect v2.2 Legate

## Milestone Goal

Rename the package from `@momidala/prefect` to `legate` (unscoped) across all surfaces, add a condensed skill card installed via `legate init`, and update documentation.

---

## v2.2 Requirements

### Rename (RENAME)

- [x] **RENAME-01**: Package name changed from `@momidala/prefect` to `legate` (unscoped) in package.json — deliberate decision: unscoped npm publish identity
- [x] **RENAME-02**: All CLI binaries renamed — `prefect` → `legate`, `prefect-mcp` → `legate-mcp` in package.json and all string references in src/cli.ts
- [x] **RENAME-03**: All `prefect_*` tool names renamed to `legate_*` across src/index.ts, src/handlers.ts, CLAUDE.md, README.md, and examples/
- [x] **RENAME-04**: All `PREFECT_*` env vars renamed to `LEGATE_*` with soft migration — read both, prefer new, warn on old (one-time per process) — covering: `LEGATE_SERVER_URL`, `LEGATE_SERVER_PASSWORD`, `LEGATE_SERVER_USERNAME`, `LEGATE_DEFAULT_PROJECT`, `LEGATE_TIMEOUT_MS`, `LEGATE_AUTOSTART_TIMEOUT_MS`, `LEGATE_SESSION_TTL_MS`; existing `OPENCODE_*` fallback chain preserved

### Skills Wrapper (SKILL)

- [x] **SKILL-01**: `legate init` installs a skill file to `~/.claude/commands/legate.md` — a condensed reference card covering all tools, parameters, and the canonical loop in minimal tokens
- [ ] **SKILL-02**: Skill file replaces verbose tool descriptions in Claude Code context — Claude reads the skill card instead of loading full MCP schemas
- [x] **SKILL-03**: Skill file includes the canonical loop, available workers section (auto-generated from servers.json at install time), and one-line descriptions per tool group
- [x] **SKILL-04**: `legate init` also installs `~/.claude/commands/legate-update.md` — triggers `npm install -g legate` via bash tool then reminds user to restart Claude Code
- [x] **SKILL-05**: Skill files are versioned — `legate init` overwrites on reinstall to stay current; `legate uninstall-command` removes both files

### Documentation (DOC)

- [x] **DOC-01**: All user-facing docs updated — README.md, EXAMPLE_CLAUDE.md, AGENTS.md, examples/test-task.md, examples/uat-v2.md — reflecting new package name, binary names (`legate` / `legate-mcp`), env var names (`LEGATE_*`), tool names (`legate_*`), install instructions (`npm install -g legate`), and migration note for existing `@momidala/prefect` users
- [x] **DOC-02**: Add `.gitattributes` with `*.ts linguist-language=TypeScript` to fix GitHub's misclassification of TypeScript files as JavaScript (caused by `#!/usr/bin/env node` shebang heuristic)

---

## Future Requirements

*(none identified — rename scope is complete)*

---

## Out of Scope

- Alias/shim for old `prefect` binary — users reinstall the package; no backward binary compat needed
- Automated migration script for users — migration note in README is sufficient
- Renaming the GitHub repo or npm org — out of scope for this milestone

## Decisions Made During Implementation

- **Unscoped package name**: Published as `legate` (not `@momidala/legate`). All install instructions use `npm install -g legate`. RENAME-01 and DOC-01 reflect this.
- **Config directory migrated**: `~/.config/prefect/` → `~/.config/legate/`. Auto-migration via `cpSync` on first run preserves existing session data. Originally listed as out of scope; explicitly accepted during Phase 5 execution. README migration section documents this behavior.

---

## Traceability

| Requirement | Phase | Plan |
|-------------|-------|------|
| RENAME-01 | Phase 5 | TBD |
| RENAME-02 | Phase 5 | TBD |
| RENAME-03 | Phase 5 | TBD |
| RENAME-04 | Phase 5 | TBD |
| DOC-01 | Phase 5 | TBD |
| DOC-02 | Phase 5 | TBD |
| SKILL-01 | Phase 6 | TBD |
| SKILL-02 | Phase 6 | TBD |
| SKILL-03 | Phase 6 | TBD |
| SKILL-04 | Phase 6 | TBD |
| SKILL-05 | Phase 6 | TBD |
