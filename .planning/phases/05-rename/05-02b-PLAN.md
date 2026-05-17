---
phase: 05-rename
plan: 02b
type: execute
wave: 3
depends_on: ["05-02"]
files_modified:
  - src/auth.ts
  - src/config.ts
  - src/autostart.ts
  - src/sessions.ts
  - src/cli.ts
  - src/registry.ts
  - src/handlers.ts
  - src/auth.test.ts
  - src/autostart.test.ts
  - src/sessions.test.ts
  - src/cli.test.ts
  - src/registry.test.ts
  - src/session-command.test.ts
autonomous: true
requirements:
  - RENAME-04
user_setup: []
tags:
  - typescript
  - rename
  - env-vars
  - deprecation
  - cli

must_haves:
  truths:
    - "All 7 env vars accept LEGATE_* as primary and warn-once when only the deprecated PREFECT_* is set; existing OPENCODE_* fallbacks for SERVER_PASSWORD/USERNAME/DEFAULT_PROJECT continue to work with their existing (brand-updated) deprecation warnings"
    - "All `[Prefect]` console.error prefixes in auth.ts, config.ts, autostart.ts, sessions.ts, cli.ts, handlers.ts are now `[Legate]`"
    - "src/cli.ts writes `mcpServers.legate` key to .mcp.json and installs ~/.claude/commands/legate-update.md"
    - "src/autostart.ts EXPORTS autostartTimeoutMs (was module-private) and EXPORTS _resetWarnFlags for test isolation"
    - "src/sessions.ts EXPORTS _resetWarnFlags for test isolation"
    - "REGISTRY_DIR (src/registry.ts) and SESSIONS_DIR (src/sessions.ts) still resolve to ~/.config/prefect/ (config directory rename explicitly out of scope)"
    - "All 6 test files use LEGATE_* env var names (except the Plan 01 deprecation tests at bottom which intentionally exercise the PREFECT_* path)"
    - "`npm test` passes — RED tests from Plan 01 are now GREEN, pre-existing tests migrated to LEGATE_* names also GREEN"
    - "`npm run build` succeeds — TypeScript compiles with no errors"
  artifacts:
    - path: "src/auth.ts"
      provides: "Three-tier env var chain LEGATE_ → PREFECT_ (warn) → OPENCODE_ (warn) for SERVER_PASSWORD and SERVER_USERNAME"
      contains: "LEGATE_SERVER_PASSWORD"
    - path: "src/config.ts"
      provides: "Three-tier env var chain for DEFAULT_PROJECT"
      contains: "LEGATE_DEFAULT_PROJECT"
    - path: "src/autostart.ts"
      provides: "Two-tier env var chain for AUTOSTART_TIMEOUT_MS plus exported helpers for tests"
      contains: "LEGATE_AUTOSTART_TIMEOUT_MS"
    - path: "src/sessions.ts"
      provides: "Two-tier env var chain for SESSION_TTL_MS"
      contains: "LEGATE_SESSION_TTL_MS"
    - path: "src/cli.ts"
      provides: "CLI binary with `legate` brand and .mcp.json key `legate`"
      contains: "mcpServers: { legate:"
    - path: "src/registry.ts"
      provides: "User-facing CLI error message uses `legate add-server`; REGISTRY_DIR path unchanged"
      contains: "legate add-server"
    - path: "src/handlers.ts"
      provides: "JSDoc/inline comments reference legate_* tool names; [Legate] brand in any log lines"
      contains: "legate_"
    - path: "src/auth.test.ts"
      provides: "Pre-existing tests migrated to LEGATE_*; Plan 01 deprecation tests preserved verbatim and now GREEN"
      contains: "process.env.LEGATE_SERVER_PASSWORD"
    - path: "src/autostart.test.ts"
      provides: "Pre-existing tests migrated to LEGATE_*; Plan 01 deprecation tests now GREEN"
      contains: "process.env.LEGATE_AUTOSTART_TIMEOUT_MS"
    - path: "src/sessions.test.ts"
      provides: "Pre-existing tests migrated to LEGATE_*; temp dir prefix renamed; Plan 01 deprecation tests now GREEN"
      contains: "process.env.LEGATE_SESSION_TTL_MS"
    - path: "src/cli.test.ts"
      provides: "cli tests assert against legate brand and mcpServers.legate key; ~/.config/prefect/ path assertions PRESERVED"
      contains: "cfg.mcpServers.legate"
    - path: "src/registry.test.ts"
      provides: "registry tests use legate-registry- temp dir prefix"
      contains: "legate-registry-"
    - path: "src/session-command.test.ts"
      provides: "comment line references legate_session_command"
      contains: "legate_session_command"
  key_links:
    - from: "src/cli.ts init subcommand"
      to: ".mcp.json file write"
      via: "JSON write of mcpServers.legate"
      pattern: "mcpServers.*legate"
    - from: "Plan 01 deprecation tests"
      to: "implementations in this plan (auth.ts, autostart.ts, sessions.ts)"
      via: "npm test green"
      pattern: "PREFECT_.*is deprecated"
    - from: "src/autostart.test.ts"
      to: "src/autostart.ts exported autostartTimeoutMs and _resetWarnFlags"
      via: "Plan 01 imports — now resolve because Task 1 of this plan exports them"
      pattern: "export function autostartTimeoutMs"
    - from: "src/sessions.test.ts"
      to: "src/sessions.ts exported _resetWarnFlags"
      via: "Plan 01 imports — now resolve"
      pattern: "export function _resetWarnFlags"
