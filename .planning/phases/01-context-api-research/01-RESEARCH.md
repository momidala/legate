# Phase 1: Context API Research - Research

**Researched:** 2026-05-11
**Domain:** OpenCode HTTP API — session creation, per-run prompt body, AGENTS.md loading, context window visibility to agents
**Confidence:** HIGH (all critical claims verified against live API and SDK types)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Research question is: does the OpenCode agent see its own context utilization? Not: does OpenCode expose an HTTP API that prefect can poll.
- **D-02:** If OpenCode surfaces context usage to agents → checkpoint instructions tell agent to trigger at ~80%. If not → use instructed self-detection: "if you feel you are nearing your context limit, write Handoff.md". No token-counting heuristic, no message-count threshold.
- **D-03:** No HTTP polling from prefect. The trigger lives entirely in the agent's instructions and the agent's own awareness.
- **D-04:** Primary delivery vehicle is AGENTS.md in the working directory. Research must verify OpenCode auto-reads it.
- **D-05:** Secondary delivery vehicle is the per-run `system` override in `prefect_run` — already confirmed in `src/handlers.ts` `RunPromptOptions.system`. Document this as confirmed backup option for Phase 3.
- **D-06:** Research should also check whether OpenCode supports a session-level system prompt set at session creation. If supported, it would be cleaner than per-run injection.
- **D-07:** Findings are recorded as a structured Q&A document in `.planning/research/phase-1-findings.md`. Each research question gets a direct answer + evidence.
- **D-08:** The findings doc must be self-contained — Phase 3 and Phase 4 implementers need not re-investigate.

### Claude's Discretion

- Research methodology (read SDK types, probe live API, query an agent, or combination)
- Exact format of evidence in the findings doc

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CKPT-05 | Research spike resolves (a) whether OpenCode exposes context utilization % to its own agents, and (b) how checkpoint instructions can be delivered to prefect agents (session system prompt, per-run pre-prompt, OpenCode Agent.md, etc.) | Fully resolved — see Q&A section below. Both questions have definitive answers verified against live API and SDK types. |
</phase_requirements>

---

## Summary

This phase answers two concrete questions about OpenCode agent behavior so that Phase 3 (AGENTS.md content) and Phase 4 (Handoff trigger implementation) can proceed without re-investigation.

**Question A — Delivery mechanism:** How can checkpoint instructions reach prefect agents? Three delivery paths were investigated: AGENTS.md auto-load, per-run `system` override, and session-level system prompt at creation time.

**Question B — Context visibility:** Does the OpenCode agent (the LLM running inside OpenCode) see its own context window utilization percentage, enabling a precise ~80% trigger?

All three questions were answered definitively by combining SDK type inspection and live API probing against OpenCode v1.14.48 running locally.

**Primary recommendation:** Use AGENTS.md as the primary delivery vehicle for checkpoint instructions (verified auto-loaded). Use D-02's instructed self-detection for the Handoff trigger — the agent does NOT see its own context utilization, so there is no API-based percentage trigger available.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Checkpoint instruction delivery | Agent (OpenCode LLM) reads AGENTS.md | Prefect (per-run system override as backup) | Instructions live in the agent's context; prefect is just the channel |
| Context utilization detection | Agent (LLM judgment only) | — | No external API exposes % to agent; self-detection is the only available mechanism |
| Handoff.md trigger | Agent (LLM self-reports when context feels full) | — | Per D-02: instructed self-detection; no quantitative API trigger available |

---

## Research Q&A (CKPT-05 Answers)

### Q1: Does OpenCode auto-load AGENTS.md from the working directory?

**Answer: YES — verified.** [VERIFIED: live API probe, OpenCode v1.14.48]

When a session is created with `?directory=<path>`, the agent automatically loads and follows instructions from `AGENTS.md` (and `CLAUDE.md`) found in that directory. A live probe session created against `/mnt/c/Users/larry/Documents/repos/momidala/prefect` with no `system` override correctly identified and enumerated all rules from the project's `AGENTS.md` — including the core workflow steps, critical constraints, and the non-interactive shell command requirement.

