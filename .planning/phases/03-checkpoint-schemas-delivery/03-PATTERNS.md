# Phase 3: Checkpoint Schemas + Delivery — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 1 (modification to existing file)
**Analogs found:** 1 / 1

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `AGENTS.md` | config (agent instruction document) | N/A — static content | `AGENTS.md § Session Completion` (same file, adjacent section) | exact |

---

## Pattern Assignments

### `AGENTS.md` (config, static content — append new section)

**Change type:** Append new `## Checkpointing` section after the last existing `##` section (`## Session Completion`, line 78 of current file).

**Analog:** The `## Session Completion` section in the same file (`AGENTS.md` lines 78–100). This section follows the same authoring pattern: a `##`-level heading, a bold intro sentence, a structured workflow as a numbered or bulleted list, and a `**CRITICAL RULES:**` / keyword-keyed block at the end. The new section uses the same heading level and the same imperative-instruction bullet style.

---

**Insertion point pattern** (`AGENTS.md` lines 78–100 — the final section, immediately before which the new section is NOT inserted; the new section is appended AFTER this block ends at EOF):

```markdown
## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
```

**Authoring pattern extracted from this analog:**
- Heading: `## <Section Name>` (no sub-heading nesting for top-level behavioral rules)
- Opening line: Bold imperative sentence setting the rule scope
- Body: Flat bulleted or numbered list with `**field_name:**` prefixes for structured fields
- Closing block (when needed): `**CRITICAL RULES:**` or equivalent bold-prefixed constraint list

---

**Verbatim content to append** (from `.planning/research/phase-1-findings.md` § Canonical AGENTS.md Checkpoint Instruction Template — VERIFIED against OpenCode v1.14.48):

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

**Critical constraint:** Do NOT modify this wording. The phrasing "if you have been working for a long time, if tracking all state feels difficult, or if the conversation feels crowded" is calibrated for LLM trigger sensitivity. Paraphrasing or adding token thresholds will break the trigger (documented in RESEARCH.md Anti-Patterns).

---

## Shared Patterns

### Section ordering in AGENTS.md
**Source:** `AGENTS.md` lines 1–100 (full file)
**Apply to:** The `AGENTS.md` edit only
**Pattern:** All `##` sections appear in declaration order with no sub-nesting at `##` level. The new `## Checkpointing` section must be appended at EOF, after `## Session Completion`, to preserve the existing section order. Inserting mid-file would risk disrupting the session-completion and shell-command behavioral rules.

### Bullet field schema pattern
**Source:** `AGENTS.md` lines 59–74 (`## Non-Interactive Shell Commands`) and lines 78–100 (`## Session Completion`)
**Apply to:** Both `checkpoint.md` field list and `Handoff.md` field list
**Pattern:**
```markdown
- **field_name:** description of expected content
```
Both `checkpoint.md` and `Handoff.md` field lists follow this exact pattern. The inline code spans for tool names (`` `edit` ``, `` `write` ``, `` `apply_patch` ``) follow the pattern used in the `## Non-Interactive Shell Commands` section where shell commands are always wrapped in backticks.

---

## No Analog Found

None — the single modified file has a direct, same-file analog for its authoring pattern and an exact verbatim source for its content.

---

## Metadata

**Analog search scope:** `AGENTS.md` (project root), `.planning/research/phase-1-findings.md`
**Files scanned:** 2 (AGENTS.md, phase-1-findings.md) + CLAUDE.md for project context
**Pattern extraction date:** 2026-05-12

**Key constraint from RESEARCH.md:** This is a pure documentation change. No TypeScript source files in `src/` are touched. No new files are created. No build step is required to validate the change — verification is `grep -c "current_task" AGENTS.md` returning `1`.
