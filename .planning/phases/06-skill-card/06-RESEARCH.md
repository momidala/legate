# Phase 6: Skill Card - Research

**Researched:** 2026-05-17
**Domain:** CLI file installation, Claude Code slash commands, skill card content generation
**Confidence:** HIGH

## Summary

Phase 6 adds a skill card installation system to the `legate init` command. Currently `legate init` only writes `.mcp.json`. After this phase, `legate init` also writes two Claude Code slash command files to `~/.claude/commands/`: `legate.md` (the main skill card) and `legate-update.md` (already exists in Phase 2/5, but Phase 6 transitions its installation from `install-command` to `legate init`).

The primary new artifact is `legate.md` — a condensed markdown reference that Claude Code loads as `/legate`. It contains the canonical loop, one-line descriptions per tool group, and an auto-generated workers section read from `~/.config/legate/servers.json` at install time. The card is intentionally compact: it replaces verbose MCP schema loading with a single short file Claude reads once.

`legate uninstall-command` must be extended to remove both `legate.md` and `legate-update.md`. The `postinstall`/`preuninstall` npm lifecycle hooks already call `install-command`/`uninstall-command`, so extending those handlers covers the npm global install path automatically.

The codebase has **40 registered MCP tools** (`legate_*`) in `src/index.ts` [VERIFIED: `grep -c "server.registerTool" src/index.ts` returns 40]. The skill card must group them into compact, scannable sections.

**Primary recommendation:** Extend the existing `handleInstallCommand` function to write both files in one pass. The `legate.md` content is a TypeScript template string constant in `cli.ts`, with the workers section dynamically generated from `readRegistry()` at call time — same pattern already used by `updateClaudemdWorkers()`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SKILL-01 | `legate init` installs `~/.claude/commands/legate.md` — condensed reference card covering all tools, parameters, and the canonical loop in minimal tokens | Extend `handleInstallCommand` to write a second file; call it from the `init` case |
| SKILL-02 | Skill file replaces verbose tool descriptions — Claude reads the skill card instead of loading full MCP schemas | Content design decision: card must be complete enough that Claude does not need to inspect MCP schema descriptions at runtime |
| SKILL-03 | Skill file includes canonical loop, available workers (auto-generated from servers.json), and one-line descriptions per tool group | `readRegistry()` already available in `cli.ts`; same pattern as `updateClaudemdWorkers()` |
| SKILL-04 | `legate init` also installs `~/.claude/commands/legate-update.md` | Already done by `install-command`; `legate init` must also call this install path |
| SKILL-05 | Files are versioned — `legate init` overwrites on reinstall; `legate uninstall-command` removes both files | `writeFileSync` overwrites by default; `uninstall-command` must `rmSync` both paths |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Skill card content generation | CLI Process (build time) | — | Content is a TypeScript string template with workers injected from registry at install time, not at MCP serve time |
| File installation to `~/.claude/commands/` | CLI Process | npm lifecycle hooks | `handleInstallCommand` runs both directly (`legate install-command`) and via `postinstall` hook (`npm install -g legate`) |
| Workers section generation | Registry reader (`readRegistry`) | — | Same function used by `updateClaudemdWorkers`; reads `~/.config/legate/servers.json` |
| File removal | CLI Process | npm lifecycle hooks | `handleUninstallCommand` extended to `rmSync` both files; called by `preuninstall` |
| Slash command dispatch | Claude Code (external) | — | Claude Code reads `~/.claude/commands/*.md` at startup; no legate code involved |

## Standard Stack

### Core (no new dependencies needed)

This phase is purely additive CLI behavior. No new npm packages required. All changes are in `src/cli.ts`.

| Module | Role | Already Present |
|--------|------|-----------------|
| `node:fs` — `writeFileSync`, `rmSync`, `mkdirSync`, `existsSync` | File I/O for installing/removing skill files | Yes — already imported in cli.ts |
| `node:path` — `join` | Path construction for `~/.claude/commands/` | Yes |
| `node:os` — `homedir()` | Resolve `~` | Yes |
| `registry.ts` — `readRegistry()` | Read servers.json to generate workers section | Yes — already imported in cli.ts |

