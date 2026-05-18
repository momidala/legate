# Phase 5: Rename - Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 15 (9 source, 6 test) + 6 doc files + 1 new file
**Analogs found:** 15 / 15 (all files have direct analogs in same codebase; this is a rename, not new code)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `package.json` | config | — | `package.json` itself (self-edit) | exact |
| `src/index.ts` | MCP server / config | request-response | `src/index.ts` itself (self-edit) | exact |
| `src/auth.ts` | utility / env-reader | request-response | `src/config.ts` (same deprecation chain pattern) | exact |
| `src/config.ts` | utility / env-reader | request-response | `src/auth.ts` (same deprecation chain pattern) | exact |
| `src/autostart.ts` | service / env-reader | request-response | `src/config.ts` (two-tier variant) | role-match |
| `src/sessions.ts` | model / env-reader | CRUD | `src/autostart.ts` (inline env read, no OPENCODE_ fallback) | role-match |
| `src/cli.ts` | CLI process | request-response | `src/cli.ts` itself (self-edit) | exact |
| `src/registry.ts` | model | CRUD | `src/registry.ts` itself (self-edit) | exact |
| `src/handlers.ts` | utility | request-response | `src/handlers.ts` itself (comments only) | exact |
| `src/auth.test.ts` | test | — | `src/auth.test.ts` itself (self-edit) | exact |
| `src/autostart.test.ts` | test | — | `src/autostart.test.ts` itself (self-edit) | exact |
| `src/sessions.test.ts` | test | — | `src/sessions.test.ts` itself (self-edit) | exact |
| `src/cli.test.ts` | test | — | `src/cli.test.ts` itself (self-edit) | exact |
| `src/registry.test.ts` | test | — | `src/registry.test.ts` itself (self-edit) | exact |
| `src/session-command.test.ts` | test | — | `src/session-command.test.ts` itself (comments only) | exact |
| `README.md` | documentation | — | `README.md` itself (self-edit) | exact |
| `EXAMPLE_CLAUDE.md` | documentation | — | `EXAMPLE_CLAUDE.md` itself (self-edit) | exact |
| `AGENTS.md` | documentation | — | `AGENTS.md` itself (self-edit) | exact |
| `examples/test-task.md` | documentation | — | `examples/test-task.md` itself (self-edit) | exact |
| `examples/uat-v2.md` | documentation | — | `examples/uat-v2.md` itself (self-edit) | exact |
| `CLAUDE.md` (project) | documentation | — | `CLAUDE.md` itself (self-edit) | exact |
| `.gitattributes` | config | — | No analog (new file) | none |

---

## Pattern Assignments

### `package.json` (config, —)

**Change type:** 3 string replacements — `name`, two `bin` keys.

**Current state** (`package.json` lines 2 and 29-32):
```json
{
  "name": "@momidala/prefect",
  "bin": {
    "prefect": "./build/cli.js",
    "prefect-mcp": "./build/index.js"
  }
}
```

**Target state:**
```json
{
  "name": "@momidala/legate",
  "bin": {
    "legate": "./build/cli.js",
    "legate-mcp": "./build/index.js"
  }
}
```

**No other fields change** — `version`, `description`, `repository`, `scripts`, `dependencies`, `devDependencies` are all unchanged.

---

### `src/index.ts` (MCP server, request-response)

**Three distinct change types:**

**1. McpServer name** (line 94):
```typescript
// CURRENT:
const server = new McpServer({ name: 'prefect', version: packageVersion });

// TARGET:
const server = new McpServer({ name: 'legate', version: packageVersion });
```

**2. BASE_URL env var chain** (lines 15-23) — two-tier, no PREFECT_ middle tier because PREFECT_SERVER_URL itself was the primary. Add PREFECT_SERVER_URL as new deprecated middle tier:
```typescript
// CURRENT:
const BASE_URL =
  process.env.PREFECT_SERVER_URL ??
  (() => {
    const old = process.env.OPENCODE_URL;
    if (old) console.error('[Prefect] OPENCODE_URL is deprecated, use PREFECT_SERVER_URL');
    return old;
  })() ??
  'http://localhost:4096';

// TARGET (three-tier):
let warnedServerUrl = false;
const BASE_URL =
  process.env.LEGATE_SERVER_URL ??
  (() => {
    const old = process.env.PREFECT_SERVER_URL;
    if (old && !warnedServerUrl) {
      console.error('[Legate] PREFECT_SERVER_URL is deprecated, use LEGATE_SERVER_URL');
      warnedServerUrl = true;
    }
    return old;
  })() ??
  (() => {
    const old = process.env.OPENCODE_URL;
    if (old) console.error('[Legate] OPENCODE_URL is deprecated, use LEGATE_SERVER_URL');
    return old;
  })() ??
  'http://localhost:4096';
```

