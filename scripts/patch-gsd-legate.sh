#!/usr/bin/env bash
# patch-gsd-legate.sh — Patch GSD executor agents to support Legate delegation
#
# Usage:
#   bash scripts/patch-gsd-legate.sh             # apply patches
#   bash scripts/patch-gsd-legate.sh --dry-run   # preview without modifying
#   bash scripts/patch-gsd-legate.sh --revert    # restore from .pre-legate.bak files
#   bash scripts/patch-gsd-legate.sh --status    # show patch status for each agent
#
# What it patches:
#   ~/.claude/agents/gsd-executor.md   — primary executor (gsd-execute-phase)
#   ~/.claude/agents/gsd-code-fixer.md — code fix agent (gsd-code-review --fix)
#
# Each patch:
#   1. Adds `mcp__prefect__legate_*` to the tools list in the YAML frontmatter
#   2. Appends a <legate_delegation> block to the agent body
#
# Idempotent: re-running does NOT double-patch.
# Creates .pre-legate.bak backups before any modification.
#
# Why:
#   GSD subagents (gsd-executor, gsd-code-fixer) are spawned with an explicit
#   tools: frontmatter allowlist. They inherit project CLAUDE.md text that says
#   "delegate to legate", but they have no legate tools in their allowlist and
#   structurally cannot call them. This patch adds both the tool access and the
#   instructions for how and when to delegate.

set -euo pipefail

DRY_RUN=false
REVERT=false
STATUS=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --revert)  REVERT=true ;;
    --status)  STATUS=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

AGENTS_DIR="$HOME/.claude/agents"
LEGATE_TOOL="mcp__prefect__legate_*"
PATCH_MARKER="<legate_delegation>"

# ---------------------------------------------------------------------------
# Delegation block for gsd-executor
# ---------------------------------------------------------------------------
read -r -d '' EXECUTOR_BLOCK << 'EXECUTOR_EOF' || true

<legate_delegation>
## Legate: Delegating Code Generation to OpenCode Workers

Legate bridges this agent to local OpenCode workers (Qwen3-Coder) for mechanical
code generation. Use it during `execute_tasks` when a task requires writing
substantial new code — it keeps your context window free for orchestration and review.

### When to delegate (during type="auto" tasks)
- Implementing a function, class, or module from a task spec
- Scoped multi-line edits (>20 lines) to one or two files
- Generating boilerplate: tests, stubs, interfaces, CRUD scaffolding

### When NOT to delegate
- Reading or summarizing code → use Read/Grep directly (faster, no overhead)
- Running builds or tests → always use Bash; you decide pass/fail
- Committing → you commit via `task_commit_protocol`; legate only edits files
- Edits under ~10 lines → use Edit directly

### Delegation loop (replaces direct Edit/Write in execute_tasks)

Use this in place of writing code directly for qualifying tasks:

**Step 1 — Create session.** Always pass `directory` as the project's absolute path:
```
mcp__prefect__legate_create_session(title="<task name>", directory="<abs path>")
```
Save the returned `id` as your `sessionId` for this task.

**Step 2 — Delegate task.** Describe precisely what to implement; reference the task
spec, file paths, and any interface contracts from the plan:
```
mcp__prefect__legate_run(sessionId="<id>", prompt="<detailed task description>")
```
Blocks up to 120s. If stuck, call `mcp__prefect__legate_abort(sessionId="<id>")`.

**Step 3 — Review diff.** Inspect ALL changed files:
```
mcp__prefect__legate_get_diff(sessionId="<id>")
```
Read the full diff. If the diff alone is insufficient, use Read on modified files.

**Step 4 — Test.** Run the project's build/test command via Bash (never delegate this):
`npm run build`, `npm test`, `cargo test`, etc.

**Step 5 — Decide:**
- Tests pass + diff correct → proceed to `task_commit_protocol` as normal
- Needs correction → `mcp__prefect__legate_run(sessionId="<id>", prompt="correct: <feedback>")`, return to Step 3
- Session off-rails (wrong files, confused model) → `mcp__prefect__legate_fork(sessionId="<id>", messageID=<last-good-id>)` for a clean copy, return to Step 2 with new session ID
- Give up → `git checkout -- .` to reset working tree; discard session