**Version verification:** `legate` package.json shows `"version": "2.1.0"` [VERIFIED: local codebase]. No new dependencies to verify.

## Architecture Patterns

### System Architecture Diagram

```
legate init                     legate install-command
    │                                   │
    ▼                                   ▼
installSkillCards() ←───────────────────┘
    │
    ├─ readRegistry() → servers.json
    │       │
    │       └─ build workers bullet list
    │
    ├─ mkdirSync(~/.claude/commands/, recursive)
    ├─ writeFileSync(legate.md, SKILL_CARD_STATIC + workersSection)
    └─ writeFileSync(legate-update.md, LEGATE_UPDATE_COMMAND_CONTENT)

legate uninstall-command
    │
    ▼
handleUninstallCommand()
    ├─ rmSync(legate.md, { force: true })
    └─ rmSync(legate-update.md, { force: true })

npm install -g legate
    └─ postinstall → node build/cli.js install-command
                        └─ handleInstallCommand → installSkillCards()

npm uninstall -g legate
    └─ preuninstall → node build/cli.js uninstall-command
                          └─ handleUninstallCommand (both files)
```

### Recommended Project Structure

No new files or directories. All changes land in:

```
src/
├── cli.ts          # Add LEGATE_SKILL_CARD_STATIC constant + installSkillCards() helper;
│                   # extend handleInstallCommand, handleUninstallCommand, init case
└── cli.test.ts     # Add SKILL-01..SKILL-05 tests
```

### Pattern 1: Inline Template Constant (same as LEGATE_UPDATE_COMMAND_CONTENT)

The skill card content is a TypeScript template literal constant at module scope. The workers section is the only dynamic part — injected at install time by reading the registry, not embedded in the constant.

The card must cover all 40 registered tools. Group them by function rather than listing individually. The canonical loop (8 steps) is the highest-priority section.

```typescript
// Source: existing LEGATE_UPDATE_COMMAND_CONTENT pattern in src/cli.ts (lines 35-44)

// Static part — defined as a module-level constant
const LEGATE_SKILL_CARD_STATIC = `# Legate — Skill Card

**Install:** \`npm install -g legate\`  **Update:** \`/legate-update\`

## Canonical Loop
1. CREATE: \`legate_create_session({title, directory, server?})\` — returns sessionId
2. RUN: \`legate_run({sessionId, prompt})\` — blocks until agent finishes
3. DIFF: \`legate_get_diff({sessionId})\` — inspect FileDiff[]
4. REVIEW: read modified files yourself
5. TEST: run build/test commands via Bash tool — never delegate testing
6. DECIDE: commit if good; \`legate_run("correct: ...")\` if not; fork/revert if off-rails
7. DELETE: \`legate_session_delete({sessionId})\` — required hygiene every time
8. ABORT: \`legate_abort({sessionId})\` — emergency stop if legate_run hangs

## Tools (40 total — prefix all with legate_)
| Group | Tools |
|-------|-------|
| Core loop | create_session, run, prompt_async, abort, get_diff, fork, revert, session_delete, approve_permission |
| Session mgmt | session_list, session_status, session_get, session_rename, session_init, session_children, session_unrevert |
| Content | session_messages, session_message, session_command, session_summarize, session_todo, session_share, session_unshare |
| Delegation | delegate, dispatch, inspect, await |
| Discovery | list_agents, list_providers, list_tools, list_commands, list_mcp_servers, get_config |
| File/code | find_file, find_symbol, get_file_content, file_status, vcs_info |
| Shell/infra | session_shell, inject_mcp_server |

## Rules
- Always pass \`directory\` explicitly to create_session — never rely on server default
- Delete every session when done — sessions accumulate indefinitely if not cleaned
- Never commit from inside a legate_run call — you commit, OpenCode edits
- git is the safety net: \`git checkout -- .\` resets bad output
- Pass \`server: "<name>"\` to target a specific worker from the list below
`;