---

<objective>
Complete the source rename started by Plan 02 (which finished package.json + src/index.ts). This plan renames the remaining 7 source modules that read env vars or contain prefect-branded strings (auth.ts, config.ts, autostart.ts, sessions.ts, cli.ts, registry.ts, handlers.ts) and updates the 6 test files that reference PREFECT_* env vars or `prefect` brand strings. The `~/.config/prefect/` runtime directory paths in registry.ts/sessions.ts stay unchanged.

Purpose: Complete RENAME-04 (env var soft migration) across all remaining files. Turn the RED tests from Plan 01 GREEN. Preserve the existing OPENCODE_* deprecation chain — do not remove that backward compatibility layer. Preserve config dir path `~/.config/prefect/` literally.

Output: A buildable, fully-tested codebase where `npm test` passes and `npm run build` produces a clean compile. After this plan, only documentation (Plan 03) remains to close out Phase 5.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/05-rename/05-RESEARCH.md
@.planning/phases/05-rename/05-PATTERNS.md
@.planning/phases/05-rename/05-VALIDATION.md
@.planning/phases/05-rename/05-01-SUMMARY.md
@.planning/phases/05-rename/05-02-SUMMARY.md

<interfaces>
<!-- Concrete target signatures and identifiers — executor uses these directly -->

src/auth.ts targets:
- Add module-level flags: warnedPrefectPassword, warnedPrefectUsername
- buildAuthHeader password chain: LEGATE_SERVER_PASSWORD → PREFECT_SERVER_PASSWORD (warn once) → OPENCODE_SERVER_PASSWORD (warn once, preserved)
- buildAuthHeader username chain: LEGATE_SERVER_USERNAME → PREFECT_SERVER_USERNAME (warn once) → OPENCODE_SERVER_USERNAME (warn once, preserved)
- _resetWarnFlags() resets ALL four flags: warnedPassword, warnedUsername, warnedPrefectPassword, warnedPrefectUsername
- Warning text format: '[Legate] PREFECT_SERVER_PASSWORD is deprecated, use LEGATE_SERVER_PASSWORD'
- All other '[Prefect]' strings → '[Legate]'

src/config.ts targets:
- Add module-level flag: warnedPrefectDefaultProject (existing warnedDefaultProject kept for OPENCODE_ tier)
- resolveDirectory chain: param → LEGATE_DEFAULT_PROJECT → PREFECT_DEFAULT_PROJECT (warn once) → OPENCODE_DEFAULT_PROJECT (warn once, preserved)
- Warning text: '[Legate] PREFECT_DEFAULT_PROJECT is deprecated, use LEGATE_DEFAULT_PROJECT'

