# Roadmap: Prefect v2.1 Developer Experience

## Overview

v2.1 adds two independent developer experience improvements: a self-update mechanism so users can update prefect from within Claude Code, and automatic checkpointing so prefect agents (OpenCode agents spawned via `prefect_run`) write progress state and hand off cleanly when their context fills. The research spike runs first to establish both the context-utilization trigger and the delivery mechanism for agent instructions. All four phases deliver verifiable, user-observable capabilities.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Context API Research** - Spike resolves how (or whether) to detect 80% context utilization and produces a concrete trigger design
- [ ] **Phase 2: Self-Update** - npm lifecycle hooks install/remove the `/prefect-update` Claude command automatically; command updates the package and prompts restart
- [ ] **Phase 3: Checkpoint Schemas + AGENTS.md** - AGENTS.md gains checkpoint instructions; checkpoint.md and Handoff.md schemas are defined and documented
- [ ] **Phase 4: Handoff Trigger** - Context-utilization trigger fires Handoff.md write at ~80% based on research findings from Phase 1

## Phase Details

### Phase 1: Context API Research
**Goal**: A concrete, documented decision on (a) how prefect agents receive checkpoint instructions, and (b) how/whether an OpenCode agent can detect ~80% context utilization to trigger Handoff.md
**Depends on**: Nothing (first phase)
**Requirements**: CKPT-05
**Findings**: `.planning/research/phase-1-findings.md` (self-contained Q&A; Phase 3/4 read this — not CONTEXT.md or RESEARCH.md)
**Success Criteria** (what must be TRUE):
  1. Research finding answers: what mechanism can deliver persistent instructions to prefect agents (OpenCode session system prompt, per-run pre-prompt, OpenCode Agent.md, or other)?
  2. Research finding answers: does OpenCode expose context utilization % to its own agents via any accessible API or event?
  3. The findings specify the exact delivery mechanism and trigger design to use (or explicitly declare them non-automatable with a fallback)
  4. Findings are recorded in `.planning/research/` so Phase 3 and Phase 4 implementers need no re-investigation
**Plans:** 1 plan
Plans:
- [x] 01-01-PLAN.md — Audit findings doc for D-07/D-08 compliance; wire decisions into PROJECT.md and ROADMAP.md

### Phase 2: Self-Update
**Goal**: Users who install `@momidala/prefect` globally get the `/prefect-update` Claude command automatically, can run it to upgrade prefect, and are told to restart Claude Code afterward
**Depends on**: Nothing (parallel to Phase 1; requires no research)
**Requirements**: SELFUP-01, SELFUP-02, SELFUP-03, SELFUP-04, SELFUP-05
**Success Criteria** (what must be TRUE):
  1. Running `npm install -g @momidala/prefect` causes `~/.claude/commands/prefect-update.md` to exist without any manual step
  2. Running `npm uninstall -g @momidala/prefect` removes `~/.claude/commands/prefect-update.md`
  3. Running `/prefect-update` inside Claude Code executes `npm update -g @momidala/prefect` (or equivalent) and completes without error
  4. After a successful update, the new version number is displayed in the Claude Code chat
  5. After a successful update, the command outputs a reminder to restart Claude Code
**Plans:** 2 plans
Plans:
- [x] 02-01-PLAN.md — Add install-command and uninstall-command CLI subcommands (with inline /prefect-update template) plus tests
- [ ] 02-02-PLAN.md — Wire postinstall and preuninstall lifecycle hooks in package.json


### Phase 3: Checkpoint Schemas + Delivery
**Goal**: Prefect agents automatically write `checkpoint.md` after each file-modifying tool call, following a defined schema; `Handoff.md` schema is also defined; instructions are wired via the delivery mechanism found in Phase 1
**Depends on**: Phase 1 (delivery mechanism)
**Findings (Phase 1 → Phase 3 inputs)**: `.planning/research/phase-1-findings.md` — Finding 1 (AGENTS.md auto-load), Finding 2 (no session-level system prompt), Finding 3 (per-run `system` backup), Canonical AGENTS.md Checkpoint Instruction Template
**Requirements**: CKPT-01, CKPT-02, CKPT-04
**Success Criteria** (what must be TRUE):
  1. Checkpoint instructions are delivered to prefect agents via the mechanism identified in Phase 1 (session system prompt, pre-prompt, OpenCode Agent.md, or other)
  2. The `checkpoint.md` schema (current task, last change, remaining steps, status) is defined and referenced in the delivery artifact
  3. The `Handoff.md` schema (accomplished, current state, next steps, open questions) is defined and discoverable without reading source code
  4. A prefect agent following the delivered instructions can produce a valid `checkpoint.md` without ambiguity about what fields to include
**Plans**: TBD

### Phase 4: Handoff Trigger
**Goal**: When a prefect agent's context reaches ~80%, the agent writes `Handoff.md` and stops work, using the trigger mechanism identified in Phase 1
**Depends on**: Phase 1 (trigger design), Phase 3 (Handoff.md schema and delivery wiring)
**Findings (Phase 1 → Phase 4 inputs)**: `.planning/research/phase-1-findings.md` — Finding 4 (context % NOT visible to agent), Trigger Design Summary (instructed self-detection per D-02), Open Question (per-run `system` vs AGENTS.md interaction — test at implementation time)
**Requirements**: CKPT-03
**Success Criteria** (what must be TRUE):
  1. The delivery mechanism (from Phase 1/3) causes a prefect agent to write `Handoff.md` at approximately 80% context utilization
  2. After writing `Handoff.md`, the prefect agent stops initiating new work in that session
  3. `Handoff.md` content conforms to the schema defined in Phase 3
  4. A developer reading `Handoff.md` has enough context to resume the work without re-reading the entire session chat
**Plans**: TBD

## Progress

**Execution Order:**
Recommended: 1 → 2 → 3 → 4
Phase 2 is independent of all others. Phase 3 depends on Phase 1 (delivery mechanism). Phase 4 depends on Phase 1 and Phase 3.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Context API Research | 1/1 | Complete | 2026-05-11 |
| 2. Self-Update | 0/TBD | Not started | - |
| 3. Checkpoint Schemas + AGENTS.md | 0/TBD | Not started | - |
| 4. Handoff Trigger | 0/TBD | Not started | - |