// Dynamic part — generated at install time from registry
function buildWorkersSection(): string {
  const { servers } = readRegistry();
  const bullets = servers.map(
    (s) => `- **${s.name}** — ${s.providerID}/${s.modelID}, ${s.host}:${s.port}, capacity: ${s.maxSessions ?? 'unlimited'}`
  );
  const content = bullets.length > 0 ? bullets.join('\n') : '*(no servers registered — run: legate add-server)*';
  return `\n## Available Workers\n\n${content}\n`;
}
```

**Note on SKILL-02 (card replaces MCP schema loading):** This is a behavioral expectation about how Claude reads context, not an enforcement mechanism in code. The card must be complete enough that an informed Claude can use legate tools without reading MCP schema descriptions. The grouped tool table achieves this — Claude can identify the right tool by group and verify exact names via introspection if needed.

### Pattern 2: handleInstallCommand Extension

The existing `handleInstallCommand` (lines 147-167 of cli.ts) writes only `legate-update.md`. Phase 6 refactors it: extract the actual file-writing into a shared `installSkillCards()` helper, then call that helper from both `handleInstallCommand` and the `init` case.

```typescript
// Source: existing handleInstallCommand in src/cli.ts

// NEW shared helper — no isGlobal guard
function installSkillCards(destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, 'legate.md'), LEGATE_SKILL_CARD_STATIC + buildWorkersSection());
  writeFileSync(join(destDir, 'legate-update.md'), LEGATE_UPDATE_COMMAND_CONTENT);
}

