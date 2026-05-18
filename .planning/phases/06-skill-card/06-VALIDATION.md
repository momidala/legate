---
phase: 6
slug: skill-card
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` |
| **Config file** | none — test command hardcoded in package.json scripts |
| **Quick run command** | `npm run build && node --test build/cli.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build && node --test build/cli.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0 | SKILL-01 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 0 | SKILL-04 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 0 | SKILL-03 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 0 | SKILL-05 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | SKILL-01 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 1 | SKILL-02 | — | N/A | manual | n/a | — | ⬜ pending |
| 06-02-03 | 02 | 1 | SKILL-03 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |
| 06-02-04 | 02 | 1 | SKILL-04 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |
| 06-02-05 | 02 | 1 | SKILL-05 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli.test.ts` — add SKILL-01 through SKILL-05 test cases (extends existing file, does not create new one)
- [ ] Update existing `SELFUP: install-command warns to stderr` test — warning message changes from `Warning: legate-update command not installed —` to `Warning: legate commands not installed —`

*All skill card tests belong in the existing `src/cli.test.ts`. No new test files needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Claude Code reads skill card instead of loading full MCP schemas | SKILL-02 | Behavioral — requires observing Claude Code token usage | Install card with `legate init`, open Claude Code, inspect that `/legate` command is available and context-efficient |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
