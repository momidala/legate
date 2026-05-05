# Prefect

A TypeScript MCP server that exposes OpenCode's headless HTTP API as Claude Code tools. Claude Code orchestrates at the task level (decompose, review, correct) while delegating actual file edits to a local model running in OpenCode. Diffs land in your working tree; you commit when ready.

**Core value:** delegate implementation to a local model, review the diff in Claude Code, ship without context-switching.

## What's in the Box

40 MCP tools wrapping OpenCode's session API, organized by category:

**Core loop** — the canonical create → run → diff → correct cycle:

| Tool | Purpose |
|------|---------|
| `prefect_create_session` | Start a new coding session |
| `prefect_run` | Send a prompt, block until the agent finishes |
| `prefect_get_diff` | Inspect what OpenCode changed |
| `prefect_fork` | Fork a session at a safe point (escape hatch for off-rails sessions) |
| `prefect_revert` | Undo a single bad message |
| `prefect_abort` | Stop a running session before timeout |
| `prefect_approve_permission` | Respond to a permission request (emergency only) |

**Composite shortcuts** — collapse common multi-step patterns into one call:

| Tool | Purpose |
|------|---------|
| `prefect_delegate` | Blocking: create session + run prompt + return diff in one call |
| `prefect_dispatch` | Non-blocking: create session + fire prompt, returns `sessionId` immediately |
| `prefect_await` | Poll a dispatched session until idle, then return result + diff |
| `prefect_inspect` | Compact snapshot `{ status, todos, changedFiles }` — faster than full message fetch |
| `prefect_prompt_async` | Fire a prompt to an existing session without blocking |

**Session management** — read and mutate session state:

| Tool | Purpose |
|------|---------|
| `prefect_session_list` | List all sessions, optionally filtered by project directory |
| `prefect_session_get` | Fetch a single session by ID |
| `prefect_session_status` | Real-time status map for all active sessions (idle / busy / retry) |
| `prefect_session_messages` | Retrieve message history (with optional limit) |
| `prefect_session_message` | Fetch a single message by ID |
| `prefect_session_delete` | Permanently delete a session and its history |
| `prefect_session_rename` | Rename a session |
| `prefect_session_children` | List sessions forked from a given session |
| `prefect_session_unrevert` | Undo a prior revert (restore removed messages) |
| `prefect_session_command` | Run a slash command inside a session (e.g. `compact`) |
| `prefect_session_summarize` | Trigger summary generation for a session |
| `prefect_session_todo` | Get the current todo list for a session |
| `prefect_session_init` | Initialize AGENTS.md for a session's project (**Note:** if AGENTS.md is staged for deletion in git (`D` in `git status`), the model may skip writing it — treating the git-deleted state as intentional. Ensure the file is either committed and present, or fully removed from both working tree and git index before calling.) |
| `prefect_session_share` | Make a session publicly shareable |
| `prefect_session_unshare` | Remove public sharing from a session |
| `prefect_session_shell` | Execute an arbitrary shell command in a session's working directory |

**Discovery** — read-only inspection of the OpenCode workspace:

| Tool | Purpose |
|------|---------|
| `prefect_list_agents` | List available agents (name, description, mode) |
| `prefect_list_providers` | List configured providers and their models |
| `prefect_list_mcp_servers` | List MCP servers configured in the OpenCode instance |
| `prefect_list_commands` | List available slash commands |
| `prefect_list_tools` | List tools available in the OpenCode instance |
| `prefect_find_symbol` | Search workspace for symbols matching a query (**EXPERIMENTAL** — returns `[]` in OpenCode ≤ 1.14.33; `workspace/symbol` LSP requests not yet implemented. Requires `"lsp": true` in `opencode.json` and `typescript-language-server` installed globally when it does work.) |
| `prefect_find_file` | Find files matching a query string |
| `prefect_get_file_content` | Read a file from the OpenCode workspace |
| `prefect_get_config` | Get the full OpenCode configuration object |
| `prefect_vcs_info` | Get VCS info (current branch) for the workspace |
| `prefect_file_status` | Get git-tracked file status for the workspace |

**Infrastructure:**

| Tool | Purpose |
|------|---------|
| `prefect_inject_mcp_server` | Add an MCP server to the OpenCode instance at runtime |

Also included:
- Project-scoped Claude Code registration (`.mcp.json`) so any clone of this repo automatically picks up the tools.
- End-to-end validation task (`examples/test-task.md`).

## Install

### Option 1: Global install (recommended)

```bash
npm install -g prefect-mcp
cd /your/project
prefect init
```

`prefect init` auto-detects the global install and writes a `.mcp.json` entry:

```json
{
  "mcpServers": {
    "prefect": {
      "type": "stdio",
      "command": "prefect-mcp",
      "args": []
    }
  }
}
```

Use `prefect init --force` to overwrite an existing `prefect` entry.

### Option 2: Local clone (development / contributing)

```bash
git clone https://github.com/barchett/prefect-mcp.git
cd prefect-mcp
npm install
npm run build
cd /your/project
/path/to/prefect-mcp/build/cli.js init
```

`prefect init` (run from a local clone) detects the absence of the `node_modules/prefect-mcp/` path segment and writes:

```json
{
  "mcpServers": {
    "prefect": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/prefect-mcp/build/index.js"]
    }
  }
}
```

## Prerequisites

- **Node.js >= 20**. `node --version` to check.
- **OpenCode CLI >= 1.14**. Install: `curl -fsSL https://opencode.ai/install | bash`. Verify: `opencode --version`.
- **Claude Code CLI**. Verify: `claude --version`.
- A model endpoint OpenCode can talk to (vllm, Ollama, OpenAI-compatible, etc.). Configured in `~/.config/opencode/opencode.json`.

## Setup (Fresh Clone)

### 1. Clone and build the MCP server

```bash
git clone https://github.com/barchett/prefect-mcp.git
cd prefect-mcp
npm install
npm run build
```

`npm run build` runs `tsc && chmod 755 build/index.js`. The `build/` directory is gitignored, so this step is REQUIRED on every fresh clone — Claude Code will fail to spawn the MCP server otherwise.

### 2. Verify the project-scoped MCP registration

The repo ships with `.mcp.json` at the project root that registers the MCP server with Claude Code. To confirm it's there:

```bash
cat .mcp.json
```

You should see the `prefect` server configured with `command: "node"` and `args: ["build/index.js"]`. If `.mcp.json` is missing or empty, recreate it with:

```bash
claude mcp add --scope project prefect -- node build/index.js
```

> Use `--scope project`, not `--scope local`. Local scope stores the config in `~/.claude.json` (user-only, not committed); project scope writes `.mcp.json` so all clones get it.

### 3. Configure OpenCode

OpenCode's config lives at `~/.config/opencode/opencode.json`. Example for a local vllm backend:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "vllm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "vLLM (local)",
      "options": {
        "baseURL": "http://<your-vllm-host>:8000/v1"
      },
      "models": {
        "<model-id>": { "name": "Your Model" }
      }
    }
  },
  "model": "vllm/<model-id>",
  "permission": {
    "bash": "allow",
    "edit": "allow",
    "write": "allow",
    "webfetch": "allow"
  }
}
```

The `permission: allow` block is intentional — Prefect treats git as the safety net. If you want manual permission prompts, see `prefect_approve_permission` in `CLAUDE.md` (emergency tool).

Auth file (placeholder is required even for local models):

```bash
mkdir -p ~/.local/share/opencode
echo '{"vllm": "dummy"}' > ~/.local/share/opencode/auth.json
```

Adjust the provider key (`vllm`) and path if you use Ollama, OpenAI, etc.

### 4. Start OpenCode headless

Prefect auto-starts OpenCode on the first tool call if it isn't already running, so this step is optional for most setups. Auto-start spawns `opencode serve --port <N>` where `<N>` is the port from `PREFECT_SERVER_URL` (default 4096). The process is spawned in `PREFECT_DEFAULT_PROJECT` if set, otherwise in Prefect's own working directory.

> **Auto-start only works when `PREFECT_SERVER_URL` is local** (`localhost` or `127.0.0.1`). If `PREFECT_SERVER_URL` points to a remote host (e.g. a Windows host IP from WSL2), auto-start will spawn a local process that cannot satisfy the remote health check and will time out. Start OpenCode manually on the remote machine instead.

If you prefer to manage the process yourself, start it manually **from your project root** in a dedicated terminal:

```bash
cd /path/to/your-project
opencode serve --port 4096
```

> **Run from your project root, not from `~` or elsewhere.** OpenCode sets the working directory for all sessions to wherever `opencode serve` was launched. Manual start from the wrong directory causes `prefect_run` to create files there.

> **Use `--port 4096`** (or whatever port is in `PREFECT_SERVER_URL`). The default OpenCode port is `0` (random).

Health check:

```bash
curl http://localhost:4096/global/health
# {"healthy":true,"version":"1.14.x"}
```

### 5. Open Claude Code

From the project root:

```bash
claude
```

Inside the session, run:

```
/mcp
```

You should see `prefect` listed as connected. If it shows as failed, the most likely causes (in order):
1. `build/index.js` does not exist -> run `npm run build`.
2. `.mcp.json` is malformed or missing -> see step 2 above.
3. `opencode` is not on PATH (auto-start will fail silently) -> verify with `which opencode`.

### 6. Run the validation task

With everything wired up, follow `examples/test-task.md` to confirm the full create -> run -> diff -> commit loop works end-to-end. Success means a new `examples/hello.ts` file lands in your working tree and you can commit it.

## Configuration

| Env Var | Default | Purpose |
|---------|---------|---------|
| `PREFECT_SERVER_URL` | `http://localhost:4096` | Base URL for OpenCode API; port is also used when auto-starting (`opencode serve --port <N>`) |
| `PREFECT_TIMEOUT_MS` | `120000` | Max wait for `prefect_run` to return (ms) |
| `PREFECT_AUTOSTART_TIMEOUT_MS` | `30000` | Max wait for OpenCode to become healthy after auto-start spawn (ms) |
| `PREFECT_DEFAULT_PROJECT` | _(unset)_ | Working directory passed to `opencode serve` on auto-start; defaults to Prefect's own cwd |
| `PREFECT_SERVER_PASSWORD` | _(unset)_ | HTTP Basic Auth password for OpenCode server (read at every tool call) |
| `PREFECT_SERVER_USERNAME` | `opencode` | HTTP Basic Auth username (only used when `PREFECT_SERVER_PASSWORD` is set) |

