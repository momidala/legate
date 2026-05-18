# Phase 6: Skill Card - Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 2 (src/cli.ts modified, src/cli.test.ts modified)
**Analogs found:** 2 / 2 — both files are being extended, so the analog IS the file being modified

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli.ts` | utility / CLI handler | file-I/O, batch | `src/cli.ts` (existing handlers) | exact — extending existing file |
| `src/cli.test.ts` | test | batch | `src/cli.test.ts` (SELFUP block, lines 441–585) | exact — extending existing file |

---

## Pattern Assignments

### `src/cli.ts` — four change sites

**Analog:** `src/cli.ts` itself (direct extension)

---

#### Change 1: `LEGATE_SKILL_CARD_STATIC` constant (new, module-scope)

**Copy from:** `LEGATE_UPDATE_COMMAND_CONTENT` constant pattern (lines 35–44)

```typescript
// src/cli.ts lines 35-44 — module-level template literal constant
const LEGATE_UPDATE_COMMAND_CONTENT = `Update the legate package to the latest version, then confirm and prompt restart.

Run this bash command:

\`\`\`bash
npm install -g legate@latest && \\
  NEW_VERSION=$(node --input-type=commonjs -e "const p=require('path');const cp=require('child_process');const root=cp.execSync('npm root -g',{encoding:'utf8'}).trim();const pkg=require(p.join(root,'legate/package.json'));process.stdout.write(pkg.version);") && \\
  echo "legate updated to v$NEW_VERSION. Restart Claude Code to apply."
\`\`\`
`;
```

**Pattern rule:** Define as a `const` at module scope, before any functions. Use a template literal. The string is the complete file content — no runtime file reads. Phase 6 adds `LEGATE_SKILL_CARD_STATIC` immediately after `LEGATE_UPDATE_COMMAND_CONTENT` following the same pattern.

---

#### Change 2: `buildWorkersSection()` helper (new function)

**Copy from:** `updateClaudemdWorkers` bullet generation pattern (lines 51–55)

```typescript
// src/cli.ts lines 46-55 — workers bullet generation; copy the map() call exactly
function updateClaudemdWorkers(cwd: string): void {
  const claudePath = resolve(cwd, 'CLAUDE.md');
  const existing = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : '';
  const { servers } = readRegistry();

  const bullets = servers.map(
    (s) => `- **${s.name}** — ${s.providerID}/${s.modelID}, ${s.host}:${s.port}, capacity: ${s.maxSessions ?? 'unlimited'}`
  );
  const sectionContent = bullets.length > 0 ? bullets.join('\n') : '*(no servers registered)*';
  const newSection = `## Available Workers\n\n${sectionContent}\n`;
  // ...
}
```

**Pattern rule:** `buildWorkersSection()` is a pure function (no `cwd` arg, no file reads other than registry). It returns the `## Available Workers\n\n...\n` block as a string. The `bullets.map()` format is identical to the one in `updateClaudemdWorkers` — same backtick template, same `??` fallback for `maxSessions`. The empty-registry placeholder for `legate.md` should be `*(no servers registered — run: legate add-server)*` (slightly different from the CLAUDE.md placeholder to include the fix command).

---

#### Change 3: `installSkillCards(destDir)` helper (new function)

**Copy from:** `handleInstallCommand` body (lines 147–167)

```typescript
// src/cli.ts lines 147-167 — existing install handler; extract its file-write logic
function handleInstallCommand(): never {
  if (!isGlobal) process.exit(0);                         // guard stays in handleInstallCommand

  const destDir = join(homedir(), '.claude', 'commands');
  const dest = join(destDir, 'legate-update.md');

  try {
    mkdirSync(destDir, { recursive: true });               // copy this pattern
    writeFileSync(dest, LEGATE_UPDATE_COMMAND_CONTENT);    // copy this pattern
    if (!process.env.npm_lifecycle_event) {
      console.error(`Installed /legate-update command to ${dest}`);
    }
  } catch (err) {
    console.error(`Warning: legate-update command not installed — ${(err as Error).message}`);
    process.exit(0);
  }
  process.exit(0);
}
```

**Pattern rule:** `installSkillCards(destDir: string): void` (NOT `never` — callers control exit).
- `mkdirSync(destDir, { recursive: true })` — identical call
- `writeFileSync(join(destDir, 'legate.md'), LEGATE_SKILL_CARD_STATIC + buildWorkersSection())` — new file first
- `writeFileSync(join(destDir, 'legate-update.md'), LEGATE_UPDATE_COMMAND_CONTENT)` — existing file second
- Does NOT contain the `isGlobal` guard — that stays in `handleInstallCommand`
- Does NOT log — callers log their own messages

---

#### Change 4: `handleInstallCommand` refactor + `handleUninstallCommand` extension + `init` case addition

**Copy from:** `handleInstallCommand` (lines 147–167) and `handleUninstallCommand` (lines 169–181)