src/autostart.ts targets:
- Add module-level flag: warnedAutostartTimeout
- autostartTimeoutMs() reads LEGATE_AUTOSTART_TIMEOUT_MS first, falls back to PREFECT_AUTOSTART_TIMEOUT_MS with one-time warning
- EXPORT autostartTimeoutMs (currently module-private) so Plan 01 tests can call it directly
- EXPORT _resetWarnFlags() helper that resets warnedAutostartTimeout (mirrors auth.ts pattern)
- All other '[Prefect]' strings → '[Legate]' (RESEARCH.md notes lines 65, 76, 87)

src/sessions.ts targets:
- Add module-level flag: warnedSessionTtl
- readSessionMap reads LEGATE_SESSION_TTL_MS first, falls back to PREFECT_SESSION_TTL_MS with one-time warning
- EXPORT _resetWarnFlags() helper that resets warnedSessionTtl
- SESSIONS_DIR / SESSIONS_PATH UNCHANGED — must remain ~/.config/prefect/sessions.json
- Update capacity error message line 154 from 'prefect_session_delete' to 'legate_session_delete'
- '[Prefect]' line 48 → '[Legate]'

src/cli.ts targets:
- Rename PREFECT_ENTRY → LEGATE_ENTRY (variable name and content); change 'prefect-mcp' to 'legate-mcp' in entry command
- Rename PREFECT_UPDATE_COMMAND_CONTENT → LEGATE_UPDATE_COMMAND_CONTENT; content references '/legate-update' slash command and '@momidala/legate' npm package
- usageAndExit() all 'prefect <subcommand>' → 'legate <subcommand>'; all '/prefect-update' → '/legate-update'
- handleInstallCommand / handleUninstallCommand: 'prefect-update.md' filename → 'legate-update.md'
- init subcommand: { mcpServers: { legate: LEGATE_ENTRY } }; check 'legate' in servers; servers.legate = LEGATE_ENTRY; all log messages 'prefect entry' → 'legate entry'
- printOnboardingIfNoServers: 'prefect add-server' → 'legate add-server'
- handleAddServer / handleRemoveServer: 'Usage: prefect ...' messages → 'Usage: legate ...'

src/registry.ts targets:
- Line 75 message: 'No servers registered. Use: prefect add-server ...' → '... Use: legate add-server ...'
- REGISTRY_DIR / REGISTRY_PATH (lines 18-19) UNCHANGED — must remain ~/.config/prefect/

src/handlers.ts targets:
- Comments and JSDoc references to prefect_* tool names → legate_* (no runtime string changes)
- Any '[Prefect]' log prefixes → '[Legate]'

Test file targets (env var renames + temp dir prefix renames):
- src/auth.test.ts: PREFECT_SERVER_PASSWORD/USERNAME → LEGATE_SERVER_PASSWORD/USERNAME in all existing tests; KEEP the Plan 01 deprecation tests intact and ensure they go GREEN
- src/autostart.test.ts: PREFECT_AUTOSTART_TIMEOUT_MS → LEGATE_AUTOSTART_TIMEOUT_MS; PREFECT_SERVER_PASSWORD → LEGATE_SERVER_PASSWORD; Plan 01 tests go GREEN
- src/sessions.test.ts: PREFECT_SESSION_TTL_MS → LEGATE_SESSION_TTL_MS; temp dir prefix 'prefect-sessions-' → 'legate-sessions-'; Plan 01 tests go GREEN
- src/cli.test.ts: temp dir prefix 'prefect-cli-' → 'legate-cli-'; cfg.mcpServers.prefect → cfg.mcpServers.legate (all occurrences lines 34-109); usage message assertions 'Usage: prefect' → 'Usage: legate' (lines 121, 152); DO NOT change ~/.config/prefect/ path assertions (lines 136-137, 187 — config dir out of scope)
- src/registry.test.ts: temp dir prefix 'prefect-registry-' → 'legate-registry-'
- src/session-command.test.ts: comment line 5 'prefect_session_command' → 'legate_session_command'
</interfaces>

