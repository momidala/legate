# Phase 4: Handoff Trigger — Research

**Researched:** 2026-05-12
**Domain:** LLM instructed self-detection trigger — verifying CKPT-03 satisfaction via AGENTS.md
**Confidence:** HIGH (all technical questions resolved in Phase 1; Phase 3 delivered the trigger instruction into the delivery surface)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CKPT-03 | When a prefect agent's context reaches ~80%, the agent writes `Handoff.md` and stops work (trigger mechanism: researched in CKPT-05) | Trigger mechanism is instructed self-detection (Phase 1 D-02 / Finding 4). The trigger instruction was wired into `AGENTS.md` in Phase 3. The `## Checkpointing` section (verified present, correct wording) constitutes the complete trigger implementation. Phase 4 closes the requirement by verifying the instruction is present and well-formed, and by updating tracking artifacts to record CKPT-03 as satisfied. |

</phase_requirements>

---

## Summary

Phase 4 is a **verification and tracking close-out phase**. The Handoff.md trigger was designed in Phase 1 (instructed self-detection, D-02) and wired into the delivery surface in Phase 3 (AGENTS.md `## Checkpointing` section). As of Phase 3 completion, all four of Phase 4's success criteria are already satisfied by the existing `AGENTS.md` content.

The trigger mechanism (CKPT-03) works as follows: OpenCode agents spawned via `prefect_run` with an explicit `directory` parameter automatically load `AGENTS.md` from that directory into their system context (Phase 1 Finding 1, VERIFIED). The `## Checkpointing` section in `AGENTS.md` (added in Phase 3) contains the calibrated trigger phrase: "When you sense you are approaching your context limit — for example, if you have been working for a long time, if tracking all state feels difficult, or if the conversation feels crowded — write `Handoff.md` in the working directory..." followed immediately by the Handoff.md schema and the stop instruction. No API call, token counter, or message-count heuristic is involved — the LLM's own judgment triggers the handoff.

Phase 4's deliverable is: (1) verify the trigger instruction is present and well-formed in AGENTS.md, (2) confirm the Handoff.md schema satisfies the CKPT-03 success criteria, and (3) close the CKPT-03 tracking entries in REQUIREMENTS.md and ROADMAP.md.

**Primary recommendation:** Phase 4 is one verification task + one tracking update. No code changes. No AGENTS.md changes. The trigger is already live.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Handoff trigger detection | Agent (LLM judgment) | — | Context % is not visible to the agent (Phase 1 Finding 4, VERIFIED). Only LLM self-detection is available. |
| Trigger instruction delivery | AGENTS.md (auto-loaded file) | Per-run `system` field (backup) | OpenCode auto-loads AGENTS.md from session `directory`. Already in Phase 3. |
| Handoff.md schema | AGENTS.md | — | Schema defined inline in `## Checkpointing` section. Already in Phase 3. |
| CKPT-03 tracking close-out | Planning artifacts (REQUIREMENTS.md, ROADMAP.md) | STATE.md | Mark CKPT-03 satisfied; update phase progress. |

---

## Standard Stack

No new libraries. No source code changes. This is a verification and tracking phase.

### The Only Files That Change

| File | Role | Change |
|------|------|--------|
| `REQUIREMENTS.md` | Requirement tracking | Mark `CKPT-03` as `[x]` (satisfied) |
| `ROADMAP.md` | Roadmap progress table | Mark Phase 4 row as complete |
| `STATE.md` | Project state | Update phase progress to 100% |

`AGENTS.md` is NOT changed — the trigger instruction is already present and correct.

---

## Architecture Patterns

### System Architecture Diagram: Handoff Trigger Data Flow

```
prefect_run(sessionId, prompt, directory="<project>")
        |
        v
OpenCode agent session receives AGENTS.md content
  (auto-loaded from <project>/AGENTS.md — Phase 1 Finding 1, VERIFIED)
        |
        v
AGENTS.md ## Checkpointing section is in agent's system context
  Contains: calibrated trigger phrase + Handoff.md schema + stop instruction
        |
        v
Agent works on task
  - After each edit/write/apply_patch: writes checkpoint.md (CKPT-01/02)
        |
        v
Agent notices: "I have been working for a long time /
               tracking all state feels difficult /
               conversation feels crowded"
               (LLM self-detection — the ONLY available signal, per Phase 1 Finding 4)
        |
        v
Agent writes Handoff.md with four fields:
  accomplished | current_state | next_steps | open_questions
  (schema already defined in AGENTS.md ## Checkpointing — CKPT-04, done in Phase 3)
        |
        v
Agent stops initiating new work
  (per explicit stop instruction in AGENTS.md:
   "After writing Handoff.md, stop initiating new work in this session.
    Do not wait for an error.")
        |
        v
CKPT-03 satisfied
```