> **Deprecated names:** Old `OPENCODE_URL`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME`, and `OPENCODE_DEFAULT_PROJECT` env var names still work but emit a stderr deprecation warning on first use. Migrate to the `PREFECT_*` names above.

> **Security (INFRA-06):** Do NOT put `PREFECT_SERVER_PASSWORD` in the `.mcp.json` `env` block.
> `.mcp.json` is committed to version control — storing credentials there leaks them.
> Set `PREFECT_SERVER_PASSWORD` in your shell profile (e.g., `~/.bashrc` or `~/.zshrc`)
> or in a `.env` file that is gitignored. The MCP server reads it at call time from the
> shell environment, not from `.mcp.json`.

To override per-project, edit the `env` field of `.mcp.json`:

```json
"env": {
  "PREFECT_SERVER_URL": "http://192.168.x.x:4096",
  "PREFECT_TIMEOUT_MS": "300000"
}
```

## Day-to-Day Use

See `CLAUDE.md` for the canonical create -> run -> diff -> test -> correct loop. Claude Code reads `CLAUDE.md` automatically at session start, so you don't need to repeat the instructions.

## WSL Note

If Claude Code runs inside WSL2 and OpenCode also runs inside WSL2, `localhost:4096` works as expected. If OpenCode is on the Windows host and you're using WSL2 default NAT networking, point `PREFECT_SERVER_URL` at the Windows host IP instead of `localhost`.

> **Auto-start does not work when `PREFECT_SERVER_URL` is non-local.** Auto-start spawns `opencode serve` on the same machine as the MCP server, then health-polls `PREFECT_SERVER_URL`. If `PREFECT_SERVER_URL` points to a remote host (e.g. a Windows host IP from WSL2), the local spawn cannot satisfy the remote health check and auto-start will time out. Start OpenCode manually on the remote machine in this case.

## Project Layout

```
.
├── src/index.ts         # MCP server (40 tools)
├── build/               # Compiled output (gitignored)
├── .mcp.json            # Project-scoped Claude Code registration
├── CLAUDE.md            # Loop instructions for Claude Code
├── examples/
│   └── test-task.md     # End-to-end validation prompt
├── package.json
└── tsconfig.json
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/mcp` shows prefect as failed | `build/` missing | `npm run build` then restart Claude Code |
| `prefect_create_session` returns connection error | Auto-start failed (opencode not on PATH, or startup exceeded `PREFECT_AUTOSTART_TIMEOUT_MS`) | Check that `opencode` is on PATH; increase `PREFECT_AUTOSTART_TIMEOUT_MS` if slow to start; or start manually: `opencode serve --port 4096` from project root |
| `prefect_get_diff` returns files in wrong directory | OpenCode started from wrong directory | Stop and restart `opencode serve --port 4096` from the project root |
| `prefect_run` times out | Default 120s exceeded | Increase `PREFECT_TIMEOUT_MS` in `.mcp.json` env |
| `prefect_get_diff` returns `[]` | Prompt didn't ask OpenCode to write files | Re-prompt explicitly asking for a file write (see `examples/test-task.md` for a known-good prompt) |
| Tools missing in fresh Claude session | `.mcp.json` not committed or wrong scope | `claude mcp add --scope project prefect -- node build/index.js` |