**3. PREFECT_TIMEOUT_MS** (line 24) — two-tier (no OPENCODE_ fallback existed):
```typescript
// CURRENT:
const TIMEOUT_MS = parseInt(process.env.PREFECT_TIMEOUT_MS ?? '', 10) || 120_000;

// TARGET:
let warnedTimeoutMs = false;
function resolveTimeoutMs(): number {
  const legateVal = process.env.LEGATE_TIMEOUT_MS;
  if (legateVal) return parseInt(legateVal, 10) || 120_000;
  const old = process.env.PREFECT_TIMEOUT_MS;
  if (old && !warnedTimeoutMs) {
    console.error('[Legate] PREFECT_TIMEOUT_MS is deprecated, use LEGATE_TIMEOUT_MS');
    warnedTimeoutMs = true;
  }
  return parseInt(old ?? '', 10) || 120_000;
}
const TIMEOUT_MS = resolveTimeoutMs();
```

**4. 40 tool registrations** — all `prefect_` prefix becomes `legate_`. The registration pattern is consistent across all 40 tools:
```typescript
// CURRENT pattern:
server.registerTool('prefect_create_session', { ... }, async (args) => { ... });

// TARGET pattern:
server.registerTool('legate_create_session', { ... }, async (args) => { ... });
```

**5. User-facing strings inside tool descriptions** — anywhere `PREFECT_SERVER_URL`, `PREFECT_DEFAULT_PROJECT`, `PREFECT_TIMEOUT_MS` appear in `.describe(...)` calls, update to `LEGATE_*`. Cross-tool references like `Consider using prefect_session_rename` become `Consider using legate_session_rename` (line 734 example).

**Verification grep after changes:**
```bash
grep -c "prefect" src/index.ts  # should be 0
grep -c "PREFECT" src/index.ts  # should be 0
```

---

### `src/auth.ts` (utility, request-response)

**Analog for the deprecation pattern:** `src/auth.ts` is itself the template — the OPENCODE_ → PREFECT_ pattern already there is being extended to PREFECT_ → LEGATE_.

**Current state** (`src/auth.ts` lines 5-27):
```typescript
let warnedPassword = false;
let warnedUsername = false;

export function buildAuthHeader(): Record<string, string> {
  const password =
    process.env.PREFECT_SERVER_PASSWORD ??
    (() => {
      const old = process.env.OPENCODE_SERVER_PASSWORD;
      if (old && !warnedPassword) {
        console.error('[Prefect] OPENCODE_SERVER_PASSWORD is deprecated, use PREFECT_SERVER_PASSWORD');
        warnedPassword = true;
      }
      return old;
    })();
  // ...
  const username =
    process.env.PREFECT_SERVER_USERNAME ??
    (() => {
      const old = process.env.OPENCODE_SERVER_USERNAME;
      if (old && !warnedUsername) {
        console.error('[Prefect] OPENCODE_SERVER_USERNAME is deprecated, use PREFECT_SERVER_USERNAME');
        warnedUsername = true;
      }
      return old;
    })() ??
    'opencode';
```

