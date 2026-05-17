# Requirements: Prefect v2.2 Legate

## Milestone Goal

Rename the package from @momidala/prefect to @momidala/legate across all surfaces, add a condensed skill card installed via `legate init`, and update documentation.

---

## v2.2 Requirements

### Rename (RENAME)

- [ ] **RENAME-01**: Package name changed from `@momidala/prefect` to `@momidala/legate` in package.json
- [ ] **RENAME-02**: All CLI binaries renamed — `prefect` → `legate`, `prefect-mcp` → `legate-mcp` in package.json and all string references in src/cli.ts
- [ ] **RENAME-03**: All `prefect_*` tool names renamed to `legate_*` across src/index.ts, src/handlers.ts, CLAUDE.md, README.md, and examples/
- [ ] **RENAME-04**: All `PREFECT_*` env vars renamed to `LEGATE_*` with soft migration — read both, prefer new, warn on old (one-time per process) — covering: `LEGATE_SERVER_URL`, `LEGATE_SERVER_PASSWORD`, `LEGATE_SERVER_USERNAME`, `LEGATE_DEFAULT_PROJECT`, `LEGATE_TIMEOUT_MS`, `LEGATE_AUTOSTART_TIMEOUT_MS`, `LEGATE_SESSION_TTL_MS`; existing `OPENCODE_*` fallback chain preserved

### Skills Wrapper (SKILL)

- [ ] **SKILL-01**: `legate init` installs a skill file to `~/.claude/commands/legate.md` — a condensed reference card covering all tools, parameters, and the canonical loop in minimal tokens
- [ ] **SKILL-02**: Skill file replaces verbose tool descriptions in Claude Code context — Claude reads the skill card instead of loading full MCP schemas
- [ ] **SKILL-03**: Skill file includes the canonical loop, available workers section (auto-generated from servers.json at install time), and one-line descriptions per tool group
- [ ] **SKILL-04**: `legate init` also installs `~/.claude/commands/legate-update.md` — triggers `npm install -g @momidala/legate` via bash tool then reminds user to restart Claude Code
- [ ] **SKILL-05**: Skill files are versioned — `legate init` overwrites on reinstall to stay current; `legate uninstall-command` removes both files

### Documentation (DOC)

- [ ] **DOC-01**: All user-facing docs updated — README.md, EXAMPLE_CLAUDE.md, AGENTS.md, examples/test-task.md, examples/uat-v2.md — reflecting new package name, binary names (`legate` / `legate-mcp`), env var names (`LEGATE_*`), tool names (`legate_*`), install instructions (`npm install -g @momidala/legate`), and migration note for existing `@momidala/prefect` users
- [ ] **DOC-02**: Add `.gitattributes` with `*.ts linguist-language=TypeScript` to fix GitHub's misclassification of TypeScript files as JavaScript (caused by `#!/usr/bin/env node` shebang heuristic)

---

## Future Requirements

*(none identified — rename scope is complete)*

---

## Out of Scope

- Alias/shim for old `prefect` binary — users reinstall the package; no backward binary compat needed
- Automated migration script for users — migration note in README is sufficient
- Renaming the GitHub repo or npm org — out of scope for this milestone
- Renaming internal config directory (`~/.config/prefect/`) — would break existing sessions.json; out of scope

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
