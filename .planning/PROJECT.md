# Prefect

## What This Is

Prefect is a TypeScript MCP server that bridges Claude Code to a locally running OpenCode instance, exposing OpenCode's full capabilities (116+ providers, 21 agents, ~85 slash commands, 14 tools) as MCP tools. It is published as `@momidala/prefect` and designed for developers who use Claude Code as their primary orchestrator but want to delegate coding tasks to locally-running models via OpenCode.

## Core Value

Claude Code can delegate coding work to local models and review the result — keeping the orchestration context clean while local compute handles the edits.

## Shipped: v2.1 Developer Experience — ✅ 2026-05-13

Added self-update (npm lifecycle hooks + `/prefect-update` Claude command) and automatic checkpointing (AGENTS.md delivery; Handoff.md at agent context pressure).

## Requirements

### Validated

- ✓ Multi-server registry with unique host:port enforcement — v2.0
- ✓ Session lifecycle management (TTL pruning, liveness verification) — v2.0
- ✓ Race condition mitigations for stale-busy status — v2.0
- ✓ HTTP Basic Auth support — v2.0
- ✓ `prefect version` CLI command — v2.0
- ✓ Multi-server configuration documentation — v2.0
- ✓ Prefect agents receive checkpoint instructions and write checkpoint.md after each file-modifying tool call (delivery mechanism: AGENTS.md auto-load) — Validated in Phase 3: checkpoint-schemas-delivery
- ✓ Handoff.md written by prefect agent when context pressure is sensed (trigger mechanism: instructed self-detection via AGENTS.md `## Checkpointing` section) — Validated in Phase 4: handoff-trigger (CKPT-03)
- ✓ npm postinstall/preuninstall hooks install/remove `/prefect-update` Claude command automatically — v2.1
- ✓ `/prefect-update` command updates package, displays new version, prompts restart — v2.1

### Active

*(none — planning next milestone)*

### Out of Scope

- GSD dependency — no .planning/ or gsd-sdk dependency for checkpointing; must be standalone
- Cloud/remote OpenCode — prefect targets local OpenCode instances only
- Windows native paths — WSL2 assumed as execution environment

## Context

- TypeScript ESM project with a strict test suite (95+ tests via Node's built-in test runner)
- Published to npm as a public scoped package; users install globally with `npm install -g @momidala/prefect`
- Checkpoint instructions are delivered to prefect agents via AGENTS.md auto-load in the working directory (Phase 1 research finding). Per-run `system` field in `prefect_run` is a confirmed backup mechanism. Session-level system prompt at creation is NOT supported. See `.planning/research/phase-1-findings.md`.
- OpenCode does NOT expose context utilization % to its own agents (Phase 1 research finding). The Handoff.md trigger therefore uses instructed self-detection — the agent's own judgment on when context feels crowded — not a token-count or percentage threshold. See `.planning/research/phase-1-findings.md` Finding 4.

## Constraints

- **No GSD dependency**: Checkpointing must work without GSD installed — AGENTS.md is the delivery vehicle
- **ESM-only**: All scripts must be `.js` ESM (no CJS `require`)
- **Node ≥ 20**: Target runtime for all scripts

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| AGENTS.md as checkpoint delivery | Auto-loaded by Claude Code without any extra setup; no GSD dependency | ✓ Good |
| npm lifecycle hooks for command install | Matches how users already install the package; no manual setup step | ✓ Good |
| Handoff trigger via instructed self-detection (not context %) | OpenCode does not surface context % to agents; LLM self-judgment is the only available signal — see `.planning/research/phase-1-findings.md` Finding 4 | ✓ Decided (Phase 1) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-13 after v2.1 milestone — all 10 requirements shipped. Self-update and checkpointing delivered. Ready for next milestone.*
