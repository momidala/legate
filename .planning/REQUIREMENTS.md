# Requirements: Prefect v2.1

**Defined:** 2026-05-11
**Core Value:** Claude Code can delegate coding work to local models and review the result — keeping the orchestration context clean while local compute handles the edits.

## v2.1 Requirements

Requirements for the Developer Experience milestone.

### Self-Update (SELFUP)

- [ ] **SELFUP-01**: When `@momidala/prefect` is installed globally, the `/prefect-update` Claude command file is automatically copied to `~/.claude/commands/`
- [ ] **SELFUP-02**: When `@momidala/prefect` is uninstalled, the `/prefect-update` command file is automatically removed from `~/.claude/commands/`
- [ ] **SELFUP-03**: User can run `/prefect-update` in Claude Code to update the prefect package to the latest version
- [ ] **SELFUP-04**: `/prefect-update` verifies and displays the new version number after updating
- [ ] **SELFUP-05**: `/prefect-update` reminds the user to restart Claude Code after a successful update

### Checkpointing (CKPT)

- [ ] **CKPT-01**: Prefect agents (OpenCode agents spawned via `prefect_run`) receive checkpoint instructions and write `checkpoint.md` after each file-modifying tool call (delivery mechanism: researched in CKPT-05)
- [ ] **CKPT-02**: `checkpoint.md` follows a defined schema (current task, last change, remaining steps, status)
- [x] **CKPT-03**: When a prefect agent's context reaches ~80%, the agent writes `Handoff.md` and stops work (trigger mechanism: researched in CKPT-05)
- [ ] **CKPT-04**: `Handoff.md` follows a defined schema (accomplished, current state, next steps, open questions)
- [ ] **CKPT-05**: Research spike resolves (a) whether OpenCode exposes context utilization % to its own agents, and (b) how checkpoint instructions can be delivered to prefect agents (session system prompt, per-run pre-prompt, OpenCode Agent.md, etc.)

## Future Requirements

Deferred to a future release.

### Self-Update
- Auto-check for updates on server start (notify if stale version detected)

### Checkpointing
- Optional: checkpoint.md committed automatically with a standard message
- Optional: Handoff.md includes a `resume` command users can paste to pick up where they left off

## Out of Scope

| Feature | Reason |
|---------|--------|
| GSD dependency for checkpointing | Must work without GSD installed — AGENTS.md is the delivery vehicle |
| Cloud/remote OpenCode support | Prefect targets local instances only |
| Windows native paths | WSL2 is the assumed execution environment |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CKPT-05 | Phase 1 | Pending |
| SELFUP-01 | Phase 2 | Pending |
| SELFUP-02 | Phase 2 | Pending |
| SELFUP-03 | Phase 2 | Pending |
| SELFUP-04 | Phase 2 | Pending |
| SELFUP-05 | Phase 2 | Pending |
| CKPT-01 | Phase 3 | Pending |
| CKPT-02 | Phase 3 | Pending |
| CKPT-04 | Phase 3 | Pending |
| CKPT-03 | Phase 4 | Complete |

**Coverage:**
- v2.1 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-11*
*Last updated: 2026-05-12 — CKPT-03 marked complete (Phase 4)*
