# Retrospective

## Milestone: v2.1 — Developer Experience

**Shipped:** 2026-05-13
**Phases:** 4 | **Plans:** 5

### What Was Built

- Research spike settled two open questions (checkpoint delivery mechanism, handoff trigger) with no false paths
- Self-update CLI subcommands + npm lifecycle hooks for zero-step command install on `npm install -g`
- AGENTS.md checkpointing section delivering schemas and instructed self-detection trigger to prefect agents

### What Worked

- Phase 1 research doc (phase-1-findings.md) was genuinely reusable — Phase 3 and Phase 4 needed no re-investigation
- TDD for CLI subcommands (RED/GREEN committed separately) caught the `runCliAsGlobal` helper design early
- Code review after milestone caught real bugs (isGlobal false positive, missing preuninstall hook) that would have shipped to npm

### What Was Inefficient

- REQUIREMENTS.md traceability table was not updated as phases completed — required a cleanup pass at milestone close
- ROADMAP.md progress table showed Phase 2 and 3 as "Not started" even after completion (stale tracking)
- Phase 4 was primarily a tracking-close phase; could have been merged into Phase 3 in retrospect

### Patterns Established

- Code review before milestone archive catches implementation bugs that planning and tests miss
- `npm_config_global === 'true'` is the correct isGlobal check for npm lifecycle hooks; path-segment checks are unreliable
- `rmSync(path, { force: true })` is always preferable to existsSync + rmSync for idempotent file removal

### Key Lessons

- Research phases should write self-contained findings docs immediately — the "reader checklist" pattern (explicit "you do NOT need to read X") was valuable
- Stale tracking artifacts (REQUIREMENTS.md, ROADMAP.md progress table) should be updated atomically with phase execution, not deferred
- Always run code review + npm audit before archiving — not just tests

## Cross-Milestone Trends

| Milestone | Phases | Plans | Days | Tests |
|-----------|--------|-------|------|-------|
| v2.0 | — | — | — | 95+ |
| v2.1 | 4 | 5 | 2 | 105 |
