# Phase 2: Self-Update - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers a self-update mechanism: npm lifecycle hooks that automatically install and remove a `/prefect-update` Claude slash command when `@momidala/prefect` is installed or uninstalled globally. The slash command lets users update the package from within Claude Code.

**What this phase delivers:**
- `postinstall` hook: copies `/prefect-update` markdown slash command to `~/.claude/commands/`
- `preuninstall` hook: removes the slash command file from `~/.claude/commands/`
- The `/prefect-update` Claude command file itself (markdown)
- Both hooks implemented as new subcommands of the existing `prefect` CLI (`install-command`, `uninstall-command`)

**What this phase does NOT deliver:** Changes to the MCP server, session handling, or checkpointing (Phase 3).

</domain>

<decisions>
## Implementation Decisions

### Lifecycle Script Structure

- **D-01:** `postinstall` and `preuninstall` are implemented as new CLI subcommands (`install-command`, `uninstall-command`) in `src/cli.ts`. Package.json lifecycle scripts call them: `"postinstall": "prefect install-command"`, `"preuninstall": "prefect uninstall-command"`. This is consistent with the existing `cli.ts` switch-case pattern and makes the hooks testable via `cli.test.ts`.

### Update Command Behavior

- **D-02:** `/prefect-update` is a **markdown slash command file** placed at `~/.claude/commands/prefect-update.md`. When a user runs `/prefect-update` in Claude Code, it executes `npm install -g @momidala/prefect@latest`.
- **D-03:** Version display: show **new version only** after update. Format: `prefect updated to vX.Y.Z. Restart Claude Code to apply.` No before/after comparison needed.
- **D-04:** The slash command content is a self-contained markdown file with a bash instruction block. The exact update command is `npm install -g @momidala/prefect@latest`. After the install, it reads the new version from the package and displays it with the restart reminder.

### Global vs Local Install Handling

- **D-05:** Global detection reuses the existing `isGlobal` pattern already in `cli.ts` (`__dirname.replace(/\\/g, '/').includes('/node_modules/')`). If the install is **not** global, `install-command` and `uninstall-command` exit 0 immediately with **no output** (silent skip). Local installs must not pollute `~/.claude/commands/`.

### Error Handling

- **D-06:** If `~/.claude/commands/` does not exist, **create it automatically** (`mkdir -p`) before copying. Users who haven't set up Claude Code yet should still have the command ready when they do.
- **D-07:** If the file copy or directory creation fails (permissions, disk full, etc.), **warn to stderr and exit 0**. A broken command install must never block the npm package install itself. Format: `Warning: prefect-update command not installed — <error message>`.
- **D-08:** `preuninstall` (remove command): if the file doesn't exist or removal fails, exit 0 silently. Uninstall cleanup failures are non-fatal.

### Claude's Discretion

- Exact filename for the slash command (`prefect-update.md` vs `prefect_update.md`) — follow Claude Code convention for slash command filenames.
- Whether to use `fs.cpSync` or `readFileSync`/`writeFileSync` to copy the command file — prefer whatever is cleaner given Node ≥ 20 target.
- Where to store the source command file in the package — inline as a template string in the hook or as a file in `commands/` included via `files` in package.json.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing CLI Pattern
- `src/cli.ts` — existing switch-case subcommand pattern; new subcommands follow this structure
- `src/cli.test.ts` — existing CLI test structure; new subcommands should be tested here

### Requirements
- `.planning/REQUIREMENTS.md` — SELFUP-01 through SELFUP-05 definitions
- `.planning/PROJECT.md` — Constraints section (ESM-only, Node ≥ 20, WSL2)

### Package Configuration
- `package.json` — `scripts`, `bin`, and `files` fields; lifecycle hooks are added to `scripts`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.ts:isGlobal` — existing global install detection logic (`__dirname.includes('/node_modules/')`) — reuse this exact pattern in the new subcommands
- `src/cli.ts` switch-case pattern — all new subcommands slot into the existing switch statement
- `src/cli.test.ts` — existing test harness for CLI subcommands; new hooks can be tested with the same spawn-and-assert pattern

### Established Patterns
- ESM-only: all new files are `.ts` ESM, compiled to `build/` — no `require()` anywhere
- Error output goes to `console.error`, success output to `console.log` (existing pattern in `cli.ts`)
- Node built-in `fs` and `os` modules preferred over third-party packages
- All subcommands call `process.exit(0)` or `process.exit(1)` explicitly — no implicit exits

### Integration Points
- `package.json scripts`: add `"postinstall"` and `"preuninstall"` keys pointing to `prefect install-command` and `prefect uninstall-command`
- `package.json files`: if the slash command markdown is stored as a source file (not an inline template), ensure its compiled/copied form is included in `files`

</code_context>

<specifics>
## Specific Ideas

- The command file destination path: `~/.claude/commands/prefect-update.md` — detect home dir via `os.homedir()` (cross-platform, better than `process.env.HOME`)
- The command file source can be an inline template string in the hook function — keeps the implementation self-contained without needing a separate asset file in `files`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-self-update*
*Context gathered: 2026-05-11*