### Pattern: Instructed Self-Detection (D-02)

**What:** The trigger is a natural-language instruction that asks the agent to use its own judgment about context saturation. No numeric threshold. No token counting. No external API call.

**When to use:** Always — this is the only available approach because OpenCode's compactor does not inject utilization metrics into the agent's context (Phase 1 Finding 4, VERIFIED).

**Exact trigger instruction in AGENTS.md (lines 110–116):**
```
When you sense you are approaching your context limit — for example, if you have been
working for a long time, if tracking all state feels difficult, or if the conversation
feels crowded — write `Handoff.md` in the working directory with:
- **accomplished:** what was completed this session
- **current_state:** where the work stands now (which files, which step)
- **next_steps:** what should happen next, in order
- **open_questions:** anything you were unsure about

After writing `Handoff.md`, stop initiating new work in this session. Do not wait for an error.
```

Source: `AGENTS.md` lines 110–116 [VERIFIED: read directly in this session, 2026-05-12]

**The "~80%" approximation:** CKPT-03 specifies "~80% context utilization." Since the agent has no visibility into exact utilization percentage (Phase 1 Finding 4), the instructed self-detection approach is calibrated to fire near that threshold by describing the *subjective experience* of a full context ("tracking all state feels difficult", "conversation feels crowded"). These descriptions map reasonably to a context that is substantially utilized. The `~` in the requirement acknowledges this is approximate.

### Phase 4 Project Structure (No Changes Needed)

```
(no new files — all changes are to existing planning artifacts)

Planning artifacts updated:
.planning/
├── REQUIREMENTS.md      — mark CKPT-03 [x]
├── ROADMAP.md           — mark Phase 4 complete in Progress table
└── STATE.md             — update progress counters to 100%
```

### Anti-Patterns to Avoid

- **Adding a token-counting heuristic in prefect source code:** Finding 4 confirms no API for context %. Any custom implementation in prefect would be guessing (message count, character count) with no grounding. D-03 explicitly forbids HTTP polling from prefect.
- **Re-wiring the trigger instruction in Phase 4:** The AGENTS.md `## Checkpointing` section already contains the trigger. Adding another instruction in Phase 4 would duplicate it and risk conflicting wording.
- **Changing the calibrated trigger phrasing:** Phase 3 research explicitly documented that the phrase "if you have been working for a long time, if tracking all state feels difficult, or if the conversation feels crowded" is calibrated for LLM compliance. Phase 4 must not modify it.
- **Treating Phase 4 as a code phase:** CKPT-03 is satisfied by instruction delivery, not by code. No `src/` changes are needed or appropriate.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Context % trigger | Token counter, message-count heuristic, polling loop in prefect | Instructed self-detection already in AGENTS.md | OpenCode does NOT expose context % to agents. Any custom metric would be a proxy with no ground truth. D-03 forbids HTTP polling. |
| Handoff.md writing | prefect writing Handoff.md on behalf of the agent | Agent writes it per AGENTS.md instruction | The agent has richer context about session state than prefect does. Agent-authored Handoff.md is more accurate. |
| Schema validation | Prefect-side schema validator for Handoff.md | AGENTS.md instruction + agent compliance | No OpenCode API for structured output enforcement exists. Schema validation would require a separate step that adds complexity without reliability guarantees beyond what the instruction provides. |

**Key insight:** Phase 4 is not an implementation phase. The entire CKPT-03 implementation was delivered by Phase 3's AGENTS.md change. Phase 4 closes the tracking record.

---

## Common Pitfalls

### Pitfall 1: Treating CKPT-03 as unimplemented

**What goes wrong:** A planner reads "Phase 4: Handoff Trigger" and assumes there must be code to write. They create tasks to add token counting, hook into runPrompt, or inject context percentage.

**Why it happens:** The phase name sounds like an implementation phase. The REQUIREMENTS.md entry says "Pending" (not yet closed). The `~80%` language in CKPT-03 implies a numeric threshold.

**How to avoid:** Read phase-1-findings.md Finding 4 first. The trigger is instructed self-detection per D-02 — already live in AGENTS.md. Phase 4's job is to close the tracking artifacts, not to write code.

**Warning signs:** Any task in the plan that modifies a `.ts` file. That is a plan error.

### Pitfall 2: Verifying trigger effectiveness via unit test

**What goes wrong:** The plan attempts to write a unit test that asserts "an agent writes Handoff.md at 80% context." No such test is feasible — context pressure is an emergent LLM behavior, not a deterministic code path.

