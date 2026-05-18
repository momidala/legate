---
phase: 06-skill-card
reviewed: 2026-05-17T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/cli.ts
  - src/cli.test.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-05-17
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed `src/cli.ts` (the legate CLI entry point) and `src/cli.test.ts` (its integration test suite), cross-referencing `src/registry.ts` for called functions.

The implementation adds skill card installation (`legate.md`, `legate-update.md`) to the `init`, `install-command`, and `uninstall-command` paths. The logic is broadly correct and the test suite covers the happy paths well. Four quality defects were identified: two bugs in the `updateClaudemdWorkers` string manipulation that produce malformed whitespace in `CLAUDE.md`, one test isolation failure where `runInit` tests contaminate the developer's real home directory, and one architectural inconsistency in the registry module's output channel.

No security vulnerabilities or data loss risks were found.

---

## Warnings

### WR-01: `updateClaudemdWorkers` appends a leading blank line to new `CLAUDE.md` files

**File:** `src/cli.ts:103-106`
**Issue:** When `CLAUDE.md` does not yet exist, `existing` is `''` (empty string). The separator logic correctly sets `sep = ''` because `existing.length === 0`, but the hard-coded `'\n'` on the concatenation line is always emitted regardless. The result is that the newly created file starts with a bare newline before the section heading:

```
\n## Available Workers\n\n- **local** — ...
```

A `CLAUDE.md` that starts with an empty line is visually malformed. No existing test asserts `!content.startsWith('\n')`, so this defect ships silently.

**Fix:**
```typescript
// Lines 103-106 in updateClaudemdWorkers
if (startIdx === -1) {
  // Only add blank line separator when the file already has content
  const sep = existing.length > 0 ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
  updated = existing + sep + newSection;
}
```

---

### WR-02: Section replacement injects a double blank line before the next `##` heading

**File:** `src/cli.ts:110-116`
**Issue:** When replacing an existing `## Available Workers` section that is followed by another `##` heading, the code splits `newSection` on `'\n'` (leaving a trailing `''` element from the section's trailing newline), then prepends `''` before `tail`. This produces three consecutive `\n` characters — a double blank line — between the section content and the next heading:

```
- **local** — ...
                   <- blank line (from trailing '' in newSection.split)
                   <- blank line (from the prepended '')
## Next Section
```

Verified with:
```
newSection = '## Available Workers\n\n- **new**\n'
newSection.split('\n') = ['## Available Workers', '', '- **new**', '']
                                                                   ^^ trailing ''
Then ['', ...tail] prepends another ''
```

**Fix:**
```typescript
// Lines 112-115 — strip the trailing empty element before adding separator
const sectionLines = newSection.split('\n');
// Remove trailing '' produced by the final '\n' in newSection
if (sectionLines[sectionLines.length - 1] === '') sectionLines.pop();
updated = [
  ...fileLines.slice(0, startIdx),
  ...sectionLines,
  ...(tail.length > 0 ? ['', ...tail] : ['']),
].join('\n');
```

---

### WR-03: Tests using `runInit` do not isolate `HOME` — writes reach the real `~/.claude/commands/`

**File:** `src/cli.test.ts:17-19`, lines 31, 51, 67, 87, 106
**Issue:** The helper `runInit` spawns the CLI without overriding the `HOME` / `USERPROFILE` environment variables. The `init` command calls `installSkillCards(join(homedir(), '.claude', 'commands'))` where `homedir()` resolves from the subprocess's unmodified `HOME`. Every test case that calls `runInit` therefore writes `legate.md` and `legate-update.md` to the **real developer's** `~/.claude/commands/` directory. Running the test suite rewrites the user's actual skill card files five times.

Compare with all other test groups (MULTI-08, MULTI-09, SKILL-01/04/05), which correctly override `HOME` via `runCli(dir, env, ...)`.

**Fix:** Align `runInit` with `runCli` by accepting and forwarding an `env` argument, then pass `{ ...process.env, HOME: dir, USERPROFILE: dir }` at every call site:

```typescript
function runInit(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): { status: number; stderr: string } {
  const res = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env });
  return { status: res.status ?? -1, stderr: res.stderr };
}

// Call sites:
const env = { ...process.env, HOME: dir, USERPROFILE: dir };
const { status } = runInit(dir, env, 'init');
```

---

### WR-04: `registry.ts` emits status messages to `stdout` (`console.log`), inconsistent with the rest of the CLI

**File:** `src/registry.ts:59, 75, 81, 84-85, 88`
**Issue:** `addServer` (line 59) and `removeServer` (line 75) emit human-readable status messages via `console.log`, which writes to stdout. All CLI status and error messages in `cli.ts` use `console.error` (stderr). This inconsistency means:

1. The `remove-server` success message `Removed server 'local'.` appears on stdout (line 75), which is what the test at `cli.test.ts:200` asserts. If callers ever machine-parse stdout (e.g., to capture `list-servers` tabular output), the removal message would contaminate the stream.
2. If `add-server` updates an existing entry, the message `Updated existing server '...'` goes to stdout — mixing with the tabular `list-servers` output convention.

**Fix:** Replace `console.log` with `console.error` in `registry.ts` for the status messages at lines 59 and 75. Update the test at `cli.test.ts:200` to assert on `stderr` instead of `stdout`:

```typescript
// registry.ts line 59
console.error(`Updated existing server '${entry.name}'.`);

// registry.ts line 75
console.error(`Removed server '${name}'.`);
```

```typescript
// cli.test.ts line 195-200 — change stdout to stderr
const { status, stderr } = runCli(dir, env, 'remove-server', 'local');
assert.equal(status, 0);
// ...
assert.match(stderr, /Removed server 'local'/);
```

---

## Info

### IN-01: Placeholder text differs between `buildWorkersSection` and `updateClaudemdWorkers`

**File:** `src/cli.ts:84` and `src/cli.ts:96`
**Issue:** Two functions generate an "Available Workers" section for different files (`legate.md` vs `CLAUDE.md`) but use different placeholder text when no servers are registered:
- `buildWorkersSection` (for `legate.md`): `*(no servers registered — run: legate add-server)*`
- `updateClaudemdWorkers` (for `CLAUDE.md`): `*(no servers registered)*`

The difference is unintentional (one has an actionable hint, the other does not). Tests pass because the shared pattern `/no servers registered/` matches both.

**Fix:** Extract a constant and reuse it, or make the difference intentional with a comment.

---

### IN-02: Port argument silently truncates decimal values

**File:** `src/cli.ts:157-160`
**Issue:** `parseInt('80.5', 10)` returns `80`. A user who accidentally types `legate add-server local localhost 80.5 vllm qwen3` gets port 80 registered with no error. The `isFinite` guard does not catch this because `parseInt` discards the decimal part before the check.

**Fix:** Reject non-integer port strings before `parseInt`:
```typescript
if (!/^\d+$/.test(portStr)) {
  console.error(`Error: invalid port '${portStr}' — must be an integer 1-65535`);
  process.exit(1);
}
const port = parseInt(portStr, 10);
```

---

### IN-03: `name` and `host` fields have no input validation

**File:** `src/cli.ts:152-155`
**Issue:** Server `name` and `host` are accepted as arbitrary strings. A name containing markdown formatting characters (e.g., `**bold**`) or a very long name would produce malformed output in `CLAUDE.md` and `legate.md`. Not a security issue (values are stored in JSON and rendered in markdown only), but could confuse users.

**Fix:** Add a basic validation for `name` (alphanumeric, hyphens, underscores; max 64 chars) and `host` (non-empty, no whitespace) with descriptive error messages.

---

_Reviewed: 2026-05-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