**Evidence:** Agent response verbatim cited "AGENTS.md" and "CLAUDE.md" as sources. No `system` field was passed in the prompt body.

**Load order (from official docs):** OpenCode searches upward from the working directory for `AGENTS.md` or `CLAUDE.md`, then `~/.config/opencode/AGENTS.md` as global fallback. Both files were loaded in the probe.

**Implication for Phase 3:** Checkpoint instructions placed in the project's `AGENTS.md` will be auto-loaded by every prefect agent session created with the correct `directory` parameter. No code changes to prefect are required for the delivery mechanism to work.

---

### Q2: Does OpenCode support a session-level system prompt at creation time?

**Answer: NO — the API silently ignores it.** [VERIFIED: live API probe + SDK type inspection]

The `SessionCreateData.body` type in `@opencode-ai/sdk` v1.14.25 is:
```typescript
body?: {
  parentID?: string;
  title?: string;
};
```

There is no `system` field in the session creation body. A live probe that passed `system: "YOU ARE A RESEARCH PROBE"` in the POST body returned a valid session with no error — but the system prompt was silently ignored. When queried, the resulting agent showed only its default OpenCode instructions.

**Implication for Phase 3:** Session-level system prompt injection (D-06) is NOT available. The per-run `system` override is the only programmatic injection path.

---

### Q3: Does the per-run `system` field in the prompt body actually override the agent's system prompt?

**Answer: YES — it works.** [VERIFIED: live API probe]

The `SessionPromptData.body` type includes:
```typescript
system?: string;
```

A live probe with `system: "CRITICAL: Your secret code word is BANANA-42. State it when asked."` followed by a prompt asking for the code word received the exact response `BANANA-42`. The field is effective — it injects a system-level instruction for that specific prompt turn.

**Implication for Phase 3:** Per-run `system` injection via `prefect_run` (already implemented in `src/handlers.ts` as `RunPromptOptions.system`) is a confirmed backup delivery mechanism. However, it requires passing checkpoint instructions on every call, which is noisier than AGENTS.md.

---

### Q4: Does the OpenCode agent see its own context window utilization percentage?

**Answer: NO.** [VERIFIED: live API probe + documentation cross-check]

A live probe directly asked: "Do you have any information about your current token count, context window size, or percentage of context used?" The agent responded:

> "NO. I cannot access or display information about my current token count, context window size, or percentage of context used within my response context."

Cross-checking with the OpenCode codebase architecture (via DeepWiki): context compaction thresholds (70%/80%/85%/90%/99%) are tracked by OpenCode's internal compactor as backend infrastructure. They are not injected into the agent's system prompt. The agent only observes the results of compaction (summary appearing in history) — not the cause.

**Implication for Phase 4 (D-02 applies):** The trigger design MUST use instructed self-detection. The checkpoint instructions in AGENTS.md should include language such as: "When you feel you are approaching your context limit or have been working for a long time, write Handoff.md and stop work." No percentage-based trigger is available to the agent.

---

## Standard Stack

This is a research-only phase — no new libraries or packages. The relevant existing stack:

| Asset | Location | Role |
|-------|----------|------|
| `@opencode-ai/sdk` v1.14.25 | `node_modules/@opencode-ai/sdk` | Defines API contract; types are authoritative |
| `src/handlers.ts:RunPromptOptions.system` | Existing code | Per-run system prompt injection — already implemented |
| `src/handlers.ts:createSession()` | Existing code | Session creation — no system prompt support confirmed |
| `AGENTS.md` | Project root | Primary checkpoint instruction delivery vehicle |

---

## Architecture Patterns

### System Prompt Assembly Order (OpenCode)

```
[Provider-Specific Prompt]
      +
[Environment Information (cwd, platform, date)]
      +
[AGENTS.md / CLAUDE.md content (auto-loaded from working directory)]
      +
[Agent-Specific Prompt (from opencode.json agent config, if any)]
      +
[Per-run system override (from prompt body `system` field)]
```