<verification_greps>
After source changes, these greps must produce the indicated counts:
- `grep -c "\\[Prefect\\]" src/*.ts` → 0 (all files)
- `grep "REGISTRY_DIR" src/registry.ts` → still references 'prefect' (unchanged — out of scope)
- `grep "SESSIONS_DIR" src/sessions.ts` → still references 'prefect' (unchanged — out of scope)
- `npm test` → exit 0
</verification_greps>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rename env-var-reading modules (auth.ts, config.ts, autostart.ts, sessions.ts) + non-test utility modules (cli.ts, registry.ts, handlers.ts)</name>
  <files>src/auth.ts, src/config.ts, src/autostart.ts, src/sessions.ts, src/cli.ts, src/registry.ts, src/handlers.ts</files>
  <read_first>
    - src/auth.ts (entire file — existing OPENCODE_ fallback pattern, _resetWarnFlags helper, '[Prefect]' prefixes)
    - src/config.ts (entire file — existing OPENCODE_DEFAULT_PROJECT fallback)
    - src/autostart.ts (entire file — autostartTimeoutMs function definition; '[Prefect]' lines 65/76/87)
    - src/sessions.ts (entire file — readSessionMap line 33, '[Prefect]' line 48, capacity error line 154 referencing prefect_session_delete, SESSIONS_DIR line 21 must NOT change)
    - src/cli.ts (entire file — PREFECT_ENTRY, PREFECT_UPDATE_COMMAND_CONTENT, usageAndExit, handleInstallCommand, handleUninstallCommand, init subcommand, printOnboardingIfNoServers, handleAddServer, handleRemoveServer)
    - src/registry.ts (REGISTRY_DIR lines 18-19 must NOT change; user-facing error line 75 must change)
    - src/handlers.ts (entire file — comments/JSDoc only)
    - .planning/phases/05-rename/05-PATTERNS.md (sections for each of these source files with exact target patterns)
  </read_first>
  <action>
    For src/auth.ts: Add two new module-level boolean flags warnedPrefectPassword and warnedPrefectUsername initialized to false. Rewrite buildAuthHeader so the password lookup chain becomes: process.env.LEGATE_SERVER_PASSWORD ?? (IIFE that reads PREFECT_SERVER_PASSWORD, warns once via warnedPrefectPassword, returns it) ?? (existing IIFE that reads OPENCODE_SERVER_PASSWORD with warnedPassword guard but emits '[Legate]' brand). Same three-tier shape for username with warnedPrefectUsername. Warning text format: '[Legate] PREFECT_SERVER_PASSWORD is deprecated, use LEGATE_SERVER_PASSWORD' and same for USERNAME. Update _resetWarnFlags to also reset warnedPrefectPassword and warnedPrefectUsername. Replace every '[Prefect]' string in console.error calls with '[Legate]'.

    For src/config.ts: Add module-level warnedPrefectDefaultProject flag. Rewrite resolveDirectory chain: perToolParam ?? LEGATE_DEFAULT_PROJECT ?? (IIFE reads PREFECT_DEFAULT_PROJECT with warnedPrefectDefaultProject guard, '[Legate] PREFECT_DEFAULT_PROJECT is deprecated, use LEGATE_DEFAULT_PROJECT') ?? (existing IIFE reads OPENCODE_DEFAULT_PROJECT with warnedDefaultProject guard, '[Legate]' brand). Update '[Prefect]' to '[Legate]'.

    For src/autostart.ts: Add module-level warnedAutostartTimeout flag. EXPORT autostartTimeoutMs (it was module-private — change to `export function`) so Plan 01 tests can call it directly. Implement two-tier chain: read LEGATE_AUTOSTART_TIMEOUT_MS first (parse and return if set), else read PREFECT_AUTOSTART_TIMEOUT_MS with one-time '[Legate] PREFECT_AUTOSTART_TIMEOUT_MS is deprecated, use LEGATE_AUTOSTART_TIMEOUT_MS' warning, default 30_000. Also EXPORT a _resetWarnFlags() function that resets warnedAutostartTimeout (test isolation, mirroring auth.ts). Replace all '[Prefect]' strings on lines 65/76/87 (and any others) with '[Legate]'.

    For src/sessions.ts: Add module-level warnedSessionTtl flag at top of file (before readSessionMap). Inside readSessionMap, replace the line `const ttlMs = Number(process.env.PREFECT_SESSION_TTL_MS ?? DEFAULT_SESSION_TTL_MS);` with a two-tier read: read LEGATE_SESSION_TTL_MS first; if not set and PREFECT_SESSION_TTL_MS is set, warn once via warnedSessionTtl with '[Legate] PREFECT_SESSION_TTL_MS is deprecated, use LEGATE_SESSION_TTL_MS' and use that value; else use DEFAULT_SESSION_TTL_MS. EXPORT _resetWarnFlags() that resets warnedSessionTtl. Update '[Prefect]' on line 48 to '[Legate]'. Update line 154 capacity error message: 'prefect_session_delete' → 'legate_session_delete'. SESSIONS_DIR and SESSIONS_PATH lines 21-22 stay literally 'prefect' — do NOT touch the join(homedir(), '.config', 'prefect') call.

    For src/cli.ts: Rename the const PREFECT_ENTRY to LEGATE_ENTRY (variable name) and change its content from { command: 'prefect-mcp' } to { command: 'legate-mcp' }. Rename PREFECT_UPDATE_COMMAND_CONTENT to LEGATE_UPDATE_COMMAND_CONTENT and update the content string to reference '/legate-update' slash command and '@momidala/legate' npm package. In usageAndExit() change every 'prefect <subcommand>' / 'Usage: prefect' / '/prefect-update' string to 'legate <subcommand>' / 'Usage: legate' / '/legate-update'. In handleInstallCommand and handleUninstallCommand replace the filename 'prefect-update.md' with 'legate-update.md'. In the init subcommand: the fresh-create config becomes { mcpServers: { legate: LEGATE_ENTRY } }; the existence check becomes `if ('legate' in servers && !force)`; assignment becomes `servers.legate = LEGATE_ENTRY`; all log messages 'prefect entry' → 'legate entry' and 'Updated prefect' / 'Added prefect' → 'Updated legate' / 'Added legate'. In printOnboardingIfNoServers change 'prefect add-server' to 'legate add-server'. In handleAddServer and handleRemoveServer change 'Usage: prefect ...' messages to 'Usage: legate ...'.

    For src/registry.ts: Change only line 75 user-facing message 'No servers registered. Use: prefect add-server ...' to 'No servers registered. Use: legate add-server ...'. Do NOT touch lines 18-19 REGISTRY_DIR — they stay 'prefect'.

    For src/handlers.ts: Update JSDoc and inline comment references to tool names from prefect_* to legate_* (use find/replace on the comment text). If any '[Prefect]' log prefix exists in this file, update to '[Legate]'. No structural code changes.

    After all edits run `npm run build`. Plan 01's deprecation tests (auth/autostart/sessions) MUST now PASS (GREEN) when their imports resolve. Pre-existing tests that referenced PREFECT_* env vars will FAIL until Task 2 updates them — that is expected.
  </action>
  <verify>
    <automated>cd /mnt/c/Users/larry/Documents/repos/momidala/prefect && npm run build 2>&1 | tail -5 && grep -v '^#' src/auth.ts src/config.ts src/autostart.ts src/sessions.ts src/cli.ts src/handlers.ts | grep -c "\\[Prefect\\]"</automated>
  </verify>
  <acceptance_criteria>
    - grep -c "LEGATE_SERVER_PASSWORD" src/auth.ts >= 1
    - grep -c "LEGATE_SERVER_USERNAME" src/auth.ts >= 1
    - grep -c "warnedPrefectPassword" src/auth.ts >= 2 (declaration + use)
    - grep -c "warnedPrefectUsername" src/auth.ts >= 2
    - In src/auth.ts, _resetWarnFlags body contains 'warnedPrefectPassword = false' AND 'warnedPrefectUsername = false'
    - grep -c "\\[Prefect\\]" src/auth.ts equals 0
    - grep -c "OPENCODE_SERVER_PASSWORD" src/auth.ts >= 1 (preserved)
    - grep -c "LEGATE_DEFAULT_PROJECT" src/config.ts >= 1
    - grep -c "warnedPrefectDefaultProject" src/config.ts >= 2
    - grep -c "OPENCODE_DEFAULT_PROJECT" src/config.ts >= 1 (preserved)
    - grep -c "\\[Prefect\\]" src/config.ts equals 0
    - grep -c "export function autostartTimeoutMs" src/autostart.ts equals 1
    - grep -c "export function _resetWarnFlags" src/autostart.ts equals 1
    - grep -c "LEGATE_AUTOSTART_TIMEOUT_MS" src/autostart.ts >= 1
    - grep -c "warnedAutostartTimeout" src/autostart.ts >= 2
    - grep -c "\\[Prefect\\]" src/autostart.ts equals 0
    - grep -c "LEGATE_SESSION_TTL_MS" src/sessions.ts >= 1
    - grep -c "warnedSessionTtl" src/sessions.ts >= 2
    - grep -c "export function _resetWarnFlags" src/sessions.ts equals 1
    - grep -c "\\[Prefect\\]" src/sessions.ts equals 0
    - grep "join(homedir" src/sessions.ts contains 'prefect' (SESSIONS_DIR unchanged)
    - grep "join(homedir" src/registry.ts contains 'prefect' (REGISTRY_DIR unchanged)
    - grep -c "legate-mcp" src/cli.ts >= 1
    - grep -c "LEGATE_ENTRY" src/cli.ts >= 2
    - grep -c "PREFECT_ENTRY" src/cli.ts equals 0
    - grep -c "mcpServers.*legate" src/cli.ts >= 1 OR grep -c "{ legate:" src/cli.ts >= 1
    - grep -c "legate-update.md" src/cli.ts >= 1
    - grep -c "prefect-update.md" src/cli.ts equals 0
    - grep -c "Usage: legate" src/cli.ts >= 1
    - grep -c "Usage: prefect" src/cli.ts equals 0
    - grep -c "legate add-server" src/registry.ts equals 1
    - grep -c "prefect add-server" src/registry.ts equals 0
    - `npm run build` exits 0
  </acceptance_criteria>
  <done>All seven source files renamed per the deprecation chain patterns; SESSIONS_DIR and REGISTRY_DIR config paths preserved; `npm run build` succeeds; Plan 01 deprecation tests now GREEN (pre-existing PREFECT_* tests in other files still RED — fixed by Task 2).</done>
