---
phase: 5
slug: rename
status: compliant
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-17
audited: 2026-05-17
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
| 05-01-01 | 01 | 1 | RENAME-01 | — | N/A | manual | `npm view legate name` after publish | ✅ package.json | manual-only |
| 05-01-02 | 01 | 1 | RENAME-02 | — | N/A | unit | `npm test` → cli.test.ts usage message assertion | ✅ cli.test.ts | ✅ green |
| 05-01-03 | 01 | 1 | RENAME-03 | — | N/A | unit | `npm test` → index.test.ts asserts 40 legate_* tools, 0 prefect_* | ✅ index.test.ts | ✅ green |
| 05-01-04 | 01 | 1 | RENAME-04 | — | Warnings go to stderr not stdout; no secret values in warning text | unit | `npm test` → auth.test.ts, sessions.test.ts, autostart.test.ts | ✅ all three | ✅ green |
| 05-02-01 | 02 | 2 | DOC-01 | — | N/A | manual | `grep -rn "prefect_\|PREFECT_\|@momidala/prefect" README.md` → migration section only | ✅ README.md | manual-only |
| 05-03-02 | 03 | 3 | DOC-02 | — | N/A | manual | `cat .gitattributes` shows TypeScript linguist override | ✅ .gitattributes | manual-only |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · manual-only*

---

## Wave 0 Requirements

- [x] `src/auth.test.ts` — deprecation warning tests for `PREFECT_SERVER_PASSWORD` (RENAME-04)
- [x] `src/sessions.test.ts` — deprecation warning tests for `PREFECT_SESSION_TTL_MS` (RENAME-04)
- [x] `src/autostart.test.ts` — deprecation warning tests for `PREFECT_AUTOSTART_TIMEOUT_MS` (RENAME-04)
- [x] `.gitattributes` — new file for DOC-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `legate` published to npm (unscoped) | RENAME-01 | npm registry is external | Run `npm view legate name` after `npm publish` |
| `legate` and `legate-mcp` binaries installed | RENAME-02 | Requires global npm install | `npm install -g legate && which legate && which legate-mcp` |
| README/docs have no stale "prefect" tool/env/package refs | DOC-01 | Doc content is not unit-tested | `grep -rn "prefect_\|PREFECT_\|@momidala/prefect\|prefect-mcp" README.md EXAMPLE_CLAUDE.md AGENTS.md examples/` — should return only migration note lines |
| `.gitattributes` correct | DOC-02 | File content check | `cat .gitattributes` shows `*.ts linguist-language=TypeScript` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-17

---

## Validation Audit 2026-05-17

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved | 1 |
| Escalated | 0 |

**Gap resolved:** RENAME-03 — `src/index.test.ts` added; asserts all 40 `server.registerTool()` calls use `legate_` prefix and zero use `prefect_`. Added to `npm test` script. Suite: 120/120 green.

**Decisions captured in REQUIREMENTS.md:**
- RENAME-01: unscoped package name `legate` (not `@momidala/legate`) — deliberate publish identity decision
- Config dir: `~/.config/prefect/` → `~/.config/legate/` with `cpSync` auto-migration — accepted deviation from original out-of-scope ruling
