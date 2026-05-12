# Phase 2: Self-Update - Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 4
**Analogs found:** 3 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli.ts` (modified) | utility/CLI | request-response | `src/cli.ts` itself (existing subcommands) | exact |
| `src/cli.test.ts` (modified) | test | request-response | `src/cli.test.ts` itself (existing test cases) | exact |
| `package.json` (modified) | config | N/A | `package.json` itself (existing `scripts` field) | exact |
| `commands/prefect-update.md` (new, inline or file) | config/template | N/A | `~/.claude/commands/` (empty — no existing analog) | no analog |

---

## Pattern Assignments

### `src/cli.ts` — new `install-command` and `uninstall-command` cases

**Analog:** `src/cli.ts` existing `init` case and `handleAddServer` / `handleRemoveServer` handlers

**Imports pattern** (lines 1-5 of `src/cli.ts`):
```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
```
New subcommands will also need `mkdirSync`, `rmSync`, `cpSync` (or `readFileSync`/`writeFileSync`) and `os.homedir()`:
```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
```

**Global-install guard pattern** (lines 15 of `src/cli.ts`):
```typescript
const isGlobal = __dirname.replace(/\\/g, '/').includes('/node_modules/');
```
New subcommands check `isGlobal` at the top of the handler and exit 0 silently if false (D-05):
```typescript
function handleInstallCommand(): never {
  if (!isGlobal) process.exit(0);  // silent skip for local installs
  // ...
}
```

**Core handler pattern — simple subcommand with try/catch** (lines 110-124 of `src/cli.ts`):
```typescript
function handleRemoveServer(handlerArgs: string[]): never {
  const [name] = handlerArgs;
  if (!name) {
    console.error('Usage: prefect remove-server <name>');
    process.exit(1);
  }
  try {
    removeServer(name);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
  try { updateClaudemdWorkers(process.cwd()); } catch (e) { console.error(`Warning: could not update CLAUDE.md: ${(e as Error).message}`); }
  process.exit(0);
}
```
New `handleInstallCommand` follows the same shape with a warn-and-exit-0 catch block (D-07):
```typescript
function handleInstallCommand(): never {
  if (!isGlobal) process.exit(0);
  const dest = join(homedir(), '.claude', 'commands', 'prefect-update.md');
  const destDir = join(homedir(), '.claude', 'commands');
  try {
    mkdirSync(destDir, { recursive: true });
    writeFileSync(dest, PREFECT_UPDATE_COMMAND_CONTENT);
  } catch (err) {
    console.error(`Warning: prefect-update command not installed — ${(err as Error).message}`);
    process.exit(0);
  }
  process.exit(0);
}
```

**Core handler pattern — uninstall (silent on failure)** (D-08):
```typescript
function handleUninstallCommand(): never {
  if (!isGlobal) process.exit(0);
  const dest = join(homedir(), '.claude', 'commands', 'prefect-update.md');
  try {
    if (existsSync(dest)) rmSync(dest);
  } catch {
    // D-08: uninstall failures are non-fatal — exit 0 silently
  }
  process.exit(0);
}
```

**Switch-case slot pattern** (lines 153-213 of `src/cli.ts`):
```typescript
switch (subcommand) {
  case 'init': { /* ... */ }
  case 'add-server':
    handleAddServer(args.slice(1));
    break;
  // NEW: add before `default`:
  case 'install-command':
    handleInstallCommand();
    break;
  case 'uninstall-command':
    handleUninstallCommand();
    break;
  default:
    usageAndExit();
}
```

**Usage string pattern** (lines 66-77 of `src/cli.ts`):
```typescript
function usageAndExit(): never {
  console.error(
    'Usage: prefect <subcommand> [options]\n\n' +
    'Subcommands:\n' +
    '  init [--force]                          Write .mcp.json for this project\n' +
    // Add:
    '  install-command                         Install /prefect-update Claude command\n' +
    '  uninstall-command                       Remove /prefect-update Claude command\n' +
    '  version                                 Print the installed version',
  );
  process.exit(1);
}
```

**Version read pattern** (lines 148-151 / 206-210 of `src/cli.ts`) — used after update to display new version:
```typescript
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
console.log(version);
```

---

### `src/cli.test.ts` — new tests for `install-command` and `uninstall-command`

**Analog:** `src/cli.test.ts` existing test cases (lines 130-175 for `add-server`, lines 183-216 for `remove-server`)

**Test harness pattern** (lines 1-25 of `src/cli.test.ts`):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const CLI = resolve(process.cwd(), 'build/cli.js');

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'prefect-cli-'));
}

function runCli(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]):
  { status: number; stdout: string; stderr: string } {
  const res = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}
```

**Test structure pattern — file-system side-effect test** (lines 130-143 of `src/cli.test.ts`):
```typescript
test('add-server creates ~/.config/prefect/servers.json under HOME=tempdir', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3');
    assert.equal(status, 0);
    assert.ok(existsSync(join(dir, '.config', 'prefect', 'servers.json')));
    // assert file contents...
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```
New `install-command` tests follow the same shape — redirect `HOME` so `~/.claude/commands/` resolves inside the temp dir:
```typescript
test('install-command creates prefect-update.md under HOME=tempdir', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status } = runCli(dir, env, 'install-command');
    // NOTE: this test runs cli.js which detects it's NOT a global install
    // (build/cli.js is not under a node_modules path), so it exits 0 silently.
    assert.equal(status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

**Key testing note for `isGlobal`:** The build artifact `build/cli.js` runs from the repo root (not inside `node_modules/`), so `isGlobal` is `false` in tests. Tests for install/uninstall behavior therefore verify:
1. Silent exit-0 when not global (the normal test path).
2. File installation behavior requires either a stub or a test that places `CLI` under a fake `node_modules/` path — or the test mocks the condition via a dedicated env var (see discretion note below).

**Test structure pattern — error/missing-name exits 1** (lines 206-216 of `src/cli.test.ts`):
```typescript
test('remove-server on missing name exits 1 with clear stderr', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'remove-server', 'nope');
    assert.equal(status, 1);
    assert.match(stderr, /no server named 'nope'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

---

### `package.json` — add `postinstall` and `preuninstall` lifecycle scripts

**Analog:** `package.json` existing `scripts` field (lines 22-25 of `package.json`):
```json
"scripts": {
  "build": "tsc && chmod 755 build/index.js build/cli.js",
  "test": "tsc && node --test build/parts.test.js build/cli.test.js ..."
}
```
Add lifecycle hooks (D-01):
```json
"scripts": {
  "build": "tsc && chmod 755 build/index.js build/cli.js",
  "test": "...",
  "postinstall": "prefect install-command",
  "preuninstall": "prefect uninstall-command"
}
```

**`files` field pattern** (lines 10-14 of `package.json`):
```json
"files": [
  "build/",
  "README.md",
  "EXAMPLE_CLAUDE.md"
]
```
If the slash command content is stored as a source file (e.g., `commands/prefect-update.md`) rather than an inline template string, add it to `files`. Per CONTEXT.md specifics, inline template string is preferred — in that case `files` needs no change.

---

### `commands/prefect-update.md` (inline template string — no separate file)

**Analog:** None — no existing slash command files in `~/.claude/commands/` or in the project. See "No Analog Found" section.

**Claude Code slash command format convention:**
- Filename: `prefect-update.md` (hyphens, not underscores — matches Claude Code convention per D-04 discretion)
- Placed at: `~/.claude/commands/prefect-update.md`
- Invoked as: `/prefect-update`
- Format: plain markdown with a bash instruction block

**Inline template pattern (to be embedded in `src/cli.ts`):**
```typescript
const PREFECT_UPDATE_COMMAND_CONTENT = `\
Run this bash command to update the prefect package to the latest version:

\`\`\`bash
npm install -g @momidala/prefect@latest
\`\`\`

After the install completes, run this to confirm the new version:

\`\`\`bash
node -e "const p=require(require('path').join(require('child_process').execSync('npm root -g').toString().trim(),'@momidala/prefect/package.json'));console.log('prefect updated to v'+p.version+'. Restart Claude Code to apply.');"
\`\`\`
`;
```
Note: the exact version-display command is left to planner/implementer to refine per D-03 and D-04 (new version only, format: `prefect updated to vX.Y.Z. Restart Claude Code to apply.`).

---

## Shared Patterns

### Global install detection
**Source:** `src/cli.ts` line 15
**Apply to:** Both `handleInstallCommand` and `handleUninstallCommand`
```typescript
const isGlobal = __dirname.replace(/\\/g, '/').includes('/node_modules/');
```
Check `isGlobal` at the top of each new handler; call `process.exit(0)` immediately if false (no output).

### Error output convention
**Source:** `src/cli.ts` throughout (e.g., lines 87, 105, 119, 193)
**Apply to:** `handleInstallCommand` warn path
```typescript
console.error(`Warning: prefect-update command not installed — ${(err as Error).message}`);
```
- Success messages go to `console.log` (or suppress entirely for lifecycle hooks)
- Error/warning messages go to `console.error`
- Lifecycle hook warnings (D-07) use `Warning:` prefix and exit 0

### Explicit `process.exit` calls
**Source:** `src/cli.ts` — every handler ends with `process.exit(0)` or `process.exit(1)`
**Apply to:** Both new handlers — no implicit returns from `never`-typed functions

### Test cleanup pattern
**Source:** `src/cli.test.ts` — every test uses `try/finally { rmSync(dir, { recursive: true, force: true }) }`
**Apply to:** All new test cases

### HOME override in tests
**Source:** `src/cli.test.ts` lines 118, 133, etc.
**Apply to:** New tests that need to redirect `~/.claude/commands/` to a temp dir
```typescript
const env = { ...process.env, HOME: dir, USERPROFILE: dir };
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `commands/prefect-update.md` content | config/template | N/A | No existing Claude slash command files in this project or in `~/.claude/commands/`. Format is plain markdown per Claude Code convention — content is a bash instruction block. Planner should use the inline template pattern described above. |

---

## Discretion Notes for Planner

Per CONTEXT.md `Claude's Discretion` section:

1. **Slash command filename:** Use `prefect-update.md` (hyphens). Claude Code slash command convention uses hyphens in filenames.
2. **File copy mechanism:** Use `writeFileSync(dest, templateString)` (inline template) rather than `fs.cpSync` — keeps the package self-contained without a separate asset file, avoids `files` field changes.
3. **Template storage:** Inline as a module-level `const` string in `cli.ts` above the switch statement — consistent with `PREFECT_ENTRY` constant pattern (lines 20-30 of `cli.ts`).
4. **isGlobal in tests:** Tests run `build/cli.js` which is NOT under `node_modules/`, so `isGlobal` is always false in the test harness. Test coverage for actual file install behavior requires either: (a) testing the internal functions directly (if extracted), or (b) a slim integration note that the behavior is verified by the lifecycle hook in a real global install. The planner should test the silent-skip behavior (exit 0, no file created) and document this limitation.

---

## Metadata

**Analog search scope:** `src/` directory (all TypeScript source files), `package.json`, `~/.claude/commands/`
**Files scanned:** 4 source files read in full (`src/cli.ts`, `src/cli.test.ts`, `package.json`, `CLAUDE.md`)
**Pattern extraction date:** 2026-05-11