```typescript
// src/cli.ts lines 169-181 — existing uninstall handler; add rmSync for legate.md
function handleUninstallCommand(): never {
  if (!isGlobal) process.exit(0);

  const dest = join(homedir(), '.claude', 'commands', 'legate-update.md');
  try {
    rmSync(dest, { force: true });      // existing line — keep
  } catch {
    // D-08: non-fatal
  }
  process.exit(0);
}
```

**Pattern rule for `handleUninstallCommand`:** Add `rmSync(join(destDir, 'legate.md'), { force: true })` BEFORE the existing `legate-update.md` removal. Use a `const destDir` local variable rather than repeating `join(homedir(), '.claude', 'commands')`. Both `rmSync` calls use `{ force: true }`.

**Pattern rule for `handleInstallCommand`:** Replace its try body with `installSkillCards(destDir)`. Update the error message from `Warning: legate-update command not installed —` to `Warning: legate commands not installed —` (both files now involved). Update the success log from `Installed /legate-update command to ${dest}` to `Installed /legate and /legate-update commands to ${destDir}`.

```typescript
// src/cli.ts lines 205-248 — init case; add installSkillCards call after writing .mcp.json
case 'init': {
  // ... existing .mcp.json logic unchanged ...
  // After the final writeFileSync + console.error for .mcp.json:
  try {
    installSkillCards(join(homedir(), '.claude', 'commands'));
    console.error(`Installed /legate and /legate-update skill cards`);
  } catch (err) {
    console.error(`Warning: skill cards not installed — ${(err as Error).message}`);
  }
  printOnboardingIfNoServers();
  process.exit(0);
}
```

**Pattern rule for `init` case:** No `isGlobal` guard. Wrap `installSkillCards` in try/catch like the existing `updateClaudemdWorkers` call sites (lines 122, 138). Errors are non-fatal — print to stderr and continue. The `process.exit(0)` stays at the end of the `init` case, not inside the try block.

---

### `src/cli.test.ts` — SKILL test block (new tests appended to existing file)

**Analog:** `src/cli.test.ts` SELFUP block (lines 441–585) — copy structure exactly

