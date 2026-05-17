---
phase: 5
slug: rename
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) |
| **Config file** | None — tests listed explicitly in npm test script |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` (same — no separate full suite) |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green + manual doc review
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | RENAME-01 | — | N/A | manual | `npm view . name` after publish | ✅ package.json | ⬜ pending |
| 05-01-02 | 01 | 1 | RENAME-02 | — | N/A | unit | `npm test` → cli.test.ts usage message assertion | ✅ cli.test.ts | ⬜ pending |
| 05-01-03 | 01 | 1 | RENAME-03 | — | N/A | unit | `npm test` (TypeScript compilation catches name errors) | ✅ index.ts | ⬜ pending |
| 05-01-04 | 01 | 1 | RENAME-04 | — | Warnings go to stderr not stdout; no secret values in warning text | unit | `npm test` → auth.test.ts, sessions.test.ts, autostart.test.ts | ✅ (needs new tests) | ⬜ pending |
| 05-02-01 | 02 | 2 | DOC-01 | — | N/A | manual | `grep -c "prefect" README.md` → only migration note refs | ✅ README.md | ⬜ pending |
| 05-02-02 | 02 | 2 | DOC-02 | — | N/A | manual | `cat .gitattributes` shows TypeScript linguist override | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/auth.test.ts` — add deprecation warning tests for `PREFECT_SERVER_PASSWORD` (RENAME-04)
- [ ] `src/sessions.test.ts` — add deprecation warning tests for `PREFECT_SESSION_TTL_MS` (RENAME-04)
- [ ] `src/autostart.test.ts` — add deprecation warning tests for `PREFECT_AUTOSTART_TIMEOUT_MS` (RENAME-04)
- [ ] `.gitattributes` — new file for DOC-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `@momidala/legate` published to npm | RENAME-01 | npm registry is external | Run `npm view @momidala/legate name` after `npm publish` |
| `legate` and `legate-mcp` binaries installed | RENAME-02 | Requires global npm install | `npm install -g @momidala/legate && which legate && which legate-mcp` |
| README/docs have no stale "prefect" tool/env/package refs | DOC-01 | Doc content is not unit-tested | `grep -rn "prefect_\|PREFECT_\|@momidala/prefect\|prefect-mcp" README.md EXAMPLE_CLAUDE.md AGENTS.md examples/` — should return only migration note lines |
| `.gitattributes` correct | DOC-02 | File content check | `cat .gitattributes` shows `*.ts linguist-language=TypeScript` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