</task>

<task type="auto">
  <name>Task 2: Update test files to use LEGATE_* env vars and legate brand strings</name>
  <files>src/auth.test.ts, src/autostart.test.ts, src/sessions.test.ts, src/cli.test.ts, src/registry.test.ts, src/session-command.test.ts</files>
  <read_first>
    - src/auth.test.ts (existing tests that set/delete PREFECT_SERVER_PASSWORD/USERNAME — the new Plan 01 tests are at the bottom and must remain unchanged)
    - src/autostart.test.ts (existing tests setting PREFECT_AUTOSTART_TIMEOUT_MS lines 65-66, 75-76 and PREFECT_SERVER_PASSWORD lines 81-96; Plan 01 tests at bottom must remain)
    - src/sessions.test.ts (existing tests setting PREFECT_SESSION_TTL_MS lines 171-208; temp dir prefix line 9; Plan 01 tests at bottom must remain)
    - src/cli.test.ts (entire file — cfg.mcpServers.prefect references lines 34-109; usage message assertions lines 121, 152; temp dir prefix line 14; ~/.config/prefect/ path assertions lines 136-137 and 187 must NOT change)
    - src/registry.test.ts (temp dir prefix line 12)
    - src/session-command.test.ts (comment line 5)
    - .planning/phases/05-rename/05-PATTERNS.md (test pattern assignments section)
    - .planning/phases/05-rename/05-VALIDATION.md (which tests cover which requirements)
  </read_first>
  <action>
    For src/auth.test.ts: in all pre-existing tests (NOT the new Plan 01 deprecation tests at the bottom), replace every `process.env.PREFECT_SERVER_PASSWORD` with `process.env.LEGATE_SERVER_PASSWORD` and every `process.env.PREFECT_SERVER_USERNAME` with `process.env.LEGATE_SERVER_USERNAME`. Replace matching `delete process.env.PREFECT_SERVER_PASSWORD/USERNAME` lines. The Plan 01 deprecation tests (which intentionally set PREFECT_* to verify the deprecated path) MUST remain literally as written — they test the deprecation chain and need the PREFECT_* var names.

    For src/autostart.test.ts: replace `process.env.PREFECT_AUTOSTART_TIMEOUT_MS` with `process.env.LEGATE_AUTOSTART_TIMEOUT_MS` and `process.env.PREFECT_SERVER_PASSWORD` with `process.env.LEGATE_SERVER_PASSWORD` in all pre-existing tests. Plan 01 deprecation tests untouched. If the Plan 01 tests import autostartTimeoutMs and/or _resetWarnFlags from src/autostart.ts, verify those imports now resolve (Task 1 exported them).

    For src/sessions.test.ts: replace `process.env.PREFECT_SESSION_TTL_MS` with `process.env.LEGATE_SESSION_TTL_MS` in all pre-existing tests. Change temp dir prefix from 'prefect-sessions-' to 'legate-sessions-' on line 9. Plan 01 deprecation tests untouched.

    For src/cli.test.ts: change temp dir prefix on line 14 from 'prefect-cli-' to 'legate-cli-'. Replace every `cfg.mcpServers.prefect` with `cfg.mcpServers.legate` across the file. Replace every usage-message assertion that expects 'Usage: prefect' with 'Usage: legate' (lines 121 and 152). DO NOT change any string literal that references the path '.config/prefect/' (lines 136-137 and 187) — that config dir is explicitly out of scope per RESEARCH.md and PATTERNS.md.

    For src/registry.test.ts: change temp dir prefix on line 12 from 'prefect-registry-' to 'legate-registry-'. If the file asserts on the 'No servers registered. Use: legate add-server' string emitted by registry.ts, ensure the assertion text matches 'legate add-server' (not 'prefect add-server').

    For src/session-command.test.ts: update the comment on line 5 from 'prefect_session_command' to 'legate_session_command'. No other changes.

    After all edits run `npm test` from project root. ALL tests must pass.
  </action>
  <verify>
    <automated>cd /mnt/c/Users/larry/Documents/repos/momidala/prefect && npm test 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - grep -c "process.env.LEGATE_SERVER_PASSWORD" src/auth.test.ts >= 1
    - grep -c "process.env.LEGATE_SERVER_USERNAME" src/auth.test.ts >= 1
    - In src/auth.test.ts, occurrences of `process.env.PREFECT_SERVER_PASSWORD` are scoped to the deprecation-warning test bodies only (Plan 01 tests at bottom)
    - grep -c "process.env.LEGATE_AUTOSTART_TIMEOUT_MS" src/autostart.test.ts >= 1
    - grep -c "process.env.LEGATE_SESSION_TTL_MS" src/sessions.test.ts >= 1
    - grep -c "legate-sessions-" src/sessions.test.ts equals 1
    - grep -c "legate-cli-" src/cli.test.ts equals 1
    - grep -c "legate-registry-" src/registry.test.ts equals 1
    - grep -c "cfg.mcpServers.legate" src/cli.test.ts >= 1
    - grep -c "cfg.mcpServers.prefect" src/cli.test.ts equals 0
    - grep -c "Usage: legate" src/cli.test.ts >= 1
    - grep -c "Usage: prefect" src/cli.test.ts equals 0
    - grep -c "\\.config/prefect" src/cli.test.ts >= 1 (config-dir path assertions PRESERVED — out of scope)
    - grep -c "legate_session_command" src/session-command.test.ts >= 1
    - `npm test` exits 0 — all tests pass, including the Plan 01 deprecation tests (now GREEN)
  </acceptance_criteria>
  <done>All test files migrated to LEGATE_* env vars and legate brand strings; Plan 01 deprecation tests preserved verbatim and now GREEN; config-dir path assertions in cli.test.ts preserved; `npm test` exits 0.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| process env → MCP server | Untrusted env vars (LEGATE_*, PREFECT_*, OPENCODE_*) read at module load and at function call time |