**Target state** — insert new PREFECT_ deprecated tier between LEGATE_ and OPENCODE_. New warn flags (`warnedPrefectPassword`, `warnedPrefectUsername`) are added alongside the existing ones:
```typescript
let warnedPassword = false;     // existing — OPENCODE_ tier
let warnedUsername = false;     // existing — OPENCODE_ tier
let warnedPrefectPassword = false;   // NEW — PREFECT_ tier
let warnedPrefectUsername = false;   // NEW — PREFECT_ tier

export function buildAuthHeader(): Record<string, string> {
  const password =
    process.env.LEGATE_SERVER_PASSWORD ??          // NEW primary
    (() => {
      const old = process.env.PREFECT_SERVER_PASSWORD;  // deprecated tier 1
      if (old && !warnedPrefectPassword) {
        console.error('[Legate] PREFECT_SERVER_PASSWORD is deprecated, use LEGATE_SERVER_PASSWORD');
        warnedPrefectPassword = true;
      }
      return old;
    })() ??
    (() => {
      const old = process.env.OPENCODE_SERVER_PASSWORD;  // deprecated tier 2 (preserved)
      if (old && !warnedPassword) {
        console.error('[Legate] OPENCODE_SERVER_PASSWORD is deprecated, use LEGATE_SERVER_PASSWORD');
        warnedPassword = true;
      }
      return old;
    })();
  // ...
  const username =
    process.env.LEGATE_SERVER_USERNAME ??          // NEW primary
    (() => {
      const old = process.env.PREFECT_SERVER_USERNAME;  // deprecated tier 1
      if (old && !warnedPrefectUsername) {
        console.error('[Legate] PREFECT_SERVER_USERNAME is deprecated, use LEGATE_SERVER_USERNAME');
        warnedPrefectUsername = true;
      }
      return old;
    })() ??
    (() => {
      const old = process.env.OPENCODE_SERVER_USERNAME;  // deprecated tier 2 (preserved)
      if (old && !warnedUsername) {
        console.error('[Legate] OPENCODE_SERVER_USERNAME is deprecated, use LEGATE_SERVER_USERNAME');
        warnedUsername = true;
      }
      return old;
    })() ??
    'opencode';
```

**Critical: `_resetWarnFlags()` must also reset new flags** (line 68-71):
```typescript
// CURRENT:
export function _resetWarnFlags(): void {
  warnedPassword = false;
  warnedUsername = false;
}

// TARGET:
export function _resetWarnFlags(): void {
  warnedPassword = false;
  warnedUsername = false;
  warnedPrefectPassword = false;   // NEW
  warnedPrefectUsername = false;   // NEW
}
```

**authFetch console strings** (lines 60, 63) — `[Prefect]` becomes `[Legate]`.

---

### `src/config.ts` (utility, request-response)

**Analog:** `src/auth.ts` — same module-level bool flag + IIFE deprecation pattern, but for one variable.

**Current state** (`src/config.ts` lines 6-28):
```typescript
let warnedDefaultProject = false;

export function resolveDirectory(perToolParam: string | undefined): string | undefined {
  return (
    perToolParam ??
    process.env.PREFECT_DEFAULT_PROJECT ??
    (() => {
      const old = process.env.OPENCODE_DEFAULT_PROJECT;
      if (old && !warnedDefaultProject) {
        console.error('[Prefect] OPENCODE_DEFAULT_PROJECT is deprecated, use PREFECT_DEFAULT_PROJECT');
        warnedDefaultProject = true;
      }
      return old;
    })()
  );
}
```

**Target state** — insert new PREFECT_ tier, add `warnedPrefectDefaultProject` flag:
```typescript
let warnedDefaultProject = false;         // existing — OPENCODE_ tier
let warnedPrefectDefaultProject = false;  // NEW — PREFECT_ tier

export function resolveDirectory(perToolParam: string | undefined): string | undefined {
  return (
    perToolParam ??
    process.env.LEGATE_DEFAULT_PROJECT ??        // NEW primary
    (() => {
      const old = process.env.PREFECT_DEFAULT_PROJECT;   // deprecated tier 1
      if (old && !warnedPrefectDefaultProject) {
        console.error('[Legate] PREFECT_DEFAULT_PROJECT is deprecated, use LEGATE_DEFAULT_PROJECT');
        warnedPrefectDefaultProject = true;
      }
      return old;
    })() ??
    (() => {
      const old = process.env.OPENCODE_DEFAULT_PROJECT;  // deprecated tier 2 (preserved)
      if (old && !warnedDefaultProject) {
        console.error('[Legate] OPENCODE_DEFAULT_PROJECT is deprecated, use LEGATE_DEFAULT_PROJECT');
        warnedDefaultProject = true;
      }
      return old;
    })()
  );
}
```

---

### `src/autostart.ts` (service, request-response)

**Analog:** `src/config.ts` two-tier pattern (no OPENCODE_ fallback existed for this variable).

**Current state** (`src/autostart.ts` lines 9-11):
```typescript
function autostartTimeoutMs(): number {
  return parseInt(process.env.PREFECT_AUTOSTART_TIMEOUT_MS ?? '', 10) || 30_000;
}
```

