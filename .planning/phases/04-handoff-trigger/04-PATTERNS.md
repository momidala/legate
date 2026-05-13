# Phase 4: Handoff Trigger — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 3 (modifications to existing planning artifacts)
**Analogs found:** 3 / 3

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.planning/REQUIREMENTS.md` | tracking (requirement register) | N/A — static markdown | `.planning/REQUIREMENTS.md` (same file, Phase 3 tracking rows) | exact |
| `.planning/ROADMAP.md` | tracking (phase progress table) | N/A — static markdown | `.planning/ROADMAP.md` (same file, Phase 1 Progress row) | exact |
| `.planning/STATE.md` | tracking (project state counters) | N/A — static markdown + YAML front matter | `.planning/STATE.md` (same file, post-Phase-1 state) | exact |

---

## Pattern Assignments

### `.planning/REQUIREMENTS.md` (tracking, static markdown — mark CKPT-03 satisfied)

**Change type:** Three edits in the same file.

**Analog:** The same file's existing `[x]` plan entries (e.g., `ROADMAP.md` line 34: `- [x] 01-01-PLAN.md`) establish the checkbox-flip pattern. Within REQUIREMENTS.md itself, all requirement bullets are currently `[ ]` — the pattern to follow is the GFM task-list checkbox convention used project-wide.

---

**Edit 1 — Requirement bullet (line 22): flip `CKPT-03` from unchecked to checked**

Current (REQUIREMENTS.md line 22):
```markdown
- [ ] **CKPT-03**: When a prefect agent's context reaches ~80%, the agent writes `Handoff.md` and stops work (trigger mechanism: researched in CKPT-05)
```

Target:
```markdown
- [x] **CKPT-03**: When a prefect agent's context reaches ~80%, the agent writes `Handoff.md` and stops work (trigger mechanism: researched in CKPT-05)
```

**Note on adjacent requirements:** CKPT-01, CKPT-02, CKPT-04 at lines 20–21 and 23 are also still `[ ]` even though Phase 3 delivered them (Phase 3 SUMMARY confirms `requirements-completed: [CKPT-01, CKPT-02, CKPT-04]`). The planner should decide whether to close these as part of Phase 4 housekeeping or file a separate beads issue. PATTERNS.md records the finding; the plan resolves it.

---

**Edit 2 — Traceability table (line 58): flip CKPT-03 status from Pending to Complete**

Current (REQUIREMENTS.md lines 47–58):
```markdown
| Requirement | Phase | Status |
|-------------|-------|--------|
| CKPT-05 | Phase 1 | Pending |
| SELFUP-01 | Phase 2 | Pending |
| SELFUP-02 | Phase 2 | Pending |
| SELFUP-03 | Phase 2 | Pending |
| SELFUP-04 | Phase 2 | Pending |
| SELFUP-05 | Phase 2 | Pending |
| CKPT-01 | Phase 3 | Pending |
| CKPT-02 | Phase 3 | Pending |
| CKPT-04 | Phase 3 | Pending |
| CKPT-03 | Phase 4 | Pending |
```

Target — CKPT-03 row only:
```markdown
| CKPT-03 | Phase 4 | Complete |
```

---

**Edit 3 — Footer datestamp (line 67): update last-updated date**

Current (REQUIREMENTS.md line 67):
```markdown
*Last updated: 2026-05-11 — roadmap created, all 10 requirements mapped*
```

Target:
```markdown
*Last updated: 2026-05-12 — CKPT-03 marked complete (Phase 4)*
```

---

### `.planning/ROADMAP.md` (tracking, static markdown — mark Phase 4 complete)

**Change type:** Two edits: (1) flip Phase 4 plan list item to `[x]`, (2) update the Progress table row for Phase 4.

**Analog:** Phase 1 Progress row (ROADMAP.md line 86) is the exact pattern to copy for Phase 4:

```markdown
| 1. Context API Research | 1/1 | Complete | 2026-05-11 |
```

And Phase 1 plan list (ROADMAP.md line 34) is the checkbox pattern:

```markdown
- [x] 01-01-PLAN.md — Audit findings doc for D-07/D-08 compliance; wire decisions into PROJECT.md and ROADMAP.md
```

---

**Edit 1 — Phase 4 Plans section: add plan entry and flip it checked**

Current (ROADMAP.md line 76):
```markdown
**Plans**: TBD
```

Target:
```markdown
**Plans:** 1 plan
Plans:
- [x] 04-01-PLAN.md — Verify CKPT-03 trigger is live in AGENTS.md; close CKPT-03 tracking entries in REQUIREMENTS.md, ROADMAP.md, STATE.md
```

---

**Edit 2 — Progress table (line 89): update Phase 4 row**

Current (ROADMAP.md line 89):
```markdown
| 4. Handoff Trigger | 0/TBD | Not started | - |
```

Target:
```markdown
| 4. Handoff Trigger | 1/1 | Complete | 2026-05-12 |
```

**Note:** Phase 3 progress row (ROADMAP.md line 88) also reads `0/1 | Not started | -` even though Phase 3 is done. The planner should fix this alongside Phase 4 or file a beads issue for it.

---

### `.planning/STATE.md` (tracking, YAML front matter + markdown — update progress to 100%)

**Change type:** Multiple edits: YAML front matter counters, prose "Current Position" block, and stale blocker text.

**Analog:** The same file's post-Phase-1 snapshot establishes the convention. The YAML front matter block at lines 1–15 is the authoritative progress source. The prose `## Current Position` section at lines 27–33 mirrors it in human-readable form.