| stderr → MCP host (Claude Code) | Deprecation warnings cross to Claude Code's MCP log stream |
| filesystem → CLI | `.mcp.json` reads/writes; ~/.claude/commands/*.md installs |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-05 | Information Disclosure | console.error deprecation warnings could leak secret values | mitigate | All deprecation warning code paths in auth.ts, config.ts, autostart.ts, sessions.ts log env var NAMES only (per 05-PATTERNS.md target patterns). Acceptance criteria check warning text contains var name strings; no acceptance criterion permits value logging. |
| T-05-06 | Tampering | env var fallback chain ordering could be reversed by accident, causing PREFECT_* to win over LEGATE_* | mitigate | Plan 01 includes precedence tests (LEGATE_* set + PREFECT_* set → no warning) which would FAIL if Task 1 inverts the ?? order. Task 2 acceptance also requires `npm test` to exit 0 — covers regression detection. |
| T-05-07 | Spoofing | Renaming binary `prefect-mcp` → `legate-mcp` while old binary still on PATH could allow user to invoke wrong code path | accept | Per REQUIREMENTS.md "Out of Scope": no alias/shim provided; user reinstalls package. Migration note in README (Plan 03) is the documented mitigation. |
| T-05-08 | Tampering | .mcp.json write in cli.ts init subcommand could write wrong key (prefect instead of legate) | mitigate | Acceptance criterion `grep -c "mcpServers.*legate" src/cli.ts >= 1` AND `grep -c "PREFECT_ENTRY" src/cli.ts equals 0` catches stale key/variable. cli.test.ts assertions (Task 2) verify behavior at test time. |
| T-05-09 | Denial of Service | Replacing the OPENCODE_ fallback chain rather than extending it could break users still on OPENCODE_* | mitigate | Acceptance criteria explicitly require `grep -c "OPENCODE_SERVER_PASSWORD" src/auth.ts >= 1` and `grep -c "OPENCODE_DEFAULT_PROJECT" src/config.ts >= 1` to confirm the OPENCODE_ tier is preserved. |
| T-05-10 | Information Disclosure | SESSIONS_DIR rename would corrupt existing sessions.json | mitigate | Acceptance criterion `grep "join(homedir" src/sessions.ts contains 'prefect'` ensures the path string remains `~/.config/prefect/`. Same for src/registry.ts REGISTRY_DIR. Config dir explicitly out of scope per REQUIREMENTS.md. |
| T-05-11 | Repudiation | one-time-warn guard may mask repeated misuse | accept | Intentional UX (RENAME-04 requirement). Solo dev project. |
</threat_model>

<verification>
- `npm run build` exits 0 with no TypeScript errors
- `npm test` exits 0 — all tests pass including the Plan 01 deprecation tests
- `grep -rn "prefect_" src/*.ts | grep -v ".test.ts" | grep -v "OPENCODE\\|PREFECT_" | grep -v "//\\|/\\*\\|\\*"` returns nothing (no production code references the old tool name prefix)
- `grep -rn "\\[Prefect\\]" src/*.ts` returns nothing
- `grep -n "homedir" src/sessions.ts src/registry.ts` shows both files still resolve to `~/.config/prefect/`
- Build artifact `build/cli.js` and `build/index.js` exist and are 755 chmod (per package.json build script)
</verification>

<success_criteria>
- The src/{auth,config,autostart,sessions,cli,registry,handlers}.ts portion of RENAME-04 satisfied (env var soft migration complete)
- `npm test` is fully green (Plan 01's deprecation tests now GREEN; pre-existing tests migrated to LEGATE_*)
- `npm run build` succeeds
- Three-tier env var chain preserved for vars with existing OPENCODE_ fallback (SERVER_PASSWORD, SERVER_USERNAME, DEFAULT_PROJECT)
- Two-tier env var chain implemented for vars without OPENCODE_ fallback (AUTOSTART_TIMEOUT_MS, SESSION_TTL_MS)
- Config directory paths (~/.config/prefect/) unchanged in registry.ts and sessions.ts
</success_criteria>

<output>
After completion, create `.planning/phases/05-rename/05-02b-SUMMARY.md` documenting:
- Final `grep -c "prefect"` and `grep -c "PREFECT"` counts in each modified source file (production: 0; tests where deprecation tests intentionally reference PREFECT_*: small positive number)
- `npm test` final output snippet showing all tests passing
- Confirmation that SESSIONS_DIR / REGISTRY_DIR strings still contain 'prefect' (verbatim grep output)
- List of exported functions added to autostart.ts and sessions.ts for test access
</output>