**Step 6 — Commit.** Use `task_commit_protocol` exactly as for direct edits:
stage individual files, commit with conventional message, record hash.

**Step 7 — Delete session.** Always required — sessions accumulate in sessions.json:
```
mcp__prefect__legate_session_delete(sessionId="<id>")
```

### Tool availability fallback
If legate tools are unavailable (prefect MCP not loaded, OpenCode server offline),
fall back to direct Edit/Write as normal. Never block task execution waiting for legate.
The prefect server health check: `curl http://localhost:4096/global/health`
</legate_delegation>
EXECUTOR_EOF

# ---------------------------------------------------------------------------
# Delegation block for gsd-code-fixer
# ---------------------------------------------------------------------------
read -r -d '' FIXER_BLOCK << 'FIXER_EOF' || true

<legate_delegation>
## Legate: Delegating Code Fixes to OpenCode Workers

Legate bridges this agent to local OpenCode workers (Qwen3-Coder) for mechanical
code changes. Use it in `apply_fixes` when a finding requires non-trivial rewrites.

### When to delegate (during apply_fixes step)
- Fix requires substantial code rewriting (>15 lines)
- Fix involves complex logic changes (not a simple substitution)
- Multiple related files need coordinated edits that are hard to express as Edit calls

### When NOT to delegate
- Simple find-and-replace fixes → use Edit directly (faster)
- Syntax corrections, import additions → use Edit directly
- Running verification checks → always use Bash (Tier 1/2/3 as per verification_strategy)
- Committing → you commit via `gsd-sdk query commit`; legate only edits files

### Delegation loop (replaces direct Edit in apply_fixes)

Use in place of writing fixes directly for qualifying findings:

**Step 1 — Create session.** Always pass `directory` as the project's absolute path:
```
mcp__prefect__legate_create_session(title="fix <finding_id>", directory="<abs path>")
```

**Step 2 — Delegate fix.** Include the full finding context in your prompt:
```
mcp__prefect__legate_run(sessionId="<id>", prompt="<finding_id>: <issue description>. Fix: <fix guidance from REVIEW.md>. File: <path>")
```

**Step 3 — Review diff.**
```
mcp__prefect__legate_get_diff(sessionId="<id>")
```

**Step 4 — Verify.** Apply `verification_strategy` as normal using Bash.
If verification fails, use `rollback_strategy` (`git checkout -- <file>`) — not legate.

**Step 5 — Decide:**
- Verification passes → proceed to atomic commit via `gsd-sdk query commit`
- Needs correction → `mcp__prefect__legate_run` with corrective feedback, return to Step 3
- Rollback needed → `git checkout -- <files>`, mark finding as skipped with reason

**Step 6 — Delete session.** Always:
```
mcp__prefect__legate_session_delete(sessionId="<id>")
```

### Tool availability fallback
If legate tools unavailable (prefect MCP not loaded), fall back to direct Edit as normal.
</legate_delegation>
FIXER_EOF

# ---------------------------------------------------------------------------
# Agent target definitions: name → delegation block variable name
# ---------------------------------------------------------------------------
declare -a AGENT_NAMES=("gsd-executor" "gsd-code-fixer")
declare -A AGENT_BLOCKS=(
  ["gsd-executor"]="$EXECUTOR_BLOCK"
  ["gsd-code-fixer"]="$FIXER_BLOCK"
)

# ---------------------------------------------------------------------------
# Revert mode
# ---------------------------------------------------------------------------
if $REVERT; then
  echo "=== Reverting patches ==="
  any_reverted=false
  for name in "${AGENT_NAMES[@]}"; do
    agent_file="$AGENTS_DIR/${name}.md"
    backup_file="${agent_file}.pre-legate.bak"
    if [[ -f "$backup_file" ]]; then
      if $DRY_RUN; then
        echo "  [DRY RUN] Would restore: $agent_file from $backup_file"
      else
        cp "$backup_file" "$agent_file"
        rm "$backup_file"
        echo "  ✅ Restored: $name"
      fi
      any_reverted=true
    else
      echo "  ⏭️  No backup found: $name (not patched or already reverted)"
    fi
  done
  $any_reverted || echo "  Nothing to revert."
  exit 0
fi

