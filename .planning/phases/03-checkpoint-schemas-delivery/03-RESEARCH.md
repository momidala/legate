# Phase 3: Checkpoint Schemas + Delivery — Research

**Researched:** 2026-05-12
**Domain:** AGENTS.md content authoring — checkpoint instruction delivery via auto-loaded project context file
**Confidence:** HIGH (delivery mechanism fully resolved by Phase 1; no new technical unknowns)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CKPT-01 | Prefect agents receive checkpoint instructions and write `checkpoint.md` after each file-modifying tool call | Delivery via AGENTS.md auto-load confirmed in Phase 1 Finding 1. Canonical instruction template exists in `.planning/research/phase-1-findings.md`. |
| CKPT-02 | `checkpoint.md` follows a defined schema (current task, last change, remaining steps, status) | Schema is already drafted in Phase 1 canonical template. Phase 3 formalizes it in AGENTS.md and makes it discoverable without reading source. |
| CKPT-04 | `Handoff.md` follows a defined schema (accomplished, current state, next steps, open questions) | Schema is already drafted in Phase 1 canonical template. Phase 3 formalizes it in AGENTS.md and makes it discoverable without reading source. |

</phase_requirements>

---

## Summary

Phase 3 is a documentation authoring phase. All technical questions were resolved in Phase 1. The only deliverable is adding a `## Checkpointing` section to the project's `AGENTS.md` using the canonical template already written in `.planning/research/phase-1-findings.md`.

The delivery mechanism is AGENTS.md auto-load (Phase 1 Finding 1 — VERIFIED by live API probe against OpenCode v1.14.48). When `prefect_run` is called with an explicit `directory` parameter, OpenCode automatically includes `AGENTS.md` from that directory in every agent's system context. No prefect source code changes are required.

The checkpoint.md and Handoff.md schemas are already specified verbatim in the Phase 1 canonical template. Phase 3 makes them discoverable by embedding them directly in `AGENTS.md` — the file that users and agents actually read — rather than in planning artifacts.

**Primary recommendation:** Add the `## Checkpointing` section from `.planning/research/phase-1-findings.md` (Canonical AGENTS.md Checkpoint Instruction Template) verbatim into `AGENTS.md`. This is the entire implementation.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Checkpoint instruction delivery | AGENTS.md (file content) | Per-run `system` field (backup) | OpenCode auto-loads AGENTS.md into agent system context; no code required |
| checkpoint.md schema definition | AGENTS.md | — | Schema lives where agents can read it directly |
| Handoff.md schema definition | AGENTS.md | — | Schema lives where agents can read it directly |
| Instruction discoverability | AGENTS.md | — | Users who inspect the file see schemas immediately; no source code traversal needed |

---

## Standard Stack

No libraries are added in this phase. This is a pure documentation/content change.

### The Only File That Changes

| File | Role | Change |
|------|------|--------|
| `AGENTS.md` | Project agent instructions (auto-loaded by OpenCode and Claude Code) | Add `## Checkpointing` section with verbatim template from Phase 1 findings |

---

## Architecture Patterns

### System Architecture Diagram

```
prefect_run(directory="<project>")
        |
        v
OpenCode agent session created
        |
        v
OpenCode loads AGENTS.md from <project>/        [Finding 1 — VERIFIED]
AGENTS.md includes:
  - Core Workflow
  - Key Commands
  - Non-Interactive Shell Commands
  - Session Completion
  + ## Checkpointing  <-- Phase 3 adds this
        |
        v
Agent starts work
        |
        v
Agent calls edit / write / apply_patch
        |
        v
Agent writes checkpoint.md in working directory
  (fields: current_task, last_change, remaining_steps, status)
        |
        v
[... more file-modifying calls ...]
        |
        v
Agent senses context pressure
        |
        v
Agent writes Handoff.md in working directory
  (fields: accomplished, current_state, next_steps, open_questions)
        |
        v
Agent stops initiating new work
```

### Recommended AGENTS.md Structure After Phase 3

```
AGENTS.md
├── # Agent Instructions           (existing — description of project)
├── ## Core Workflow               (existing)
├── ## Key Commands & Patterns     (existing)
├── ## Important Notes             (existing)
├── ## Non-Interactive Shell Commands  (existing)
├── ## Session Completion          (existing)
└── ## Checkpointing               (NEW — Phase 3 adds this section)
    ├── After-each-tool-call rule  (checkpoint.md fields)
    └── Context-pressure rule      (Handoff.md fields + stop instruction)
```

The new section is appended at the end (after `## Session Completion`) to avoid disrupting the existing section order.

### Pattern: Verbatim Paste of Canonical Template

**What:** Copy the fenced code block from `.planning/research/phase-1-findings.md § Canonical AGENTS.md Checkpoint Instruction Template` into `AGENTS.md` as a new `## Checkpointing` section.

**When to use:** Always — do not paraphrase or rewrite the instruction template. Phase 1 researchers verified that the specific wording is calibrated for LLM compliance. Changing the wording without re-testing the trigger sensitivity is a known risk.

