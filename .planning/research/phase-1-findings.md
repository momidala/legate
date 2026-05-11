# Phase 1 Findings: Context API Research

**Completed:** 2026-05-11
**OpenCode version tested:** 1.14.48
**SDK version:** @opencode-ai/sdk 1.14.25
**Status:** Final — Phase 3 and Phase 4 implementers can rely on these findings directly.

---

## For Phase 3 Implementers (Checkpoint Schemas + Delivery)

Required reading from this doc:
- Finding 1: AGENTS.md auto-load mechanism (the delivery vehicle)
- Finding 2: Why session-level system prompt is unavailable
- Finding 3: Per-run `system` field as backup
- Canonical AGENTS.md Checkpoint Instruction Template (paste this verbatim)
- Delivery Mechanism Summary table

You DO NOT need to read: `.planning/phases/01-context-api-research/01-CONTEXT.md`, `01-RESEARCH.md`, or rerun any OpenCode API probes.

## For Phase 4 Implementers (Handoff Trigger)

Required reading from this doc:
- Finding 4: Context utilization is NOT visible to the agent
- Trigger Design Summary table
- Canonical AGENTS.md Checkpoint Instruction Template (Handoff paragraph)
- Open Question: per-run `system` vs AGENTS.md interaction (test this if you need both)

You DO NOT need to read: `.planning/phases/01-context-api-research/01-CONTEXT.md` or `01-RESEARCH.md`.

---

## Finding 1: AGENTS.md is auto-loaded by OpenCode agents

**Answer:** YES — confirmed.

When `prefect_run` creates a session with an explicit `directory` parameter, OpenCode automatically loads `AGENTS.md` (and `CLAUDE.md`) from that directory and includes them in the agent's system context. No code changes to prefect are needed.

**Evidence:** Live API probe against OpenCode v1.14.48. A session was created at the prefect project root. The first prompt (with no `system` override) asked the agent to list its project-specific instructions. The agent correctly cited and enumerated all rules from both `AGENTS.md` and `CLAUDE.md`, naming both files as sources.

**Load order:**
1. Search upward from `directory` for `AGENTS.md` or `CLAUDE.md`
2. Fall back to `~/.config/opencode/AGENTS.md` (global)
3. Merge with any paths listed in `opencode.json` `instructions` field

**Critical precondition:** The `directory` parameter MUST be passed on both `session.create()` and `session.prompt()` calls. If omitted, OpenCode defaults to the server's working directory — which may not contain the project's `AGENTS.md`. This is already enforced by existing AGENTS.md and CLAUDE.md instructions: "Always pass `directory` explicitly to all tools."

**Implication for Phase 3:** Add checkpoint and Handoff instructions directly to the project's `AGENTS.md`. They will be present in every agent context without any prefect code changes.

---

## Finding 2: Session creation does NOT support a system prompt parameter

**Answer:** NO system prompt at session creation — silently ignored.

The `session.create()` body accepts only:
```
{ parentID?: string; title?: string; }
```

Passing `system: "..."` in the session creation body produces no error but has no effect. Verified by: (1) SDK type definition confirms only `parentID` and `title`; (2) live probe passed a system prompt at creation and the resulting agent showed no trace of it.

**Implication for Phase 3:** No session-level persistent system prompt injection exists. Delivery options are: AGENTS.md (preferred) or per-run `system` field (backup, see Finding 3).

---

## Finding 3: Per-run `system` field in `session.prompt()` body WORKS

**Answer:** YES — confirmed.

The `session.prompt()` body includes `system?: string`. When passed, the content is effective as an additional system-level instruction for that prompt turn.

**Evidence:** Live probe with `system: "CRITICAL: Your secret code word is BANANA-42. State it when asked."` → agent responded `BANANA-42` when asked. Deterministic, immediate effect.

**SDK type:**
```typescript
// SessionPromptData.body (from @opencode-ai/sdk dist/gen/types.gen.d.ts)
body?: {
  messageID?: string;
  model?: { providerID: string; modelID: string; };
  agent?: string;
  noReply?: boolean;
  system?: string;    // <-- this works
  tools?: { [key: string]: boolean; };
  parts: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>;
};
```

**Already implemented in prefect:** `src/handlers.ts` `RunPromptOptions.system` maps directly to this field. Users can pass `system` via `prefect_run`.

