# Agent Instructions

This is the Prefect MCP server — a TypeScript project that exposes OpenCode's HTTP API as Claude Code tools.

## Core Workflow

1. **CREATE SESSION** - `prefect_create_session` with explicit `directory` parameter
2. **RUN PROMPT** - `prefect_run` with task description  
3. **GET DIFF** - `prefect_get_diff` to see changes
4. **REVIEW & TEST** - Check diff and run project tests/build
5. **DECIDE** - Commit if good, correct if needed, or fork/abort as appropriate

## Key Commands & Patterns

### Development Setup
- `npm install` - Install dependencies
- `npm run build` - Compile TypeScript to build/ directory (required for Claude Code)
- `npm run test` - Run all tests

### Configuration
- `PREFECT_SERVER_URL` (default: `http://localhost:4096`) - OpenCode API endpoint
- `PREFECT_TIMEOUT_MS` (default: 120000) - Timeout for `prefect_run`
- `PREFECT_DEFAULT_PROJECT` - Working directory for auto-started OpenCode instances

### Critical Constraints
- **Always pass `directory` explicitly** to all tools - never rely on defaults
- **Build is required** - The `build/` directory must exist for Claude Code to work
- **All changes land in working tree** - Git is the safety net, not OpenCode

### Testing
- Test with `npm run test` (runs all test files in build/)
- Run individual tests with `node build/<test-file>.js`
- Validate with `examples/test-task.md` end-to-end test

### Environment Setup
- Node.js >= 20 (per package.json engines)
- OpenCode CLI >= 1.14
- Claude Code CLI
- Local model endpoint configured in `~/.config/opencode/opencode.json`

### Repository Structure
```
.
├── src/                 # TypeScript source
├── build/               # Compiled output (gitignored)
├── .mcp.json            # Claude Code registration
├── package.json         # Dependencies, scripts
└── CLAUDE.md            # Claude Code workflow instructions
```

## Important Notes

- **Never modify the build/ directory directly** - always rebuild from src/
- **All OpenCode sessions run in the current working directory** - not in a sandbox
- **Git is the safety net** - use `git checkout -- .` to reset if needed
- **Tools require OpenCode to be running** - check with `curl http://localhost:4096/global/health`

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds