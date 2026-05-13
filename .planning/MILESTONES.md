# Milestones

## v2.1 — Developer Experience (Shipped 2026-05-13)

**Phases:** 4 | **Plans:** 5 | **Timeline:** 2026-05-11 → 2026-05-13

**Shipped:**
- Research confirmed AGENTS.md auto-load as checkpoint delivery mechanism; instructed self-detection as handoff trigger (OpenCode does not expose context % to agents)
- `install-command` / `uninstall-command` CLI subcommands write/remove `~/.claude/commands/prefect-update.md`
- `postinstall` / `preuninstall` npm lifecycle hooks wire zero-step global install and uninstall
- `/prefect-update` slash command: runs `npm install -g @momidala/prefect@latest`, displays new version, prompts restart
- `## Checkpointing` section in `AGENTS.md` delivering checkpoint.md and Handoff.md schemas to prefect agents
- Handoff.md trigger via instructed self-detection ("conversation feels crowded" phrase + stop instruction)

**Archive:** `.planning/milestones/v2.1-ROADMAP.md`

---

## v2.0 — Core Foundation (Completed)

**Shipped:**
- Multi-server registry with unique host:port enforcement
- Session lifecycle management (TTL pruning, liveness verification)
- Race condition mitigations for stale-busy status
- HTTP Basic Auth support (`PREFECT_SERVER_PASSWORD`)
- `prefect version` CLI command
- Comprehensive test suite (95+ tests)
- Multi-server configuration documentation

**Last phase:** v2.0.4

---