**Implication for Phase 3:** Per-run `system` injection is a confirmed backup delivery path. It is noisier than AGENTS.md (requires passing checkpoint instructions on every `prefect_run` call) but works. Use AGENTS.md as primary; per-run `system` as fallback for environments without an AGENTS.md.

---

## Finding 4: OpenCode agents do NOT see their own context window utilization

**Answer:** NO context window percentage is visible to the agent.

**Evidence (live probe):** Direct question to a live OpenCode agent: "Do you have any information about your current token count, context window size, or percentage of context used?"

Agent response:
> "NO. I cannot access or display information about my current token count, context window size, or percentage of context used within my response context."

**Architecture confirmation:** OpenCode's internal compactor monitors token utilization against the context window at thresholds of 70% (warning), 80% (observation masking), 85% (fast pruning), 90% (aggressive masking), and 99% (LLM-based full compaction). This compactor runs as backend infrastructure and does NOT inject utilization metrics into the agent's system prompt. The agent only observes the side-effects of compaction (e.g., a summary appearing where conversation history was) — not the cause or percentage.

Note: The `AssistantMessage.tokens` object (`{ input, output, reasoning, cache: { read, write } }`) IS returned in the OpenCode HTTP API response that prefect receives. Prefect (the MCP server) can see token counts per-message. The OpenCode agent (the LLM) cannot.

**Implication for Phase 4 (applies D-02):** The Handoff.md trigger MUST use instructed self-detection. The AGENTS.md checkpoint instructions should instruct the agent to write Handoff.md when it "senses context pressure" or "has been working for a long time" — relying on the LLM's own judgment. No percentage calculation, no token counting, no external API call.

---

## Canonical AGENTS.md Checkpoint Instruction Template

Phase 3 implementers: paste the following block into the project `AGENTS.md` under a new `## Checkpointing` section. Do not modify the wording without re-testing the trigger sensitivity.

```markdown
## Checkpointing

After each file-modifying tool call (`edit`, `write`, `apply_patch`), update `checkpoint.md` in the working directory with:
- **current_task:** what you are working on
- **last_change:** what you just did (file path + one-line summary)
- **remaining_steps:** what is left
- **status:** `in_progress` | `complete` | `blocked`

When you sense you are approaching your context limit — for example, if you have been
working for a long time, if tracking all state feels difficult, or if the conversation
feels crowded — write `Handoff.md` in the working directory with:
- **accomplished:** what was completed this session
- **current_state:** where the work stands now (which files, which step)
- **next_steps:** what should happen next, in order
- **open_questions:** anything you were unsure about

After writing `Handoff.md`, stop initiating new work in this session. Do not wait for an error.
```

---

## Delivery Mechanism Summary

| Mechanism | Supported | Persistent | Requires Code Change | Recommended |
|-----------|-----------|------------|---------------------|-------------|
| AGENTS.md (auto-load) | YES | YES (per session) | No | Primary |
| Per-run `system` field | YES | No (per message) | No (already in RunPromptOptions) | Backup |
| Session creation system prompt | NO (silently ignored) | — | — | Do not use |

---

## Trigger Design Summary

| Approach | Available | Decision |
|----------|-----------|----------|
| Agent reads context % from API | No | N/A |
| Agent reads token count from system prompt injection | No | N/A |
| Instructed self-detection ("write Handoff.md when context feels full") | Yes | USE THIS (D-02) |

**Canonical trigger instruction for AGENTS.md (Phase 3 starting point):**
```
When you sense you are approaching your context limit — for example, if you have been
working for a long time, if tracking all state feels difficult, or if the conversation
feels crowded — write Handoff.md and stop work. Do not wait for an error.
```

---

## Open Question for Phase 4

**Q: Does the per-run `system` field append to or replace AGENTS.md content?**

If both AGENTS.md and a per-run `system` are present, the interaction is untested. The safe design is: put checkpoint instructions in AGENTS.md and avoid concurrent per-run `system` injection for checkpoint purposes. If a caller needs both, test the interaction before relying on it.

---

*Source: `.planning/phases/01-context-api-research/01-RESEARCH.md`*
*Verified: 2026-05-11 against OpenCode v1.14.48, @opencode-ai/sdk v1.14.25*

*Audit: 2026-05-11 — verified D-07 (structured Q&A) and D-08 (self-contained for Phase 3/4) compliance.*
