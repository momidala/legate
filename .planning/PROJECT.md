# Prefect

## What This Is

Prefect is a TypeScript MCP server that bridges Claude Code to a locally running OpenCode instance, exposing OpenCode's full capabilities (116+ providers, 21 agents, ~85 slash commands, 14 tools) as MCP tools. It is published as `@momidala/prefect` and designed for developers who use Claude Code as their primary orchestrator but want to delegate coding tasks to locally-running models via OpenCode.

## Core Value

Claude Code can delegate coding work to local models and review the result — keeping the orchestration context clean while local compute handles the edits.

## Current Milestone: v2.1 Developer Experience

**Goal:** Add self-update and automatic checkpointing to improve the day-to-day developer workflow for prefect users.

**Target features:**
- Self-update mechanism (npm lifecycle hooks + `/prefect-update` Claude command)
- Automatic checkpointing via AGENTS.md pre-prompt (after each file modification; Handoff.md at ~80% context)

## Requirements

### Validated

- ✓ Multi-server registry with unique host:port enforcement — v2.0
- ✓ Session lifecycle management (TTL pruning, liveness verification) — v2.0
- ✓ Race condition mitigations for stale-busy status — v2.0
- ✓ HTTP Basic Auth support — v2.0
- ✓ `prefect version` CLI command — v2.0
- ✓ Multi-server configuration documentation — v2.0

### Active

- [ ] npm postinstall/preuninstall hooks install and remove `/prefect-update` Claude command
- [ ] `/prefect-update` command updates package, verifies version, prompts restart
- [ ] AGENTS.md pre-prompt instructs checkpointing after each file-modifying tool call
- [ ] Handoff.md written when context reaches ~80% (implementation TBD pending research)

### Out of Scope

- GSD dependency — no .planning/ or gsd-sdk dependency for checkpointing; must be standalone
- Cloud/remote OpenCode — prefect targets local OpenCode instances only
- Windows native paths — WSL2 assumed as execution environment

## Context

- TypeScript ESM project with a strict test suite (95+ tests via Node's built-in test runner)
- Published to npm as a public scoped package; users install globally with `npm install -g @momidala/prefect`
- AGENTS.md already exists in the repo and is committed; adding checkpoint instructions there means all Claude Code sessions pick them up automatically
- OpenCode context utilization API: unknown — needs research before implementing the 80% cutoff trigger

## Constraints

- **No GSD dependency**: Checkpointing must work without GSD installed — AGENTS.md is the delivery vehicle
- **ESM-only**: All scripts must be `.js` ESM (no CJS `require`)
- **Node ≥ 20**: Target runtime for all scripts

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| AGENTS.md as checkpoint delivery | Auto-loaded by Claude Code without any extra setup; no GSD dependency | ✓ Good |
| npm lifecycle hooks for command install | Matches how users already install the package; no manual setup step | ✓ Good |
| Context % as handoff trigger (not message count) | Tied to actual resource pressure rather than arbitrary message count | — Pending (needs OpenCode research) |

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
*Last updated: 2026-05-11 — Milestone v2.1 started*