---

**Edit 1 — YAML front matter: update progress counters**

Current (STATE.md lines 1–15):
```yaml
---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: milestone
status: ready_to_plan
stopped_at: Phase 2 context gathered
last_updated: "2026-05-12T20:32:43.701Z"
last_activity: 2026-05-12 -- Phase 03 execution started
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 4
  completed_plans: 3
  percent: 75
---
```

Target:
```yaml
---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: milestone
status: complete
stopped_at: Phase 4 complete
last_updated: "2026-05-12T00:00:00.000Z"
last_activity: 2026-05-12 -- Phase 04 complete
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 5
  completed_plans: 5
  percent: 100
---
```

**Notes on counter values:**
- `total_plans` rises from 4 to 5 because Phase 4 produces one plan (04-01-PLAN.md)
- `completed_plans` rises from 4 to 5 for the same reason
- `status` changes from `ready_to_plan` to `complete` — this is the terminal milestone state; use whatever status value the GSD tooling expects for a finished milestone (check `.planning/config.json` or prior art if uncertain)

---

**Edit 2 — Current Position block: update phase and progress bar**

Current (STATE.md lines 27–33):
```markdown
## Current Position

Phase: 4
Plan: Not started
Status: Ready to plan
Last activity: 2026-05-12

Progress: [░░░░░░░░░░] 0%
```

Target:
```markdown
## Current Position

Phase: 4
Plan: 04-01-PLAN.md (complete)
Status: Complete
Last activity: 2026-05-12

Progress: [██████████] 100%
```

---

**Edit 3 — Stale blocker text (lines 67–69): remove or update the stale blocker**

Current (STATE.md lines 67–69):
```markdown
### Blockers/Concerns

- OpenCode context utilization API is unknown — Phase 1 research spike must complete before Phase 4 can be planned
```

Target (blocker resolved):
```markdown
### Blockers/Concerns

None — all phases complete.
```

---

## Shared Patterns

### GFM Checkbox flip pattern
**Source:** `.planning/ROADMAP.md` lines 34, 48–49, 64 (plan `[x]` entries)
**Apply to:** REQUIREMENTS.md requirement bullet (line 22); ROADMAP.md plan entry (new line under Phase 4)
**Pattern:** Change `- [ ]` to `- [x]`. Do not alter any other content on the line. The full requirement description text is preserved exactly — only the bracket content changes.

```markdown
- [x] existing text preserved verbatim
```

### Progress table completion row pattern
**Source:** `.planning/ROADMAP.md` line 86
**Apply to:** ROADMAP.md Phase 4 progress row (line 89)
**Pattern:**
```markdown
| N. Phase Name | plans_done/plans_total | Complete | YYYY-MM-DD |
```
The date cell uses ISO 8601 date (no time component). "Complete" is title-case with no trailing punctuation.

### Traceability table status pattern
**Source:** `.planning/REQUIREMENTS.md` lines 47–58
**Apply to:** REQUIREMENTS.md CKPT-03 traceability row (line 58)
**Pattern:**
```markdown
| CKPT-XX | Phase N | Complete |
```
"Complete" matches the vocabulary used in ROADMAP.md Progress table (consistent across both files).

---

## No Analog Found

None — all three modified files are their own analogs. The markup conventions are established within each file by the Phase 1/2/3 rows that are already marked complete.

---

## Planner Warnings

Two stale-tracking discrepancies were found during analog extraction that Phase 4's plan should address:

| Discrepancy | Location | Observation |
|-------------|----------|-------------|
| CKPT-01, CKPT-02, CKPT-04 still `[ ]` | REQUIREMENTS.md lines 20–21, 23 | Phase 3 SUMMARY records `requirements-completed: [CKPT-01, CKPT-02, CKPT-04]` but REQUIREMENTS.md was never updated |
| Phase 3 Progress row reads `0/1 \| Not started \| -` | ROADMAP.md line 88 | Phase 3 is complete (SUMMARY, REVIEW, VERIFICATION all present); progress table was not updated |

These are not Phase 4 scope per RESEARCH.md, but the planner should include them as housekeeping tasks in the plan (or file beads issues) rather than leaving them as silent inconsistencies.

---

## Metadata

**Analog search scope:** `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/phases/03-checkpoint-schemas-delivery/` (for completion pattern reference), `.planning/phases/01-context-api-research/` (for tracking close-out pattern reference)
**Files scanned:** 7
**Pattern extraction date:** 2026-05-12

**Key constraint from RESEARCH.md:** Phase 4 is a verification and tracking close-out. No `.ts` source files are touched. No AGENTS.md changes. Any plan task that modifies a file in `src/` is a plan error per RESEARCH.md Pitfall 1.
