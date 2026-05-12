---
phase: 4
slug: handoff-trigger
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bash/grep (no unit test framework — behavioral trigger is non-deterministic) |
| **Config file** | none |
| **Quick run command** | `grep -F "conversation feels crowded" AGENTS.md && grep -F "stop initiating new work" AGENTS.md` |
| **Full suite command** | `grep -F "conversation feels crowded" AGENTS.md && grep -F "stop initiating new work" AGENTS.md` |
| **Estimated runtime** | ~1 second |

---

## Sampling Rate

- **After every task commit:** Run `grep -F "conversation feels crowded" AGENTS.md && grep -F "stop initiating new work" AGENTS.md`
- **After every plan wave:** Run same grep audit
- **Before `/gsd-verify-work`:** Grep audit must exit 0
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | CKPT-03 | — | AGENTS.md contains trigger phrase and stop instruction | grep | `grep -F "conversation feels crowded" AGENTS.md && grep -F "stop initiating new work" AGENTS.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* No new test framework needed — Phase 4 verification is a grep audit of AGENTS.md content delivered by Phase 3.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent writes Handoff.md at ~80% context | CKPT-03 | LLM behavioral trigger is non-deterministic; no API exposes context % | Run a long prefect session; observe if agent writes Handoff.md and stops initiating work near context limit |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