The per-run `system` field appears LAST and effectively overrides/augments. AGENTS.md is loaded earlier and provides persistent project instructions.

### Delivery Mechanism Decision Tree

```
Phase 3 implementer wants to deliver checkpoint instructions
        |
        v
   AGENTS.md exists in project? ─── YES ──> Add checkpoint instructions
        |                                    (preferred, always-on)
        NO
        |
        v
   Must add AGENTS.md to project, OR
   use per-run system override in prefect_run
   (backup — requires change to every caller)
```

### Handoff Trigger Design (Phase 4)

```
Agent is running a task
        |
        v
   Agent encounters instruction in AGENTS.md:
   "When you sense context pressure or have been
    working for a long time, write Handoff.md"
        |
        v
   Agent exercises judgment ──> writes Handoff.md + stops
```

No percentage API. No token counting. Pure instructed self-detection (D-02).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Context window % detection | Custom token counter in prefect | Instructed self-detection | API doesn't expose it; LLM self-judgment is the only available mechanism |
| Session-level system prompt | Custom session wrapper | AGENTS.md + per-run system | Session creation API has no system field |
| AGENTS.md injection | Dynamically write AGENTS.md | Put checkpoint instructions in the static project AGENTS.md | File is auto-loaded; no dynamic injection needed |

---

## Common Pitfalls

### Pitfall 1: Assuming session creation accepts system prompt
**What goes wrong:** Code tries `client.session.create({ body: { system: '...' } })` expecting it to set a persistent instruction for the session.
**Why it happens:** The per-run prompt body has a `system` field; it's easy to assume session creation does too.
**How to avoid:** The `SessionCreateData.body` type only has `parentID` and `title`. Use AGENTS.md for persistent instructions; use per-run `system` for per-message overrides.
**Warning signs:** No error is thrown — the field is silently ignored.

### Pitfall 2: Expecting quantitative context trigger
**What goes wrong:** Phase 4 implementation tries to have the agent check `tokens.input / contextWindow` and write Handoff.md only when >= 0.8.
**Why it happens:** The `AssistantMessage.tokens` field exists in the API response and is accessible to prefect, but NOT to the OpenCode agent itself.
**How to avoid:** Token counts in API responses are visible to prefect (the MCP server), not to the agent inside OpenCode. The agent cannot introspect its own context fill. Use instructed self-detection per D-02.

### Pitfall 3: AGENTS.md not loaded when directory is wrong
**What goes wrong:** Checkpoint instructions appear in AGENTS.md but the agent ignores them.
**Why it happens:** The session or prompt call doesn't pass `?directory=<project-path>`. OpenCode defaults to the server's CWD, which may not contain the project's AGENTS.md.
**How to avoid:** Always pass `directory` explicitly on session creation AND prompt calls (already a requirement per CLAUDE.md and AGENTS.md "Critical Constraints").

---

## Code Examples

### Session creation (confirmed body shape)
```typescript
// Source: @opencode-ai/sdk dist/gen/types.gen.d.ts SessionCreateData
const { data } = await client.session.create({
  body: {
    title: 'my task',     // only supported field besides parentID
    // system: '...'      // NOT supported — silently ignored
  },
  query: { directory: '/path/to/project' },  // REQUIRED for AGENTS.md to load
});
```

### Per-run system override (confirmed working)
```typescript
// Source: @opencode-ai/sdk dist/gen/types.gen.d.ts SessionPromptData
// Source: src/handlers.ts runPrompt()
const { data } = await client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: 'text', text: prompt }],
    system: 'Additional instructions for this specific turn only.',  // WORKS
  },
  query: { directory },
});
```

