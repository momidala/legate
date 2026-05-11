# Phase 2: Self-Update - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 02-self-update
**Areas discussed:** Lifecycle script structure, Update command behavior, Global vs local install handling, Error handling

---

## Lifecycle script structure

| Option | Description | Selected |
|--------|-------------|----------|
| New CLI subcommands | Add `install-command`/`uninstall-command` to cli.ts, wire from package.json. Consistent with existing pattern, testable. | ✓ |
| Dedicated lifecycle scripts | New src/install-hook.ts and src/uninstall-hook.ts. Cleaner separation but more surface area. | |
| Inline shell in package.json | Shell one-liners. Simple but not testable. | |

**User's choice:** New CLI subcommands (consistent with cli.ts)
**Notes:** Pattern already established in the codebase; new subcommands slot into the existing switch-case.

---

## Update command behavior

| Option | Description | Selected |
|--------|-------------|----------|
| `npm install -g @momidala/prefect@latest` | Always installs absolute latest. Predictable. | ✓ |
| `npm update -g @momidala/prefect` | Respects semver range constraints. May not reach latest. | |

**User's choice:** `npm install -g @momidala/prefect@latest`

| Option | Description | Selected |
|--------|-------------|----------|
| Show new version only | After update: "prefect updated to vX.Y.Z. Restart Claude Code." Simple. | ✓ |
| Show before and after | "Updated prefect v2.0.4 → v2.1.0." More informative but requires capturing old version first. | |

**User's choice:** Show new version only

| Option | Description | Selected |
|--------|-------------|----------|
| Claude slash command (markdown) | .md file in ~/.claude/commands/. Standard Claude Code slash command pattern. | ✓ |
| Bash script | .sh file. Doesn't fit ~/.claude/commands/ pattern. | |

**User's choice:** Claude slash command (markdown)

---

## Global vs local install handling

| Option | Description | Selected |
|--------|-------------|----------|
| Detect and skip silently | Use existing isGlobal pattern from cli.ts. Exit 0 with no output on local install. | ✓ |
| Skip with a note | Print brief message then exit 0. | |
| No special handling | Always attempt copy. Local installs also get the command. | |

**User's choice:** Detect and skip silently
**Notes:** Reuses the `isGlobal` logic already present in `cli.ts`.

---

## Error handling

| Option | Description | Selected |
|--------|-------------|----------|
| Create ~/.claude/commands/ automatically | mkdir -p then copy. Works for users who haven't set up Claude Code yet. | ✓ |
| Skip with a warning | Print warning, exit 0. No auto-creation. | |
| Fail loudly (exit 1) | Blocks npm install. Too disruptive. | |

**User's choice:** Create automatically (mkdir -p)

| Option | Description | Selected |
|--------|-------------|----------|
| Warn but succeed (exit 0) | Print warning to stderr, exit 0. Package install never blocked. | ✓ |
| Fail (exit 1) | Propagate error. May confuse users. | |

**User's choice:** Warn but succeed (exit 0)

---

## Claude's Discretion

- Exact filename for slash command (`prefect-update.md` vs `prefect_update.md`)
- Whether to use `fs.cpSync` or `readFileSync`/`writeFileSync` for the copy
- Whether the source command file is inline or a separate asset file

## Deferred Ideas

None — discussion stayed within phase scope.