# ---------------------------------------------------------------------------
# Status mode
# ---------------------------------------------------------------------------
if $STATUS; then
  echo "=== Legate patch status ==="
  for name in "${AGENT_NAMES[@]}"; do
    agent_file="$AGENTS_DIR/${name}.md"
    if [[ ! -f "$agent_file" ]]; then
      echo "  ❌ NOT FOUND: $name"
      continue
    fi
    has_tool=false
    has_block=false
    grep -q "$LEGATE_TOOL" "$agent_file" && has_tool=true
    grep -q "$PATCH_MARKER" "$agent_file" && has_block=true
    has_backup=false
    [[ -f "${agent_file}.pre-legate.bak" ]] && has_backup=true

    if $has_tool && $has_block; then
      echo "  ✅ PATCHED:    $name$(${has_backup} && echo ' (backup exists)' || echo '')"
    elif $has_tool || $has_block; then
      echo "  ⚠️  PARTIAL:   $name (tool=$has_tool block=$has_block)"
    else
      echo "  ○  UNPATCHED:  $name"
    fi
  done
  exit 0
fi

# ---------------------------------------------------------------------------
# Apply patches
# ---------------------------------------------------------------------------
echo "=== Applying legate patches to GSD agents ==="
$DRY_RUN && echo "    (DRY RUN — no files will be modified)"
echo ""

any_changed=false

for name in "${AGENT_NAMES[@]}"; do
  agent_file="$AGENTS_DIR/${name}.md"
  backup_file="${agent_file}.pre-legate.bak"
  delegation_block="${AGENT_BLOCKS[$name]}"

  echo "--- $name ---"

  if [[ ! -f "$agent_file" ]]; then
    echo "  ❌ File not found: $agent_file — skipping"
    continue
  fi

  content="$(cat "$agent_file")"
  modified=false

  # ---- 1. Patch frontmatter tools line ----
  if echo "$content" | grep -q "$LEGATE_TOOL"; then
    echo "  ⏭️  Tools: already contains $LEGATE_TOOL"
  else
    # Find the tools: line and append the legate wildcard
    # We handle the single-line format: "tools: X, Y, Z"
    if echo "$content" | grep -qE '^tools: '; then
      content="$(echo "$content" | sed -E "s/^(tools: .+)$/\1, mcp__prefect__legate_*/")"
      echo "  ✅ Tools: added mcp__prefect__legate_*"
      modified=true
    else
      echo "  ⚠️  Tools: could not find 'tools: ...' line — skipping tools patch"
    fi
  fi

  # ---- 2. Append delegation block ----
  if echo "$content" | grep -q "$PATCH_MARKER"; then
    echo "  ⏭️  Block: <legate_delegation> already present"
  else
    content="${content}${delegation_block}"
    echo "  ✅ Block: appended <legate_delegation>"
    modified=true
  fi

  # ---- Write changes ----
  if $modified; then
    if $DRY_RUN; then
      echo "  🔍 [DRY RUN] Would write $agent_file"
      echo "       First changed tools line:"
      echo "$content" | grep "mcp__prefect__legate" | head -1 | sed 's/^/       /'
    else
      # Backup original (only if no backup already exists)
      if [[ ! -f "$backup_file" ]]; then
        cp "$agent_file" "$backup_file"
        echo "  💾 Backup: ${name}.md.pre-legate.bak"
      fi
      printf '%s' "$content" > "$agent_file"
      echo "  ✍️  Written: $agent_file"
    fi
    any_changed=true
  else
    echo "  ✓  Already fully patched — no changes needed"
  fi

  echo ""
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
if $DRY_RUN; then
  echo "=== Dry run complete. Re-run without --dry-run to apply. ==="
elif $any_changed; then
  echo "=== Patches applied. ==="
  echo ""
  echo "What changed:"
  echo "  • gsd-executor and gsd-code-fixer now have mcp__prefect__legate_* in their tools list"
  echo "  • Each agent has a <legate_delegation> block explaining when/how to delegate"
  echo ""
  echo "To verify:"
  echo "  bash scripts/patch-gsd-legate.sh --status"
  echo ""
  echo "To revert:"
  echo "  bash scripts/patch-gsd-legate.sh --revert"
  echo ""
  echo "Note: Claude Code must be restarted (or the session restarted) for agent"
  echo "changes to take effect in spawned subagents."
else
  echo "=== All agents already patched. Nothing to do. ==="
fi