**The verbatim template to paste:**
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

Source: `.planning/research/phase-1-findings.md` [VERIFIED: live probe against OpenCode v1.14.48]

### Anti-Patterns to Avoid

- **Rewriting the trigger instruction wording:** The phrase "if you have been working for a long time, if tracking all state feels difficult, or if the conversation feels crowded" is calibrated phrasing. Do not simplify to "when context is full" or add token thresholds — this will break the trigger.
- **Storing schemas only in planning docs:** The schemas must be in `AGENTS.md` so they are discoverable without reading source code. ROADMAP success criteria SC-3 and SC-4 explicitly require this.
- **Adding a `preuninstall` lifecycle hook for cleanup:** Phase 2 already resolved that `preuninstall` is unreliable in npm v7+ for global uninstalls. `AGENTS.md` is a checked-in source file — it does not need lifecycle hook management.
- **Creating a separate `schemas/` directory:** The schema definitions are short enough to live inline in `AGENTS.md`. No separate files needed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Instruction delivery to OpenCode agents | Custom injection middleware, per-run system-prompt patching in prefect source | AGENTS.md auto-load | Already confirmed working (Finding 1). Zero code changes to prefect required. |
| Schema versioning / format enforcement | JSON schema validator, structured output enforcement | Plain markdown field list in AGENTS.md | LLMs follow markdown instruction lists reliably; structured output enforcement would require prefect code changes and OpenCode API support that does not exist |
| Context % trigger | Token counter, API polling, message count heuristic | Instructed self-detection in AGENTS.md | OpenCode does NOT expose context % to agents (Finding 4). Instructed self-detection is the only available signal. |

**Key insight:** The entire deliverable is a markdown section in one existing file. Anything more complex would add maintenance burden with no benefit over the verified simple approach.

---

## Common Pitfalls

### Pitfall 1: Forgetting the `directory` precondition

**What goes wrong:** A user calls `prefect_run` without an explicit `directory` parameter. OpenCode defaults to the server's working directory, which may not contain the project's `AGENTS.md`. Checkpoint instructions are silently absent from that agent's context.

**Why it happens:** The `directory` parameter is optional in the tool schema, so callers may omit it.

**How to avoid:** The existing `AGENTS.md` and `CLAUDE.md` both already enforce "Always pass `directory` explicitly to all tools — never rely on defaults." No additional enforcement needed in Phase 3.

**Warning signs:** Agent produces no `checkpoint.md` despite being instructed to. Check whether the session was created with a `directory` parameter.

### Pitfall 2: AGENTS.md section placement collision

**What goes wrong:** The new `## Checkpointing` section is inserted inside an existing section (e.g., between `## Key Commands` items) rather than appended at the end of the file.

**Why it happens:** Inattentive text insertion.

**How to avoid:** Append the entire `## Checkpointing` block after the last existing `##` section in `AGENTS.md`. The current last section is `## Session Completion` (confirmed by reading `AGENTS.md`).

**Warning signs:** Existing AGENTS.md tests fail (if any), or agent behavior around session completion or shell commands changes.

### Pitfall 3: Omitting the `Handoff.md` stop instruction

**What goes wrong:** The `Handoff.md` field list is included but the final line — "After writing `Handoff.md`, stop initiating new work in this session. Do not wait for an error." — is accidentally dropped.

**Why it happens:** The last sentence is outside the bullet list and may be treated as a trailing comment during copy-paste.

**How to avoid:** Paste the entire fenced block verbatim. Verify the stop instruction is present after the bullet list.

**Warning signs:** Agents write `Handoff.md` but then continue executing tool calls.

### Pitfall 4: Schema discoverability gap

**What goes wrong:** CKPT-02 and CKPT-04 require schemas to be "defined and discoverable without reading source code." If the schemas only appear in `.planning/research/` or in code comments, Phase 3 success criteria SC-3 and SC-4 are not met.

**Why it happens:** Over-reliance on planning artifacts that users don't normally read.

**How to avoid:** Schemas appear in `AGENTS.md` — the file that is actively auto-loaded and that users inspect directly when setting up prefect.

---

## Code Examples

### checkpoint.md — valid example output

```markdown
<!-- checkpoint.md -->
**current_task:** Refactor error handling in src/handlers.ts
**last_change:** src/handlers.ts — extracted inline error logic into handleApiError() helper
**remaining_steps:** Update tests in src/handlers.test.ts; update src/index.ts call sites
**status:** in_progress
```

Source: schema derived from Phase 1 canonical template [VERIFIED: `.planning/research/phase-1-findings.md`]

### Handoff.md — valid example output

```markdown
<!-- Handoff.md -->
**accomplished:** Refactored error handling in src/handlers.ts; all extractable functions moved to helpers
**current_state:** src/handlers.ts is clean. Tests in handlers.test.ts still reference old inline code at lines 45-60.
**next_steps:**
1. Update handlers.test.ts to use new helper names
2. Run npm test to verify no regressions
3. Commit with message "refactor(handlers): extract error helpers"
**open_questions:** Should handleApiError be exported? Currently internal only.
```