**Target state** — new module-level flag at top of file, two-tier function:
```typescript
// Add at top of file, after imports:
let warnedAutostartTimeout = false;

function autostartTimeoutMs(): number {
  const legateVal = process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
  if (legateVal) return parseInt(legateVal, 10) || 30_000;
  const old = process.env.PREFECT_AUTOSTART_TIMEOUT_MS;
  if (old && !warnedAutostartTimeout) {
    console.error('[Legate] PREFECT_AUTOSTART_TIMEOUT_MS is deprecated, use LEGATE_AUTOSTART_TIMEOUT_MS');
    warnedAutostartTimeout = true;
  }
  return parseInt(old ?? '', 10) || 30_000;
}
```

**Other string changes in autostart.ts** — all `[Prefect]` in `console.error` calls become `[Legate]` (lines 65, 76, 87).

---

### `src/sessions.ts` (model, CRUD)

**Analog:** `src/autostart.ts` two-tier pattern (no OPENCODE_ fallback existed).

**Current state** (`src/sessions.ts` line 33):
```typescript
const ttlMs = Number(process.env.PREFECT_SESSION_TTL_MS ?? DEFAULT_SESSION_TTL_MS);
```

**Target state** — add module-level flag before `readSessionMap`, two-tier read inline:
```typescript
// Add at module level (before readSessionMap):
let warnedSessionTtl = false;

// Inside readSessionMap, replace line 33:
const legateVal = process.env.LEGATE_SESSION_TTL_MS;
const prefectVal = process.env.PREFECT_SESSION_TTL_MS;
if (prefectVal && !legateVal && !warnedSessionTtl) {
  console.error('[Legate] PREFECT_SESSION_TTL_MS is deprecated, use LEGATE_SESSION_TTL_MS');
  warnedSessionTtl = true;
}
const ttlMs = Number(legateVal ?? prefectVal ?? DEFAULT_SESSION_TTL_MS);
```

**Other string changes in sessions.ts** — `[Prefect]` on line 48 becomes `[Legate]`. The capacity error message on line 154 references `prefect_session_delete` — update to `legate_session_delete`.

**SESSIONS_DIR and SESSIONS_PATH** (lines 21-22) — **do not change**. These remain `~/.config/prefect/` per explicit out-of-scope requirement.

---

### `src/cli.ts` (CLI process, request-response)

**Current state — key locations:**

**PREFECT_ENTRY constant** (lines 20-30):
```typescript
const PREFECT_ENTRY = isGlobal
  ? { type: 'stdio', command: 'prefect-mcp', args: [] } as const
  : { type: 'stdio', command: 'node', args: [resolve(__dirname, 'index.js')] } as const;
```

**Target state:**
```typescript
const LEGATE_ENTRY = isGlobal
  ? { type: 'stdio', command: 'legate-mcp', args: [] } as const
  : { type: 'stdio', command: 'node', args: [resolve(__dirname, 'index.js')] } as const;
```

**PREFECT_UPDATE_COMMAND_CONTENT** (lines 35-44) — rename the command name in content (`/legate-update`), the package ref (`@momidala/legate`), and the variable name itself.

**usageAndExit()** (lines 81-92) — all `prefect` in message strings become `legate`:
```typescript
// CURRENT:
'Usage: prefect <subcommand> [options]\n\n' +
'  init [--force]                          Write .mcp.json for this project\n' +
'  install-command                         Install /prefect-update Claude command...\n' +
'  uninstall-command                       Remove /prefect-update Claude command...\n'

// TARGET:
'Usage: legate <subcommand> [options]\n\n' +
'  init [--force]                          Write .mcp.json for this project\n' +
'  install-command                         Install /legate-update Claude command...\n' +
'  uninstall-command                       Remove /legate-update Claude command...\n'
```

**handleInstallCommand / handleUninstallCommand** (lines 147-181) — `prefect-update.md` becomes `legate-update.md`:
```typescript
// CURRENT (line 152):
const dest = join(destDir, 'prefect-update.md');

// TARGET:
const dest = join(destDir, 'legate-update.md');
```