function handleInstallCommand(): never {
  if (!isGlobal) process.exit(0);

  const destDir = join(homedir(), '.claude', 'commands');
  try {
    installSkillCards(destDir);
    if (!process.env.npm_lifecycle_event) {
      console.error(`Installed /legate and /legate-update commands to ${destDir}`);
    }
  } catch (err) {
    console.error(`Warning: legate commands not installed — ${(err as Error).message}`);
    process.exit(0);
  }
  process.exit(0);
}
```

### Pattern 3: handleUninstallCommand Extension

Currently only removes `legate-update.md`. Must also remove `legate.md`. Both use `rmSync({ force: true })` so they are silent when the file is absent.

```typescript
// Source: existing handleUninstallCommand in src/cli.ts (lines 169-181)
function handleUninstallCommand(): never {
  if (!isGlobal) process.exit(0);

  const destDir = join(homedir(), '.claude', 'commands');
  try {
    rmSync(join(destDir, 'legate.md'), { force: true });       // NEW
    rmSync(join(destDir, 'legate-update.md'), { force: true }); // EXISTING
  } catch {
    // non-fatal — exit 0 silently
  }
  process.exit(0);
}
```

### Pattern 4: legate init Integration (SKILL-01, SKILL-04)

REQUIREMENTS say `legate init` installs both files. Currently `legate init` writes `.mcp.json` and calls `printOnboardingIfNoServers()`. It does NOT call `installSkillCards`.

Add a call to `installSkillCards` in the `init` case, after writing `.mcp.json`. Wrap in try/catch to keep errors non-fatal (same pattern as the install-command handler).

```typescript
// In the 'init' switch case, after writing .mcp.json:
try {
  installSkillCards(join(homedir(), '.claude', 'commands'));
  console.error(`Installed /legate and /legate-update skill cards`);
} catch (err) {
  console.error(`Warning: skill cards not installed — ${(err as Error).message}`);
}
```

**Design decision (SKILL-01 vs SKILL-04 interpretation):** SKILL-04 says `legate init` installs `legate-update.md`. SKILL-01 says `legate init` installs `legate.md`. Both files are written by the same `installSkillCards()` call from `init`. The `install-command` subcommand (called by `postinstall`) also calls this helper, preserving the existing npm lifecycle behavior.

**legate init — no `--force` requirement for skill cards:** The existing `init` command requires `--force` to overwrite the `.mcp.json` legate entry but this guard only applies to `.mcp.json`. Skill card overwrites are always idempotent (`writeFileSync` overwrites by design, per SKILL-05). No separate `--force` check for the skill card files.

### Anti-Patterns to Avoid

- **Separate `install-skill` subcommand:** Do not introduce a new CLI subcommand. The requirements explicitly say `legate init` is the entry point. The `install-command` hook covers the npm lifecycle path.
- **Reading EXAMPLE_CLAUDE.md at runtime:** The skill card content must not be read from disk at install time (fragile — file may not exist in global install). Define content as a TypeScript string constant at module scope, compiled into `build/cli.js`.
- **Async file I/O:** All existing cli.ts file I/O is synchronous (`writeFileSync`, `rmSync`). Stay synchronous.
- **Writing legate.md from `updateClaudemdWorkers`:** That function writes to `CLAUDE.md` in the project's cwd. The skill card writes to the user's global `~/.claude/commands/`. These are separate concerns; do not mix.
- **Checking isGlobal for legate init:** `legate init` is run by the user manually and should always write skill cards. Only `install-command` / `uninstall-command` (npm lifecycle hooks) should guard on `isGlobal`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Workers bullet generation | Custom serializer | Extend existing `updateClaudemdWorkers` bullet pattern from cli.ts | Identical format; consistency across CLAUDE.md and legate.md |
| File system error handling | Custom error types | `try/catch` with `(err as Error).message` | Existing pattern; exit 0 on failure keeps npm install safe |
| Skill card content | Separate .md source file read at runtime | TypeScript template literal constant | Compiled into build/cli.js; no runtime file dependency; cannot fail |

## Runtime State Inventory

This phase does not rename anything. No runtime state migration required.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — phase adds new files, does not rename existing ones | None |
| Live service config | `~/.claude/commands/legate-update.md` — already installed by Phase 5; Phase 6 overwrites it in place | Overwrite handled by `writeFileSync` |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | `build/cli.js` — compiled from src/cli.ts; must be rebuilt after changes | `npm run build` |

## Common Pitfalls

### Pitfall 1: isGlobal Guard Blocks legate init
**What goes wrong:** If the skill card installation inside `handleInstallCommand` is gated behind `if (!isGlobal) process.exit(0)`, then `legate init` (which is never a global lifecycle event) would skip writing the files.
**Why it happens:** The existing handler was written with the assumption that only `postinstall` calls it.
**How to avoid:** Extract skill card writes into `installSkillCards()` which is NOT guarded by `isGlobal`. Call it from both the `init` case (always) and from `handleInstallCommand` (after the isGlobal guard).
**Warning signs:** Test `legate init` in a temp dir with `HOME` overridden — if `legate.md` is missing, the guard is wrong.

### Pitfall 2: Skill Card Tool Table Incomplete
**What goes wrong:** SKILL-02 says the card replaces MCP schema loading. If the card omits tool groups, Claude cannot identify the right tool without loading MCP schemas.
**Why it happens:** Guessing the tool list from memory instead of verifying against `index.ts`.
**How to avoid:** There are **40 registered tools** [VERIFIED: `grep -c "server.registerTool" src/index.ts` = 40]. The full sorted list:
`legate_abort`, `legate_approve_permission`, `legate_await`, `legate_create_session`, `legate_delegate`, `legate_dispatch`, `legate_file_status`, `legate_find_file`, `legate_find_symbol`, `legate_fork`, `legate_get_config`, `legate_get_diff`, `legate_get_file_content`, `legate_inject_mcp_server`, `legate_inspect`, `legate_list_agents`, `legate_list_commands`, `legate_list_mcp_servers`, `legate_list_providers`, `legate_list_tools`, `legate_prompt_async`, `legate_revert`, `legate_run`, `legate_session_children`, `legate_session_command`, `legate_session_delete`, `legate_session_get`, `legate_session_init`, `legate_session_list`, `legate_session_message`, `legate_session_messages`, `legate_session_rename`, `legate_session_share`, `legate_session_shell`, `legate_session_status`, `legate_session_summarize`, `legate_session_todo`, `legate_session_unrevert`, `legate_session_unshare`, `legate_vcs_info`.
Group them in the card rather than listing 40 individual rows.
**Warning signs:** `grep -c "server.registerTool" src/index.ts` returns a different number after future tool additions — regenerate the card.

### Pitfall 3: Workers Section Missing from legate.md on Fresh Install
**What goes wrong:** `buildWorkersSection()` reads `~/.config/legate/servers.json`. On a fresh machine with no servers registered, the file is absent. `readRegistry()` returns `{ servers: [] }` in that case (ENOENT path returns empty). The workers section should still render, just with the "no servers registered" message.
**Why it happens:** Not testing the empty-registry path.
**How to avoid:** Test with `HOME` pointing to a temp dir with no `servers.json`. Assert that `legate.md` is still written and contains the "no servers registered" placeholder.
**Warning signs:** If the workers section is completely absent from the card, `readRegistry` may be throwing instead of returning empty.

### Pitfall 4: uninstall-command Leaves legate.md Behind
**What goes wrong:** `handleUninstallCommand` removes only `legate-update.md`, leaving `legate.md` orphaned.
**Why it happens:** The existing handler predates Phase 6; it only knew about one file.
**How to avoid:** The `rmSync` call for `legate.md` must be added to `handleUninstallCommand`. Write a test that installs both files then calls `uninstall-command` and asserts both are gone.
**Warning signs:** `ls ~/.claude/commands/` after `npm uninstall -g legate` still shows `legate.md`.

### Pitfall 5: legate.md Content Too Long (Context Budget)
**What goes wrong:** SKILL-02 says the card replaces verbose schema loading by being compact. A card that is very long defeats the purpose.
**Why it happens:** Listing all 40 tools individually instead of grouping by function.
**How to avoid:** Keep the card under ~80 lines total. Use the grouped tool table (7 groups, not 40 rows). Full parameter lists belong in the MCP schema (always available via introspection); the card only needs group names, tool names, and the canonical loop.
**Warning signs:** Card exceeds 100 lines.

### Pitfall 6: Broken Error Message After Adding legate.md
**What goes wrong:** The existing warning message `Warning: legate-update command not installed — <msg>` becomes inaccurate when `legate.md` write also fails.
**Why it happens:** Message was written for a single-file install.
**How to avoid:** Update the warning message to `Warning: legate commands not installed — <msg>` to cover both files.
**Warning signs:** Test `SELFUP: install-command warns to stderr` in cli.test.ts — it asserts the exact message `Warning: legate-update command not installed —`; update that assertion.

## Code Examples

### Complete verified tool list from src/index.ts (40 tools)

[VERIFIED: `grep -A2 "server.registerTool(" src/index.ts | grep "legate_"` — 2026-05-17]

**Core loop (canonical 8-step tools):**
- `legate_create_session` — create a session, returns sessionId
- `legate_run` — send a prompt, block until agent finishes
- `legate_prompt_async` — fire-and-forget prompt (returns 204 immediately)
- `legate_abort` — emergency stop for a running session
- `legate_get_diff` — get file diffs for a session or message
- `legate_fork` — fork session at a message ID
- `legate_revert` — revert a single bad message
- `legate_session_delete` — delete session (required hygiene)
- `legate_approve_permission` — approve/reject a permission request

**Session management:**
- `legate_session_list` — list all sessions
- `legate_session_status` — get session status (idle/busy)
- `legate_session_get` — get session details
- `legate_session_rename` — rename a session
- `legate_session_init` — initialize a session with context
- `legate_session_children` — list child sessions
- `legate_session_unrevert` — undo a revert operation

**Content/history:**
- `legate_session_messages` — list messages in a session
- `legate_session_message` — get a single message
- `legate_session_command` — run a slash command in a session
- `legate_session_summarize` — summarize session history
- `legate_session_todo` — manage session todos
- `legate_session_share` — share a session
- `legate_session_unshare` — unshare a session

**Delegation:**
- `legate_delegate` — delegate work to another session
- `legate_dispatch` — dispatch work to a session
- `legate_inspect` — inspect session state
- `legate_await` — await completion of an async operation

**Discovery:**
- `legate_list_agents` — list available agents
- `legate_list_providers` — list providers and models
- `legate_list_tools` — list available tools
- `legate_list_commands` — list available slash commands
- `legate_list_mcp_servers` — list configured MCP servers
- `legate_get_config` — get OpenCode configuration

**File/code:**
- `legate_find_file` — find files by name/pattern
- `legate_find_symbol` — find symbols in code
- `legate_get_file_content` — get file contents
- `legate_file_status` — get file status
- `legate_vcs_info` — get version control info

**Shell/infrastructure:**
- `legate_session_shell` — run shell commands in session context
- `legate_inject_mcp_server` — inject an MCP server into a session

### Existing `updateClaudemdWorkers` bullet format (canonical reference for workers section)
```typescript
// Source: src/cli.ts lines 51-55 [VERIFIED: local codebase]
const bullets = servers.map(
  (s) => `- **${s.name}** — ${s.providerID}/${s.modelID}, ${s.host}:${s.port}, capacity: ${s.maxSessions ?? 'unlimited'}`
);
```
The `legate.md` workers section must use this exact format for consistency with what CLAUDE.md shows.

### runCliAsGlobal test helper (canonical pattern for testing install-command in global mode)
```typescript
// Source: src/cli.test.ts lines 446-467 [VERIFIED: local codebase]
// Sets npm_config_global='true', copies build artifacts to fake global root
// Use for testing SKILL-01..SKILL-05 installation paths
```

### Actual servers.json format (confirmed from live registry)
```json
// Source: ~/.config/legate/servers.json [VERIFIED: direct read]
{
  "servers": [
    {
      "name": "thor",
      "host": "localhost",
      "port": 4096,
      "providerID": "vllm",
      "modelID": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
      "maxSessions": 2
    }
  ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `prefect-update.md` only | `legate-update.md` only | Phase 5 (rename) | One file installed |
| Manual CLAUDE.md instructions | `legate.md` skill card | Phase 6 (this phase) | Structured, versioned, auto-installed reference |

**What did not exist before Phase 6:**
- `legate.md` skill card file
- `legate init` writing skill cards
- `uninstall-command` removing `legate.md`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `legate init` should write skill cards unconditionally (no `isGlobal` guard) | Pattern 4 | If wrong, `legate init` on a local install would not install skill cards — contradicts SKILL-01 success criteria |
| A2 | The skill card content should be a TypeScript string constant, not read from a file at runtime | Pattern 1 | If wrong (file-based), `legate.md` could fail to install on machines where source files aren't co-located with `build/cli.js` |
| A3 | `legate-update.md` installation stays in `handleInstallCommand` (not moved to `init` only) | Pattern 2 | If moved exclusively to `init`, `npm install -g legate` postinstall would no longer auto-install it |

## Open Questions

1. **Should `install-command` (npm postinstall) also write `legate.md`?**
   - What we know: postinstall currently writes only `legate-update.md`. Requirements say `legate init` writes both. The `install-command` path is used by `npm install -g legate` (postinstall hook).
   - What's unclear: should a fresh `npm install -g legate` auto-install the skill card, or only when user explicitly runs `legate init`?
   - Recommendation: Yes — extend `handleInstallCommand` via the shared `installSkillCards()` helper. The postinstall hook is the canonical "first setup" event. A user who installs globally and never runs `legate init` should still get the skill card.

2. **Should `legate init` skip or require `--force` for skill card overwrites?**
   - What we know: SKILL-05 says "overwrites on reinstall" — idempotent. Current `init` requires `--force` for `.mcp.json` but only because a conflicting key could break an existing MCP config.
   - Recommendation: Always overwrite `legate.md` and `legate-update.md` without `--force`. Files in `~/.claude/commands/` are managed artifacts, not user-edited files. Silent overwrite is the correct behavior.

3. **Should `legate init` print a message when skill cards are installed?**
   - What we know: Current `init` prints messages to stderr about `.mcp.json` creation. The `install-command` handler is silent when called via lifecycle hook (`npm_lifecycle_event` check).
   - Recommendation: Print a short message when called via `legate init` (not lifecycle). Example: `Installed /legate and /legate-update skill cards to ~/.claude/commands/`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 20 | Build and CLI | Yes | 20.20.0 | — |
| TypeScript | Build | Yes | 6.0.3 | — |
| `~/.claude/commands/` directory | Skill card install | Created by `mkdirSync` if absent | — | — |
| `~/.config/legate/servers.json` | Workers section generation | Optional — ENOENT returns empty registry | — | Empty workers section with placeholder message |

**Missing dependencies with no fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` |
| Config file | none — test command hardcoded in package.json scripts |
| Quick run command | `npm run build && node --test build/cli.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SKILL-01 | `legate init` writes `~/.claude/commands/legate.md` | integration | `npm test` (cli.test.js) | No — Wave 0 |
| SKILL-01 | `legate.md` contains canonical loop text | integration | `npm test` (cli.test.js) | No — Wave 0 |
| SKILL-01 | `legate.md` contains tool group table | integration | `npm test` (cli.test.js) | No — Wave 0 |
| SKILL-02 | (behavioral — Claude reads card) | manual | n/a | — |
| SKILL-03 | `legate.md` workers section reflects servers.json | integration | `npm test` (cli.test.js) | No — Wave 0 |
| SKILL-03 | `legate.md` workers section shows placeholder when registry empty | integration | `npm test` (cli.test.js) | No — Wave 0 |
| SKILL-04 | `legate init` writes `~/.claude/commands/legate-update.md` | integration | `npm test` (cli.test.js) | No — Wave 0 |
| SKILL-05 | Second `legate init` overwrites both files (idempotent) | integration | `npm test` (cli.test.js) | No — Wave 0 |
| SKILL-05 | `legate uninstall-command` removes `legate.md` | integration | `npm test` (cli.test.js) | No — Wave 0 |
| SKILL-05 | `legate uninstall-command` removes `legate-update.md` | integration | `npm test` (cli.test.js) | existing — extend |
| SKILL-05 | `legate uninstall-command` exits 0 when files absent | integration | `npm test` (cli.test.js) | existing — verify still passes |
| non-regression | All 120 existing SELFUP tests pass | integration | `npm test` | Yes |

### Sampling Rate
- **Per task commit:** `npm run build && node --test build/cli.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** All 120 existing tests green + new SKILL tests green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/cli.test.ts` — add SKILL-01 through SKILL-05 test cases (extends existing file, does not create new one)
- [ ] Update existing `SELFUP: install-command warns to stderr` test — the warning message changes from `Warning: legate-update command not installed —` to `Warning: legate commands not installed —`

*(No new test files needed — all skill card tests belong in the existing `src/cli.test.ts`.)*

## Security Domain

This phase writes files only to `~/.claude/commands/` (user-owned directory) and reads from `~/.config/legate/servers.json` (user-owned). No network requests, no privilege escalation, no sensitive data handling.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | No (no user input in file paths) | — |
| V6 Cryptography | No | — |

**Known Threat Patterns:** None applicable — this is a local file write to user-owned directories using Node.js built-in fs module.

## Sources

### Primary (HIGH confidence)
- Local codebase: `src/cli.ts` — existing `handleInstallCommand`, `handleUninstallCommand`, `LEGATE_UPDATE_COMMAND_CONTENT`, `updateClaudemdWorkers` patterns [VERIFIED: direct file read]
- Local codebase: `src/cli.test.ts` — existing `runCliAsGlobal` helper and SELFUP test structure [VERIFIED: direct file read]
- Local codebase: `src/registry.ts` — `readRegistry()` signature and ENOENT handling [VERIFIED: direct file read]
- Local codebase: `src/index.ts` — complete `legate_*` tool list (40 tools confirmed) [VERIFIED: `grep -c "server.registerTool" src/index.ts` and `grep -A2 "server.registerTool"` enumeration]
- Local codebase: `package.json` — postinstall/preuninstall hooks, package version 2.1.0 [VERIFIED: direct file read]
- Local machine: `~/.config/legate/servers.json` — actual registry format with 3 real server entries [VERIFIED: direct read]
- Local machine: `~/.claude/commands/` — existing command file structure and `prefect-update.md` / `legate-update.md` content [VERIFIED: ls + cat]
- `.planning/REQUIREMENTS.md` — SKILL-01..SKILL-05 verbatim requirements [VERIFIED: direct file read]
- `.planning/ROADMAP.md` — Phase 6 success criteria [VERIFIED: direct file read]

### Secondary (MEDIUM confidence)
- `.planning/phases/02-self-update/02-01-PLAN.md` — original SELFUP plan structure for install-command tests [VERIFIED: direct file read]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all patterns already in codebase
- Architecture: HIGH — direct extension of existing, well-tested patterns
- Tool list: HIGH — verified by grep against index.ts (40 confirmed)
- Pitfalls: HIGH — derived from reading actual code and test structure
- Skill card content design: MEDIUM — specific groupings and token budget are design decisions; A1-A3 assumptions need planner review

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (stable — TypeScript/Node.js; no fast-moving dependencies)
