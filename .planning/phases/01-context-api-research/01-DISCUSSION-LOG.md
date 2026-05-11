# Phase 1: Context API Research - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 01-context-api-research
**Areas discussed:** Fallback trigger design, Delivery mechanism scope, Research output format

---

## Fallback Trigger Design

| Option | Description | Selected |
|--------|-------------|----------|
| Instructed self-detection | Checkpoint instructions tell the agent to write Handoff.md when it feels near context limit. No API needed — agent uses judgment. Works today, everywhere. | ✓ |
| Token counting heuristic | Prefect estimates accumulated tokens from message history and injects a "you're at 80%" signal. Brittle, model-dependent. | |
| Message count threshold | After N messages, instruct agent to write Handoff.md. Crude proxy, easy to implement. | |

**User's choice:** Instructed self-detection

**Notes:** User clarified the research question: not "does prefect have an HTTP API to poll context %", but "does the OpenCode agent itself see its own context utilization in its context window?" If yes, instruct at 80%. If no, fall back to instructed self-detection by judgment. No HTTP polling from prefect in either case.

---

## Delivery Mechanism Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm AGENTS.md + document per-run system prompt as backup | Verify OpenCode reads AGENTS.md; also confirm per-run system override as backup. | ✓ |
| Confirm AGENTS.md only | Just verify AGENTS.md works. Simpler but leaves backup undocumented. | |
| Full investigation of all options | Research all delivery mechanisms from scratch. More thorough, more time. | |

**User's choice:** Confirm AGENTS.md + document per-run system prompt as backup

**Follow-up Q:** Should research also check for session-level system prompt support at creation time?
**User's choice:** Yes — check for session-level support (cleaner than per-run if available)

**Notes:** Three delivery mechanisms to document: (1) AGENTS.md — verify works for OpenCode, (2) per-run `system` override — already confirmed in code, document it, (3) session-level system prompt at creation — check if supported, bonus finding.

---

## Research Output Format

| Option | Description | Selected |
|--------|-------------|----------|
| Structured Q&A doc | Direct answers to three research questions with evidence. Maximally actionable. | ✓ |
| ADR-style decision record | What we decided and why. Better for posterity than Phase 3/4 usability. | |
| Full investigation report | Everything explored including dead ends. Complete but slower to act on. | |

**User's choice:** Structured Q&A doc

**Notes:** Output goes to `.planning/research/phase-1-findings.md`. Must be self-contained — Phase 3/4 implementers should not need to re-investigate.

---

## Claude's Discretion

- Research methodology (read SDK types, probe live API, query an agent, or combination)
- Exact format of evidence in the findings doc

## Deferred Ideas

None.