**init subcommand** (lines 206-248) — `prefect` key becomes `legate` throughout:
```typescript
// CURRENT (line 216):
const config: McpJson = { mcpServers: { prefect: PREFECT_ENTRY } };

// TARGET:
const config: McpJson = { mcpServers: { legate: LEGATE_ENTRY } };

// CURRENT (lines 234, 236, 242, 243, 245):
if ('prefect' in servers && !force) { ... }
// Error message: 'Error: .mcp.json already contains a prefect entry...'
servers.prefect = PREFECT_ENTRY;
// console.error: 'Updated prefect entry...' / 'Added prefect entry...'

// TARGET:
if ('legate' in servers && !force) { ... }
// Error message: 'Error: .mcp.json already contains a legate entry...'
servers.legate = LEGATE_ENTRY;
// console.error: 'Updated legate entry...' / 'Added legate entry...'
```

**printOnboardingIfNoServers()** (lines 183-193) — `prefect add-server` becomes `legate add-server`.

**handleAddServer / handleRemoveServer** (lines 112, 129) — usage message strings.

---

### `src/registry.ts` (model, CRUD)

**Single change** (line 75):
```typescript
// CURRENT:
console.log('No servers registered. Use: prefect add-server <name> <host> <port> <model>');

// TARGET:
console.log('No servers registered. Use: legate add-server <name> <host> <port> <model>');
```

**REGISTRY_DIR and REGISTRY_PATH** (lines 18-19) — **do not change**. These remain `~/.config/prefect/` per explicit out-of-scope requirement.

---

### `src/handlers.ts` (utility, request-response)

**Comments only** — no runtime `prefect_` strings. Update JSDoc and inline comment references:
- `prefect_*` tool names in JSDoc/comments → `legate_*`
- `[Prefect]` log prefixes in any console calls → `[Legate]`

No structural changes required.

---

## Test File Pattern Assignments

### `src/auth.test.ts` (test)

**Pattern:** Env var save/restore pattern already established in the file (lines 17-29).

**Changes required:**
1. All `process.env.PREFECT_SERVER_PASSWORD` → `process.env.LEGATE_SERVER_PASSWORD`
2. All `process.env.PREFECT_SERVER_USERNAME` → `process.env.LEGATE_SERVER_USERNAME`
3. All `delete process.env.PREFECT_SERVER_PASSWORD` → `delete process.env.LEGATE_SERVER_PASSWORD`
4. All `delete process.env.PREFECT_SERVER_USERNAME` → `delete process.env.LEGATE_SERVER_USERNAME`

**New tests to add** (RENAME-04 requirement, per Wave 0 Gaps in RESEARCH.md):
```typescript
// Pattern: mirror existing OPENCODE_ deprecation test structure (if any), or create new:
test('buildAuthHeader warns once when PREFECT_SERVER_PASSWORD is set (deprecated)', () => {
  delete process.env.LEGATE_SERVER_PASSWORD;
  process.env.PREFECT_SERVER_PASSWORD = 'old-secret';
  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => warnings.push(String(args[0]));
  try {
    buildAuthHeader();
    buildAuthHeader(); // second call — should NOT warn again
    assert.equal(warnings.filter(w => w.includes('PREFECT_SERVER_PASSWORD')).length, 1);
  } finally {
    console.error = origError;
    delete process.env.PREFECT_SERVER_PASSWORD;
  }
});
```

---

### `src/sessions.test.ts` (test)

**Changes required:**
1. Temp dir prefix `prefect-sessions-` (line 9) → `legate-sessions-`
2. `process.env.PREFECT_SESSION_TTL_MS` (lines 171, 182, 187, 188, 195, 203, 207, 208) → `process.env.LEGATE_SESSION_TTL_MS`

**New test to add** (Wave 0 Gap):
```typescript
test('readSessionMap warns once when PREFECT_SESSION_TTL_MS is set', () => {
  // Set PREFECT_ but not LEGATE_ to trigger deprecation warning
  delete process.env.LEGATE_SESSION_TTL_MS;
  process.env.PREFECT_SESSION_TTL_MS = '999';
  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => warnings.push(String(args[0]));
  try {
    readSessionMap(tmpPath);
    readSessionMap(tmpPath); // second call — should NOT warn again
    assert.equal(warnings.filter(w => w.includes('PREFECT_SESSION_TTL_MS')).length, 1);
  } finally {
    console.error = origError;
    delete process.env.PREFECT_SESSION_TTL_MS;
  }
});
```

---

### `src/autostart.test.ts` (test)

**Changes required:**
1. `process.env.PREFECT_AUTOSTART_TIMEOUT_MS` (lines 65, 66, 75, 76) → `process.env.LEGATE_AUTOSTART_TIMEOUT_MS`
2. `process.env.PREFECT_SERVER_PASSWORD` (lines 81, 82, 95, 96) → `process.env.LEGATE_SERVER_PASSWORD`

**New test to add** (Wave 0 Gap):
```typescript
test('autostartTimeoutMs warns once when PREFECT_AUTOSTART_TIMEOUT_MS is set', () => {
  delete process.env.LEGATE_AUTOSTART_TIMEOUT_MS;
  process.env.PREFECT_AUTOSTART_TIMEOUT_MS = '5000';
  // ... same console.error capture pattern as auth.test.ts new test above
});
```

---

### `src/cli.test.ts` (test)

**Changes required:**
1. Temp dir prefix `prefect-cli-` (line 14) → `legate-cli-`
2. All `cfg.mcpServers.prefect` (lines 34-38, 53-54, 65, 72, 78, 82-83, 90-91, 108-109) → `cfg.mcpServers.legate`
3. `~/.config/prefect/servers.json` path strings (lines 136-137, 187) — **do not change** (config dir is out of scope)
4. Usage message assertions (line 121) — `Usage: prefect <subcommand>` → `Usage: legate <subcommand>`
5. `add-server` usage message assertion (line 152) — `Usage: prefect add-server` → `Usage: legate add-server`

---

### `src/registry.test.ts` (test)

**Changes required:**
1. Temp dir prefix `prefect-registry-` (line 12) → `legate-registry-`

---

### `src/session-command.test.ts` (test)

**Changes required:**
1. Comment on line 5: `prefect_session_command` → `legate_session_command`

---

## Documentation Pattern Assignments

### `README.md`, `EXAMPLE_CLAUDE.md`, `AGENTS.md`, `examples/test-task.md`, `examples/uat-v2.md`, `CLAUDE.md`

**Three distinct replacement rules (from RESEARCH.md Anti-Patterns section):**

| Pattern | Replacement | Applies to |
|---------|-------------|------------|
| `prefect_` (tool name prefix, lowercase) | `legate_` | All inline code examples |
| `PREFECT_` (env var prefix, uppercase) | `LEGATE_` | All env var references |
| `Prefect` (capitalized brand name) | `Legate` | All prose references |
| `prefect` (binary/command name, lowercase) | `legate` | All CLI command examples |
| `prefect-mcp` (binary name with hyphen) | `legate-mcp` | All binary references |
| `@momidala/prefect` (npm package name) | `@momidala/legate` | All npm install commands |
| `prefect-update` (slash command name) | `legate-update` | All `/prefect-update` references |

**Verification after doc changes:**
```bash
grep -c "prefect" README.md          # should be 0 (except migration note which explicitly references old name)
grep -c "prefect" EXAMPLE_CLAUDE.md  # should be 0
grep -c "prefect" AGENTS.md          # should be 0
grep -c "prefect" examples/test-task.md   # should be 0
grep -c "examples/uat-v2.md" examples/uat-v2.md  # irrelevant; check:
grep -c "prefect" examples/uat-v2.md # should be 0
```

**Migration note exception** — README.md must include a migration section that explicitly references the old `@momidala/prefect` package and `PREFECT_*` vars as the things being migrated FROM. These intentional references are correct and should not be removed.

---

## Shared Patterns

### The Module-Level Bool Flag + IIFE Deprecation Chain

**Source:** `src/auth.ts` (the primary codebase example), `src/config.ts` (simpler variant)
**Apply to:** `src/auth.ts`, `src/config.ts`, `src/autostart.ts`, `src/sessions.ts`, `src/index.ts`

The pattern has two variants:

**Three-tier variant** (for vars that already had OPENCODE_ fallback):
```typescript
// src/auth.ts lines 5-6 — module-level guards, one per deprecated tier
let warnedOldTier = false;         // guards the oldest tier (OPENCODE_)
let warnedMiddleTier = false;      // NEW guard for PREFECT_ tier

export function readEnvVar(): string | undefined {
  return (
    process.env.LEGATE_VAR ??               // tier 0: preferred
    (() => {
      const old = process.env.PREFECT_VAR;
      if (old && !warnedMiddleTier) {
        console.error('[Legate] PREFECT_VAR is deprecated, use LEGATE_VAR');
        warnedMiddleTier = true;
      }
      return old;
    })() ??                                  // tier 1: deprecated, warn
    (() => {
      const old = process.env.OPENCODE_VAR;
      if (old && !warnedOldTier) {
        console.error('[Legate] OPENCODE_VAR is deprecated, use LEGATE_VAR');
        warnedOldTier = true;
      }
      return old;
    })()                                     // tier 2: oldest deprecated, warn
  );
}
```