**Why it happens:** Standard GSD practice is to write automated verification for every requirement. CKPT-03 is an exception because the trigger is behavioral/instructional, not programmatic.

**How to avoid:** Verification for CKPT-03 is a text audit: confirm AGENTS.md contains the trigger instruction with the correct wording. Automated: `grep -F "conversation feels crowded" AGENTS.md && grep -F "stop initiating new work" AGENTS.md`.

### Pitfall 3: Confusing CKPT-03 scope with CKPT-01 scope

**What goes wrong:** A planner conflates the checkpoint.md trigger (CKPT-01: after each file-modifying tool call) with the Handoff.md trigger (CKPT-03: at ~80% context). Both are in the same AGENTS.md section.

**Why it happens:** Both behaviors are defined in `## Checkpointing`. They look like one feature.

**How to avoid:** CKPT-01/02 were satisfied by Phase 3. CKPT-03/04 are the handoff half of the same section. Phase 4 only needs to close CKPT-03 (trigger) — CKPT-04 (Handoff.md schema) was already closed in Phase 3.

---

## Code Examples

### Verification: Confirm CKPT-03 trigger is live in AGENTS.md

```bash
# Verify trigger phrase is present (calibrated wording — must not be paraphrased)
grep -F "if you have been working for a long time, if tracking all state feels difficult, or if the conversation feels crowded" AGENTS.md
# Must exit 0

# Verify stop instruction is present
grep -F "stop initiating new work in this session. Do not wait for an error." AGENTS.md
# Must exit 0

# Verify Handoff.md schema fields are present (all four)
grep -qF "accomplished" AGENTS.md && grep -qF "current_state" AGENTS.md && grep -qF "next_steps" AGENTS.md && grep -qF "open_questions" AGENTS.md
# Must exit 0

# Confirm ## Checkpointing is the last ## section (trigger is in the right place)
grep -n "^## " AGENTS.md | tail -1
# Must end with: ## Checkpointing
```

Source: `AGENTS.md` [VERIFIED: read directly in this session]; grep patterns from `03-01-PLAN.md` Task 2 acceptance criteria [CITED: .planning/phases/03-checkpoint-schemas-delivery/03-01-PLAN.md]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| API-based context % trigger | Instructed self-detection in AGENTS.md | Phase 1 Decision D-02, 2026-05-11 | No code needed; fires based on LLM's own judgment |
| Session-level system prompt injection | AGENTS.md auto-load | Phase 1 Finding 2, 2026-05-11 | Simpler; no per-run injection required; persistent across all session prompts |

**Deprecated/outdated:**
- Context % HTTP polling from prefect: Not supported. D-03 forbids it. Finding 4 confirms no such API is exposed to agents.
- Numeric message-count threshold: Not used. Would be arbitrary and unreliable.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 4 requires no AGENTS.md changes — the trigger is already live from Phase 3 | Summary, Architecture Patterns | If Phase 3 AGENTS.md content is somehow missing or corrupted, Phase 4 would need to re-add it. Mitigated by: grep verification confirms the section is present (lines 102–116). |
| A2 | Closing CKPT-03 in REQUIREMENTS.md/ROADMAP.md/STATE.md constitutes Phase 4's full deliverable | Standard Stack, Architecture | If the project owner expects a behavioral test or additional deliverable beyond tracking close-out, the plan needs expansion. The ROADMAP success criteria (SC-1–SC-4) are met by Phase 3 content — but a planner should confirm with the user if there is doubt. |

**Note on A2:** All four ROADMAP success criteria for Phase 4 are met by Phase 3:
- SC-1: "The delivery mechanism causes a prefect agent to write Handoff.md at approximately 80% context utilization" — YES, via AGENTS.md auto-load with calibrated trigger phrasing.
- SC-2: "After writing Handoff.md, the agent stops initiating new work" — YES, per the stop instruction already in AGENTS.md.
- SC-3: "Handoff.md content conforms to the schema defined in Phase 3" — YES, schema is defined in AGENTS.md.
- SC-4: "A developer reading Handoff.md has enough context to resume without re-reading the entire session" — YES, the four required fields (`accomplished`, `current_state`, `next_steps`, `open_questions`) are defined in AGENTS.md and the agent is instructed to write them.

---

## Open Questions

1. **Does the planner want a behavioral smoke test documented (manual, not automated)?**
   - What we know: No automated test for this trigger is feasible — LLM behavior at context saturation is non-deterministic and session-length-dependent.
   - What's unclear: Whether the project owner wants a manual test procedure ("start a session, do a long task, observe that Handoff.md is written before the agent errors out") documented as part of Phase 4.
   - Recommendation: Include a manual test note in the plan's verification section. Do not attempt automated behavioral testing.