Source: schema derived from Phase 1 canonical template [VERIFIED: `.planning/research/phase-1-findings.md`]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Checkpoint instructions via session-level system prompt | AGENTS.md auto-load (session-level prompt NOT supported — silently ignored) | Phase 1 research, 2026-05-11 | Primary delivery vehicle is AGENTS.md; per-run `system` field is backup |
| Context % threshold trigger for Handoff.md | Instructed self-detection (agent's own judgment) | Phase 1 research, 2026-05-11 | No token counting; agent uses natural language trigger cues |

---

## Assumptions Log

> All critical claims are verified from Phase 1 live probes. This section documents the one structural assumption.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `## Checkpointing` section should be appended after `## Session Completion` (last section in current AGENTS.md) | Architecture Patterns — Recommended Structure | Minimal — placement at end of file is always safe; wrong only if a future section added after this research needs to appear last |

**All other claims** (AGENTS.md auto-load, per-run `system` field, session-level prompt silently ignored, context % not visible to agent) were verified by live API probe in Phase 1 against OpenCode v1.14.48. See `.planning/research/phase-1-findings.md`.

---

## Open Questions

1. **Does AGENTS.md need a header comment explaining the checkpointing section's origin?**
   - What we know: The canonical template in phase-1-findings.md has no such comment.
   - What's unclear: Whether readers would benefit from a note like `<!-- Delivery mechanism: auto-loaded by OpenCode per phase-1-findings.md Finding 1 -->`.
   - Recommendation: Omit comment in AGENTS.md. The wording is self-explanatory. Planning artifacts are the right place for provenance notes.

2. **Should checkpoint.md be gitignored?**
   - What we know: `checkpoint.md` is a transient working file written by the agent during a session; it changes on every file-modifying tool call.
   - What's unclear: Whether users want checkpoint.md committed or ignored.
   - Recommendation: Out of scope for Phase 3 (REQUIREMENTS.md "Optional: checkpoint.md committed automatically with a standard message" is in Future Requirements). Phase 3 does not add a `.gitignore` entry. Note for Phase 4 or future scope.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 3 is a pure documentation/content change to `AGENTS.md`. No external tools, services, runtimes, or package installs required.

---

## Validation Architecture

`workflow.nyquist_validation` is absent from `.planning/config.json` — treated as enabled.

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
| CKPT-01 | Agents receive checkpoint instructions (AGENTS.md section present) | manual-only | n/a | n/a |
| CKPT-02 | `checkpoint.md` schema is defined and fields are present in AGENTS.md | manual-only | n/a | n/a |
| CKPT-04 | `Handoff.md` schema is defined and fields are present in AGENTS.md | manual-only | n/a | n/a |

**Why manual-only:** These requirements are satisfied by the content of `AGENTS.md`. The automated test suite verifies CLI behavior and API contracts — it does not test whether a markdown file contains a specific section. Verification is a text diff: before/after `AGENTS.md`, confirm `## Checkpointing` section is present with correct fields.

**Automated regression guard (recommended):** A single `grep -c "current_task" AGENTS.md` in the verification script confirms the section was not accidentally deleted. This is a 30-second manual check, not a test file gap.

### Wave 0 Gaps

None — existing test infrastructure does not need new test files for this phase. No code changes to `src/` are introduced.

---

## Security Domain

This phase adds no new endpoints, authentication paths, file access patterns, or network calls. The change is a markdown text addition to an existing file that is already committed to version control and already read by agents.

ASVS categories V2 (Authentication), V3 (Session Management), V4 (Access Control), V6 (Cryptography): not applicable.

V5 (Input Validation): not applicable — no user input is processed by this change.

No threat patterns introduced.

---

## Sources

### Primary (HIGH confidence)

- `.planning/research/phase-1-findings.md` — canonical template, all four findings, delivery mechanism summary, trigger design summary. Verified against live OpenCode v1.14.48 probe on 2026-05-11.
- `AGENTS.md` (project root) — current file content; insertion point confirmed (after `## Session Completion`)
- `.planning/REQUIREMENTS.md` — CKPT-01, CKPT-02, CKPT-04 definitions; Out of Scope table
- `.planning/ROADMAP.md` — Phase 3 success criteria

### Secondary (MEDIUM confidence)

- None required — Phase 1 findings are authoritative and self-contained.

### Tertiary (LOW confidence)

- None.

---

## Metadata

**Confidence breakdown:**
- Delivery mechanism: HIGH — live probe verified in Phase 1
- Schema content: HIGH — verbatim template from Phase 1 findings
- AGENTS.md insertion point: HIGH — file read directly in this session
- "No code changes needed" claim: HIGH — confirmed by Phase 1 Finding 1 ("No code changes to prefect are needed")

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (stable — OpenCode AGENTS.md loading behavior is unlikely to change; re-verify if OpenCode is upgraded past v1.14.x)
