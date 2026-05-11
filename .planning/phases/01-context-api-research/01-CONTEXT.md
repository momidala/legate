# Phase 1: Context API Research - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase is a research spike that produces concrete answers to three questions about OpenCode agent behavior. The output is a structured findings document that Phase 3 and Phase 4 implementers act on directly — no re-investigation needed.

**What this phase delivers:** A documented answer to each research question, not an implementation.
**What this phase does NOT deliver:** Code changes, new features, or schema definitions (those are Phase 3+).

</domain>

<decisions>
## Implementation Decisions

### Fallback Trigger Design

- **D-01:** The research question is: **does the OpenCode agent see its own context utilization** (e.g., displayed in its context window or injected by OpenCode)? Not: does OpenCode expose an HTTP API that prefect can poll.
- **D-02:** If OpenCode surfaces context usage to agents → checkpoint instructions will tell the agent to trigger at ~80%. If not → checkpoint instructions use **instructed self-detection**: the agent uses its own judgment ("if you feel you are nearing your context limit, write Handoff.md"). No token-counting heuristic, no message-count threshold.
- **D-03:** No HTTP polling from prefect. The trigger lives entirely in the agent's instructions and the agent's own awareness.

### Delivery Mechanism Scope

- **D-04:** Primary delivery vehicle is **AGENTS.md** in the working directory (already confirmed for Claude Code, carries forward from PROJECT.md Key Decisions). Research must verify OpenCode auto-reads it.
- **D-05:** Secondary delivery vehicle is the **per-run `system` override** in `prefect_run` — already confirmed to exist in the codebase (`src/handlers.ts` `RunPromptOptions.system`). Document this as a confirmed backup option for Phase 3.
- **D-06:** Research should also check whether OpenCode supports a **session-level system prompt** set at session creation. If supported, it would be cleaner than per-run injection (no change to callers required). This is a bonus finding — not a blocker.

### Research Output

- **D-07:** Findings are recorded as a **structured Q&A document** in `.planning/research/phase-1-findings.md`. Each research question gets a direct answer + evidence (SDK types, API response, test result, or source reference). No free-form prose, no dead-end dumps.
- **D-08:** The findings doc must be self-contained — Phase 3 and Phase 4 implementers should not need to read this CONTEXT.md or re-investigate. The findings doc is the canonical input to those phases.

### Claude's Discretion

- Research methodology (read SDK types, probe live API, query an agent, or combination) — Claude decides based on what's fastest to get a definitive answer.
- Exact format of evidence in the findings doc (code snippets, API responses, prose) — Claude decides.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Delivery Mechanism (existing code)
- `src/handlers.ts` — `RunPromptOptions.system` field (per-run system prompt override, already supported)
- `src/index.ts` — `prefect_run` and `prefect_prompt_async` tool definitions with `system` parameter

### Requirements and Constraints
- `.planning/REQUIREMENTS.md` — CKPT-05 requirement definition; Out of Scope table (no GSD dependency)
- `.planning/PROJECT.md` — Key Decisions table (AGENTS.md delivery decision); Constraints section (ESM-only, Node ≥ 20)

### OpenCode SDK
- `@opencode-ai/sdk` — installed in `node_modules/@opencode-ai/sdk` — TypeScript types are the primary source for what the API supports (session creation body, prompt body, response shapes)

### Existing AGENTS.md
- `AGENTS.md` — the project's current AGENTS.md; useful as a reference for what checkpoint instructions will be added in Phase 3

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/handlers.ts:RunPromptOptions` — already has `system?: string` field; per-run system prompt injection is fully implemented
- `src/handlers.ts:createSession()` — session creation function; check its `client.session.create()` call body to see if a system prompt parameter exists
- `@opencode-ai/sdk` types in `node_modules` — primary evidence source for what session and prompt APIs support

### Established Patterns
- All API calls go through `createOpencodeClient()` from `@opencode-ai/sdk` — SDK types define the contract
- Session creation uses `client.session.create({ body: {...}, query: {...} })` — check body shape for system prompt support

### Integration Points
- Phase 1 output feeds directly into Phase 3 AGENTS.md content and Phase 4 trigger implementation
- No code changes in Phase 1 — research only

</code_context>

<specifics>
## Specific Ideas

- The delivery research has a known answer to confirm (AGENTS.md ✓ Good) plus two unknowns to discover (session-level system prompt, context visibility to agents)
- Research can start by reading `@opencode-ai/sdk` TypeScript types (fast, authoritative for API shape) then test against live OpenCode if types are ambiguous

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-context-api-research*
*Context gathered: 2026-05-11*