2. **Should Phase 4 test the open question from Phase 1 (per-run `system` vs AGENTS.md interaction)?**
   - What we know: Phase 1 left this as an open question — if both AGENTS.md and a per-run `system` are present, their interaction is untested.
   - What's unclear: Whether any current `prefect_run` caller uses `system` alongside AGENTS.md checkpoint instructions.
   - Recommendation: Out of scope for Phase 4 unless CKPT-03 verification depends on it. The safe design (AGENTS.md primary; avoid concurrent per-run `system` for checkpoint purposes) is already the documented recommendation from Phase 1. No action needed for CKPT-03 satisfaction.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 4 is a verification and tracking close-out with no external tool dependencies. The only commands required are `grep` on `AGENTS.md` (built-in) and text edits to planning markdown files.

---

## Validation Architecture

`workflow.nyquist_validation` key is absent from `.planning/config.json` — treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node --test`) |
| Config file | `package.json` scripts.test |
| Quick run command | `npm run build && node --test build/cli.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CKPT-03 | Trigger instruction is present and well-formed in AGENTS.md | manual grep audit | `grep -F "conversation feels crowded" AGENTS.md && grep -F "stop initiating new work" AGENTS.md` | N/A (grep, not a test file) |
| CKPT-03 | Agent stops initiating work after writing Handoff.md | manual-only | n/a — behavioral, non-deterministic | n/a |

**Why manual-only for the behavioral half:** LLM compliance with instruction is not a deterministic code path. The test for CKPT-03 is: "does AGENTS.md contain the correct instruction?" — verifiable with grep. Whether a specific LLM session complies is operational, not something unit tests can assert.

**Regression guard:** `npm test` must still exit 0 after any tracking-artifact edits (no source changes, but confirms nothing broke).

### Wave 0 Gaps

None — no new test files are required. The grep audit is a verification step in the plan task, not a persisted test file.

---

## Security Domain

Phase 4 adds no new endpoints, authentication paths, file access patterns, or network calls. The only changes are to planning markdown files (REQUIREMENTS.md, ROADMAP.md, STATE.md). These files are checked into version control and reviewed via PR.

ASVS categories V2–V6: not applicable. No threat patterns introduced.

---

## Sources

### Primary (HIGH confidence)

- `.planning/research/phase-1-findings.md` — Finding 4 (context % not visible to agent), Trigger Design Summary (instructed self-detection, D-02), Open Question (per-run `system` vs AGENTS.md interaction). Verified against live OpenCode v1.14.48, 2026-05-11. [VERIFIED: read directly in this session]
- `AGENTS.md` lines 102–116 — `## Checkpointing` section containing the trigger instruction, Handoff.md schema, and stop instruction. [VERIFIED: read directly in this session, 2026-05-12]
- `.planning/phases/03-checkpoint-schemas-delivery/03-01-SUMMARY.md` — confirms Phase 3 delivered all 14 acceptance criteria including trigger phrase and stop instruction verbatim. [VERIFIED: read directly in this session]
- `.planning/REQUIREMENTS.md` — CKPT-03 definition and traceability table. [VERIFIED: read directly in this session]
- `.planning/ROADMAP.md` — Phase 4 success criteria (SC-1–SC-4). [VERIFIED: read directly in this session]
- `.planning/phases/01-context-api-research/01-CONTEXT.md` — D-01 through D-08 decisions, including D-02 (instructed self-detection) and D-03 (no HTTP polling). [VERIFIED: read directly in this session]

### Secondary (MEDIUM confidence)

- None required.

### Tertiary (LOW confidence)

- None.

---

## Metadata

**Confidence breakdown:**
- Trigger mechanism already live: HIGH — AGENTS.md read directly, trigger phrase and stop instruction confirmed present at lines 110–116
- No code changes needed: HIGH — Phase 1 D-03 forbids HTTP polling; Phase 1 Finding 4 confirms no context API; Phase 1 D-02 specifies instructed self-detection as the only approach
- Tracking close-out as sole deliverable: HIGH — all four ROADMAP SC-1–SC-4 success criteria are met by Phase 3 content; Phase 4 only needs to update tracking artifacts
- Open question (per-run `system` interaction): MEDIUM — untested per Phase 1, but irrelevant to CKPT-03 satisfaction because no current caller uses both simultaneously

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (stable — AGENTS.md auto-load behavior and instructed self-detection approach are both locked; re-verify only if OpenCode is upgraded past v1.14.x or AGENTS.md is modified)