**Imports pattern** (lines 1–6 — already present, no new imports needed):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
```

**Test structure pattern** (lines 469–481 — install-command skip test):
```typescript
test('SELFUP: install-command silent-skips when not global (exit 0, no file, no stderr)', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stdout, stderr } = runCli(dir, env, 'install-command');
    assert.equal(status, 0);
    assert.equal(stdout, '');
    assert.equal(stderr, '');
    assert.equal(existsSync(join(dir, '.claude', 'commands', 'legate-update.md')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

**Pattern rule:** Every test:
1. `const dir = freshTmp()` — isolated temp dir
2. `try { ... } finally { rmSync(dir, { recursive: true, force: true }); }` — cleanup always runs
3. `{ ...process.env, HOME: dir, USERPROFILE: dir }` — override home for registry and command dir isolation
4. `runCliAsGlobal(dir, ...)` for `isGlobal===true` paths; `runCli(dir, env, ...)` for non-global paths
5. Assertions on `status`, `stderr`, `existsSync`, `readFileSync` content

**`runCliAsGlobal` helper pattern** (lines 443–467 — copy as-is, already exists):
```typescript
function runCliAsGlobal(homeDir: string, ...args: string[]):
  { status: number; stdout: string; stderr: string } {
  const fakeGlobalRoot = join(homeDir, 'node_modules', 'legate');
  const fakeBuildDir = join(fakeGlobalRoot, 'build');
  mkdirSync(fakeBuildDir, { recursive: true });
  const srcBuildDir = resolve(process.cwd(), 'build');
  const buildFiles = ['cli.js', 'registry.js'];
  for (const f of buildFiles) {
    const srcPath = join(srcBuildDir, f);
    if (!existsSync(srcPath)) {
      throw new Error(`Build artifact missing: ${srcPath} — run 'npm run build' first`);
    }
    writeFileSync(join(fakeBuildDir, f), readFileSync(srcPath, 'utf8'));
  }
  writeFileSync(join(fakeGlobalRoot, 'package.json'), JSON.stringify({ name: 'legate', version: '0.0.0-test' }));
  const fakeCli = join(fakeBuildDir, 'cli.js');
  const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, npm_config_global: 'true' };
  const res = spawnSync('node', [fakeCli, ...args], { cwd: homeDir, encoding: 'utf8', env });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}
```

**Exact warning message assertion pattern** (lines 559–572 — must be updated):
```typescript
test('SELFUP: install-command warns to stderr and exits 0 when mkdir/write fails', () => {
  // ...
  assert.match(stderr, /Warning: legate-update command not installed —/);  // THIS LINE MUST CHANGE
  // New assertion after Phase 6:
  assert.match(stderr, /Warning: legate commands not installed —/);
});
```

**Content assertion pattern** (lines 496–512 — model for SKILL content assertions):
```typescript
test('SELFUP-01: install-command writes ~/.claude/commands/legate-update.md when global', () => {
  const dir = freshTmp();
  try {
    const { status, stderr } = runCliAsGlobal(dir, 'install-command');
    assert.equal(status, 0, `expected exit 0, got ${status}, stderr: ${stderr}`);
    const dest = join(dir, '.claude', 'commands', 'legate-update.md');
    assert.ok(existsSync(dest), 'legate-update.md must be written');
    const content = readFileSync(dest, 'utf8');
    assert.match(content, /npm install -g legate@latest/);
    assert.match(content, /legate updated to v/);
    assert.match(content, /Restart Claude Code to apply\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

---

## Shared Patterns

### File I/O (synchronous, always)
**Source:** `src/cli.ts` throughout — `writeFileSync`, `mkdirSync`, `rmSync`, `existsSync`, `readFileSync`
**Apply to:** All Phase 6 changes
**Rule:** No async file I/O. All existing cli.ts file operations are synchronous. Stay synchronous.

### Error handling — non-fatal try/catch
**Source:** `src/cli.ts` lines 154–165 (`handleInstallCommand` try/catch) and lines 122, 138 (`updateClaudemdWorkers` call sites)

```typescript
// Pattern A: handler-level (controls process.exit)
try {
  installSkillCards(destDir);
  if (!process.env.npm_lifecycle_event) {
    console.error(`Installed /legate and /legate-update commands to ${destDir}`);
  }
} catch (err) {
  console.error(`Warning: legate commands not installed — ${(err as Error).message}`);
  process.exit(0);   // exit 0 — never block npm install
}
process.exit(0);

// Pattern B: inline call site (caller continues)
try { installSkillCards(join(homedir(), '.claude', 'commands')); } catch (e) { console.error(`Warning: skill cards not installed — ${(e as Error).message}`); }
```

**Apply to:** `handleInstallCommand` (Pattern A), `init` case (Pattern B)

### Registry read pattern
**Source:** `src/cli.ts` lines 49, 122, 138; `src/registry.ts` lines 27–39

```typescript
// Call site pattern — no try/catch needed; readRegistry handles ENOENT
const { servers } = readRegistry();
// ENOENT → returns { servers: [] } (not an error)
```

**Apply to:** `buildWorkersSection()` — call `readRegistry()` directly, no wrapping try/catch. ENOENT is already handled inside `readRegistry`.

### npm lifecycle silence pattern
**Source:** `src/cli.ts` lines 158–160

```typescript
if (!process.env.npm_lifecycle_event) {
  console.error(`Installed /legate and /legate-update commands to ${destDir}`);
}
```

**Apply to:** `handleInstallCommand` success path — print only when called directly, not via postinstall hook.

### Test isolation pattern
**Source:** `src/cli.test.ts` lines 13–15, 131–143 (HOME override pattern)

```typescript
const dir = freshTmp();
const env = { ...process.env, HOME: dir, USERPROFILE: dir };
// All file paths computed from dir:
const commandsDir = join(dir, '.claude', 'commands');
const registryDir = join(dir, '.config', 'legate');
```

**Apply to:** All SKILL tests — always override HOME so skill card installs go to `<tmp>/.claude/commands/`, not the real `~/.claude/commands/`.

---

## No Analog Found

All files being modified are extensions of existing well-tested files. No new files are created. No analogs are missing.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| *(none)* | — | — | All changes extend existing analogs |

---

## Change Site Summary

For the planner's reference, Phase 6 touches exactly these locations in two files:

| File | Change Site | Type | Lines (approx) |
|------|-------------|------|----------------|
| `src/cli.ts` | Add `LEGATE_SKILL_CARD_STATIC` constant | insert after line 44 | ~60 lines |
| `src/cli.ts` | Add `buildWorkersSection()` function | insert after constant | ~8 lines |
| `src/cli.ts` | Add `installSkillCards(destDir)` function | insert before `handleInstallCommand` | ~5 lines |
| `src/cli.ts` | Refactor `handleInstallCommand` body | modify lines 151–165 | ~5 lines changed |
| `src/cli.ts` | Extend `handleUninstallCommand` body | modify lines 169–181 | ~3 lines added |
| `src/cli.ts` | Extend `init` case | modify lines 206–248 | ~6 lines added |
| `src/cli.test.ts` | Update existing warning message assertion | modify line 568 | 1 line |
| `src/cli.test.ts` | Add SKILL-01..SKILL-05 test cases | append after line 585 | ~100 lines |

---

## Metadata

**Analog search scope:** `src/cli.ts`, `src/cli.test.ts`, `src/registry.ts`
**Files scanned:** 3
**Pattern extraction date:** 2026-05-17
