# Roadmap: Prefect

## Milestones

- ✅ **v2.1 Developer Experience** — Phases 1–4 (shipped 2026-05-13)
- **v2.2 Legate** — Phases 5–6 (active)

## Phases

<details>
<summary>✅ v2.1 Developer Experience (Phases 1–4) — SHIPPED 2026-05-13</summary>

- [x] Phase 1: Context API Research (1/1 plans) — completed 2026-05-11
- [x] Phase 2: Self-Update (2/2 plans) — completed 2026-05-11
- [x] Phase 3: Checkpoint Schemas + Delivery (1/1 plans) — completed 2026-05-11
- [x] Phase 4: Handoff Trigger (1/1 plans) — completed 2026-05-12

Full archive: `.planning/milestones/v2.1-ROADMAP.md`

</details>

### v2.2 Legate

- [ ] **Phase 5: Rename** — Rename package, binaries, tool names, and env vars from prefect to legate across all source files and documentation
- [ ] **Phase 6: Skill Card** — Add `legate init` command that installs condensed reference skill cards to `~/.claude/commands/`

## Phase Details

### Phase 5: Rename
**Goal**: The package is published, installed, and used as `@momidala/legate` with `legate_*` tool names and `LEGATE_*` env vars; existing `PREFECT_*` users get a migration path
**Depends on**: Nothing (first phase of v2.2)
**Requirements**: RENAME-01, RENAME-02, RENAME-03, RENAME-04, DOC-01, DOC-02
**Success Criteria** (what must be TRUE):
  1. `npm install -g @momidala/legate` installs the package and exposes `legate` and `legate-mcp` binaries
  2. All MCP tools visible in Claude Code are named `legate_*` (e.g. `legate_run`, `legate_create_session`)
  3. A user who sets `PREFECT_SERVER_URL` gets a deprecation warning and the server still connects; a user who sets `LEGATE_SERVER_URL` gets no warning
  4. README accurately reflects the new package name, binary names, env var names, and includes a migration note for existing prefect users
**Plans**: TBD

### Phase 6: Skill Card
**Goal**: `legate init` installs versioned skill cards that give Claude Code a compact reference to the canonical loop and all tools, replacing verbose MCP schema loading
**Depends on**: Phase 5
**Requirements**: SKILL-01, SKILL-02, SKILL-03, SKILL-04, SKILL-05
**Success Criteria** (what must be TRUE):
  1. Running `legate init` creates `~/.claude/commands/legate.md` and `~/.claude/commands/legate-update.md` on a fresh machine
  2. Running `legate init` a second time overwrites both files with the current version (idempotent reinstall)
  3. The installed `legate.md` card includes the canonical loop, one-line descriptions for each tool group, and an auto-generated workers section reflecting the current servers.json
  4. Running `legate uninstall-command` removes both installed files
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Context API Research | v2.1 | 1/1 | Complete | 2026-05-11 |
| 2. Self-Update | v2.1 | 2/2 | Complete | 2026-05-11 |
| 3. Checkpoint Schemas + Delivery | v2.1 | 1/1 | Complete | 2026-05-11 |
| 4. Handoff Trigger | v2.1 | 1/1 | Complete | 2026-05-12 |
| 5. Rename | v2.2 | 0/? | Not started | - |
| 6. Skill Card | v2.2 | 0/? | Not started | - |