**Two-tier variant** (for vars with no OPENCODE_ fallback — `TIMEOUT_MS`, `AUTOSTART_TIMEOUT_MS`, `SESSION_TTL_MS`):
```typescript
// src/autostart.ts pattern (to replicate)
let warnedVar = false;

function readEnvVar(): number {
  const legateVal = process.env.LEGATE_VAR;
  if (legateVal) return parseInt(legateVal, 10) || DEFAULT;
  const old = process.env.PREFECT_VAR;
  if (old && !warnedVar) {
    console.error('[Legate] PREFECT_VAR is deprecated, use LEGATE_VAR');
    warnedVar = true;
  }
  return parseInt(old ?? '', 10) || DEFAULT;
}
```

### Console Error Prefix

**Source:** All source files — consistent pattern.
**Apply to:** All source files with `console.error` calls.

```typescript
// CURRENT:
console.error('[Prefect] ...');

// TARGET:
console.error('[Legate] ...');
```

### Test Env Var Save/Restore Pattern

**Source:** `src/auth.test.ts` lines 17-29
**Apply to:** All test files that set env vars

```typescript
// Pattern to follow when updating test env var names:
test('description', () => {
  const prev = process.env.LEGATE_VAR;   // was: process.env.PREFECT_VAR
  process.env.LEGATE_VAR = 'test-value';
  try {
    // ... test body
  } finally {
    if (prev === undefined) delete process.env.LEGATE_VAR;
    else process.env.LEGATE_VAR = prev;
  }
});
```

### New Deprecation Warning Tests

**Source:** No existing model in codebase — create new tests following the `beforeEach(() => _resetWarnFlags())` + `console.error` capture pattern.
**Apply to:** `src/auth.test.ts`, `src/sessions.test.ts`, `src/autostart.test.ts`

```typescript
// Template for deprecation warning test (no existing model; derive from test structure):
test('warns once when PREFECT_X is set (deprecated)', () => {
  delete process.env.LEGATE_X;
  process.env.PREFECT_X = 'old-value';
  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => warnings.push(String(args[0]));
  try {
    callFunctionThatReadsVar();
    callFunctionThatReadsVar();  // second call — must NOT produce second warning
    assert.equal(warnings.filter(w => w.includes('PREFECT_X')).length, 1);
  } finally {
    console.error = origError;
    delete process.env.PREFECT_X;
  }
});
```

---

## New File

### `.gitattributes` (config, —)

**No analog in codebase** — this is a new file.

**Content (single line):**
```
*.ts linguist-language=TypeScript
```

**Location:** Project root (`/mnt/c/Users/larry/Documents/repos/momidala/prefect/.gitattributes`)

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.gitattributes` | config | — | No existing `.gitattributes` in the codebase; standard GitHub Linguist format |

---

## Explicitly Out of Scope (Do Not Touch)

| Item | Current Value | Reason |
|------|---------------|--------|
| `REGISTRY_DIR` in `src/registry.ts` line 18 | `join(homedir(), '.config', 'prefect')` | Changing breaks existing `servers.json` |
| `SESSIONS_DIR` in `src/sessions.ts` line 21 | `join(homedir(), '.config', 'prefect')` | Changing breaks existing `sessions.json` |
| `SESSIONS_PATH` / `REGISTRY_PATH` exports | derived from above | Same |
| `cli.test.ts` path assertions for `~/.config/prefect/` | lines 136-137, 187 | Config dir stays unchanged |

---

## Metadata

**Analog search scope:** `/mnt/c/Users/larry/Documents/repos/momidala/prefect/src/`
**Files scanned:** 9 source files, 6 test files
**Key insight:** This is a same-codebase self-rename. Every file is its own closest analog. The only true "pattern extraction" is identifying the existing deprecation chain structure in `src/auth.ts` and `src/config.ts` that must be replicated in `src/autostart.ts` and `src/sessions.ts` (which currently have no deprecation chain at all — just direct `process.env` reads).
**Pattern extraction date:** 2026-05-17