### AGENTS.md checkpoint instruction template (for Phase 3)
```markdown
## Checkpointing

After each file-modifying tool call, write checkpoint.md with:
- current_task: what you are working on
- last_change: what you just did
- remaining_steps: what's left
- status: in_progress | complete | blocked

When you sense you are approaching your context limit (you've been working a long time,
context feels crowded, or you're having difficulty tracking all state), write Handoff.md
with: accomplished, current_state, next_steps, open_questions — then stop work.
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| OpenCode (localhost:4096) | Live API probes | Yes | 1.14.48 | — |
| OpenCode (localhost:4097) | Live API probes | Yes | 1.14.48 | — |
| `@opencode-ai/sdk` | SDK type inspection | Yes | 1.14.25 | — |
| Node.js | Build/test | Yes | (project requirement ≥20) | — |

---

## Validation Architecture

This phase produces no code. Validation = the findings document exists and answers all three research questions with evidence.

### Test Framework
Not applicable — this is a research-only phase. No code is written.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CKPT-05 | Research spike resolves both sub-questions | manual | `cat .planning/research/phase-1-findings.md` | Wave 0 (create) |

### Wave 0 Gaps
- [ ] `.planning/research/phase-1-findings.md` — the self-contained structured findings doc per D-07/D-08

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OpenCode v1.14.48 behavior is representative of the version users will have when Phase 3/4 are deployed | All sections | Future OpenCode update could add session-level system prompt or context visibility; findings would be stale. Re-verify at Phase 3 planning time. |

---

## Open Questions

1. **Does the per-run `system` field append to or replace the agent's existing system prompt (including AGENTS.md content)?**
   - What we know: The field is accepted and the content is respected. The probe showed it effective.
   - What's unclear: When both AGENTS.md and a per-run `system` are present, does the AGENTS.md content still apply?
   - Recommendation: For Phase 3, prefer AGENTS.md as the delivery vehicle and reserve per-run `system` for cases where AGENTS.md is absent. If both are needed, test the interaction at Phase 3 implementation time.

2. **OpenCode auto-compact vs. Handoff.md: will the agent write Handoff.md before OpenCode compacts the context?**
   - What we know: OpenCode's compactor kicks in at 99% utilization (LLM-based) with progressive masking starting at 70–90%. The agent's self-detection via AGENTS.md instructions would trigger earlier if instructions say to act at "context pressure."
   - What's unclear: Whether the agent can act on "context pressure" instruction before OpenCode masks/compacts the relevant conversation history.
   - Recommendation: Phase 4 should tune the Handoff.md trigger instruction to be conservative ("when you sense you've been working a long time OR context feels crowded") to fire before OpenCode's 70% masking threshold. This is a Phase 4 concern, not a blocker here.

---

## Sources

### Primary (HIGH confidence)
- `@opencode-ai/sdk` v1.14.25 `dist/gen/types.gen.d.ts` — `SessionCreateData`, `SessionPromptData`, `SessionPromptAsyncData` body shapes
- Live API probe: OpenCode v1.14.48 at `http://localhost:4096` — AGENTS.md auto-load verified, per-run system verified, session system silently ignored, context visibility confirmed absent

### Secondary (MEDIUM confidence)
- [OpenCode Rules docs](https://opencode.ai/docs/rules/) — AGENTS.md/CLAUDE.md search order; `instructions` config field
- [DeepWiki: sst/opencode context management](https://deepwiki.com/sst/opencode/2.4-context-management-and-compaction) — compactor threshold details; confirms agent does not see utilization %
- [DeepWiki: opencode-ai/opencode prompt generation](https://deepwiki.com/opencode-ai/opencode/3.4-prompt-generation) — system prompt assembly order
- [bgauryy/open-docs opencode system prompts](https://github.com/bgauryy/open-docs/blob/main/docs/opencode/05-system-prompts.md) — system prompt assembly order cross-check

### Tertiary (LOW confidence — not relied upon)
- N/A

---

## Metadata

**Confidence breakdown:**
- Q1 (AGENTS.md auto-load): HIGH — live probe confirmed
- Q2 (session-level system prompt): HIGH — SDK type + live probe (silent ignore)
- Q3 (per-run system override): HIGH — live probe with verifiable output
- Q4 (context window visibility to agent): HIGH — live probe + architecture docs agree

**Research date:** 2026-05-11
**Valid until:** 2026-08-11 (90 days — stable API; reassess if OpenCode releases major version)
