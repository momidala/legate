# Prefect v2.0 UAT — Full Acceptance Test

**Date:** 2026-05-04  
**Tester:** UAT Agent  
**Version:** package `@lbarchett/prefect-mcp` v1.1.2 (referred to as "v2.0" due to major feature additions)  
**Scope:** All tools, CLI commands, registry management, capacity enforcement, and session lifecycle

---

## Environment

### Configured OpenCode providers (from `~/.config/opencode/opencode.json`)

| Provider ID | Model ID | Base URL | Alias |
|---|---|---|---|
| `vllm` | `Qwen/Qwen3-Coder-30B-A3B-Instruct` | `http://192.168.1.4:8000/v1` | Thor |
| `mlx` | `mlx-community/Qwen3-Coder-Next-4bit` | `http://192.168.1.3:11434/v1` | Lab |

Default model in opencode.json: `vllm/Qwen/Qwen3-Coder-30B-A3B-Instruct`

### Prerequisites

Before starting:

1. OpenCode server is running: `opencode serve --port 4096`
2. `prefect-mcp` is built: `npm run build` in the supervisor repo
3. MCP server is registered in `.mcp.json` (or use `prefect init`)
4. The MCP server is connected in Claude Code (tool `prefect_list_agents` is callable)
5. Clean slate — remove stale state files:
   ```bash
   rm -f ~/.config/prefect/servers.json ~/.config/prefect/sessions.json
   ```
6. Working directory for session/run tests: a scratch directory `/tmp/prefect-uat`
   ```bash
   mkdir -p /tmp/prefect-uat
   cd /tmp/prefect-uat
   git init
   echo "# UAT scratch" > README.md
   git add . && git commit -m "init"
   ```
7. Set `SUPERVISOR_REPO` for file-introspection tests (T8.3–T8.7, T7.7):
   ```bash
   SUPERVISOR_REPO=/mnt/c/Users/larry/Documents/repos/personal/supervisor
   ```
   The fixture file `test/uat-dummy.ts` (committed) provides real TypeScript symbols for LSP indexing.

---

## Part 1 — CLI Commands

### T1.1 — `prefect init` writes `.mcp.json`

```bash
cd /tmp/prefect-uat
prefect init
```

**Pass:** `.mcp.json` created. Contains a `prefect` server entry with `build/index.js` or the installed bin path.  
**Fail:** File not created, or error output.

---

### T1.2 — `prefect add-server` registers a named server

```bash
prefect add-server thor localhost 4096 vllm "Qwen/Qwen3-Coder-30B-A3B-Instruct"
```

**Pass:** Output confirms "Registered server 'thor'". `servers.json` now contains an entry with `name: "thor"`, `host: "localhost"`, `port: 4096`, `providerID: "vllm"`, `modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct"`.  
**Fail:** Error, or `servers.json` missing/malformed.

---

### T1.3 — `prefect add-server` with `--max-sessions` capacity flag

```bash
prefect add-server lab localhost 4097 mlx "mlx-community/Qwen3-Coder-Next-4bit" --max-sessions 2
```

**Pass:** Server `lab` added with `maxSessions: 2`. CLAUDE.md in CWD updated to list both servers.  
**Note:** Port 4097 need not have an actual running server for this registry test.

---

### T1.4 — `prefect list-servers` displays all registered servers

```bash
prefect list-servers
```

**Pass:** Output is a formatted table with columns `NAME | HOST | PORT | PROVIDER | MODEL | CAPACITY`. Thor shows `unlimited`; Lab shows `2`. Long model IDs may be truncated in narrow terminals — that is acceptable.

---

### T1.5 — `prefect remove-server` deregisters a server

```bash
prefect remove-server lab
```

**Pass:** `lab` entry removed from `servers.json`. CLAUDE.md updated to remove `lab` from worker list.  
**Fail:** Error, or `lab` still present in list-servers output.

---

### T1.6 — CLAUDE.md auto-update on add/remove

After T1.5, run:
```bash
cat CLAUDE.md | grep -A5 "OpenCode Workers"
```

**Pass:** CLAUDE.md contains exactly one server entry (thor). No stale `lab` entry.

---

### T1.7 — Bad port rejected by `add-server`

```bash
prefect add-server bad localhost 99999 vllm model
```

**Pass:** Error message: port out of range (1–65535). No entry added to `servers.json`.

---

### T1.8 — Bad `--max-sessions` (float) rejected

```bash
prefect add-server bad localhost 4096 vllm model --max-sessions 1.5
```

**Pass:** Error message: must be a positive integer. No entry added.

---

## Part 2 — Server Routing and Session Creation

### T2.1 — `prefect_create_session` with named server routes to correct URL

```
prefect_create_session({ title: "UAT session thor", server: "thor", directory: "/tmp/prefect-uat" })
```

**Pass:** Returns `{ id: "<sessionId>", ... }`. Session persisted in `sessions.json` with `server: "thor"`.  
**Save:** `SESSION_ID_THOR = <returned id>`

---

### T2.2 — `prefect_create_session` without server uses first-in-registry (thor)

```
prefect_create_session({ title: "UAT default routing", directory: "/tmp/prefect-uat" })
```

**Pass:** Session created on thor (same URL as T2.1). `sessions.json` entry has `server: "thor"`.  
**Save:** `SESSION_ID_DEFAULT = <returned id>`

---

### T2.3 — `prefect_create_session` with unknown server returns clear error

```
prefect_create_session({ title: "bad server", server: "does-not-exist" })
```

**Pass:** Error: `Server 'does-not-exist' not found in registry. Run 'prefect list-servers'…`  
**Fail:** Generic connection error or silent failure.

---

### T2.4 — `prefect_session_list` returns active sessions

`prefect_session_list` without `directory` returns ALL sessions on the OpenCode server regardless of project. Pass `directory` to scope to a specific project.

```
prefect_session_list({ directory: "/tmp/prefect-uat" })
```

**Pass:** Returns array containing at least SESSION_ID_THOR and SESSION_ID_DEFAULT. Each entry has `id`, `title` fields. Note: `created` is nested under `time.created`, not top-level.

---

## Part 3 — Core Run Loop

### T3.1 — `prefect_run` executes a prompt and returns output

```
prefect_run({
  sessionId: SESSION_ID_THOR,
  prompt: "Write a single file hello.ts that logs 'UAT hello' to console.",
  directory: "/tmp/prefect-uat"
})
```

**Pass:** Returns a response object. No `isError: true`. The result contains model output text.  
**Time limit:** Completes within 120s.

---

### T3.2 — `prefect_get_diff` shows file changes after run

```
prefect_get_diff({ sessionId: SESSION_ID_THOR })
```

**Pass:** Returns `FileDiff[]`. At least one entry with `file` containing `hello.ts`. `additions` > 0.  
**Fail:** Empty array, or returns error.

---

### T3.3 — `prefect_run` correction loop (follow-up prompt)

```
prefect_run({
  sessionId: SESSION_ID_THOR,
  prompt: "Change the message to 'UAT hello v2'.",
  directory: "/tmp/prefect-uat"
})
```

**Pass:** Responds without error. `hello.ts` now contains `UAT hello v2` (verify with `cat /tmp/prefect-uat/hello.ts`).

---

### T3.4 — `prefect_session_messages` returns message history

```
prefect_session_messages({ sessionId: SESSION_ID_THOR })
```

**Pass:** Returns array of messages. At least 4 entries (2 user + 2 assistant turns from T3.1 and T3.3).  
Each message has `id`, `role`, `parts` fields.

---

### T3.5 — `prefect_session_message` returns a single message by ID

Take any `id` from T3.4, e.g., `MSG_ID_1`.

```
prefect_session_message({ sessionId: SESSION_ID_THOR, messageID: MSG_ID_1 })
```

**Pass:** Returns the single message matching `MSG_ID_1`.

---

## Part 4 — Session Control: Fork / Revert / Abort

### T4.1 — `prefect_revert` undoes the last message

Take the ID of the last user message from `prefect_session_messages`.

```
prefect_revert({ sessionId: SESSION_ID_THOR, messageID: LAST_MSG_ID })
```

**Pass:** Returns success. Session object has `revert.messageID` set (the virtual tip is moved back). Note: OpenCode 1.14.33 does NOT hide reverted messages from the messages list endpoint — message count will be unchanged. Verify by calling `prefect_session_get` and confirming the `revert` field is non-null.

---

### T4.2 — `prefect_session_unrevert` restores a reverted message

```
prefect_session_unrevert({ sessionId: SESSION_ID_THOR })
```

**Pass:** Messages restored to pre-revert count.

---

### T4.3 — `prefect_fork` creates a new session at a checkpoint

Take a message ID from early in the session (first assistant reply), `FORK_MSG_ID`.

```
prefect_fork({ sessionId: SESSION_ID_THOR, messageID: FORK_MSG_ID })
```

**Pass:** Returns new session object with a different `id`. New session has messages only up to `FORK_MSG_ID`. Note: `directory` in the forked session reflects the OpenCode server's working directory, not necessarily `/tmp/prefect-uat`.  
**Save:** `SESSION_ID_FORK = <returned id>`

---

### T4.4 — `prefect_session_children` shows fork lineage

```
prefect_session_children({ sessionId: SESSION_ID_THOR })
```

**Pass:** Returns array containing SESSION_ID_FORK.

---

### T4.5 — `prefect_abort` cancels an in-flight run (manual test)

Start a long run, then abort mid-flight:
```
prefect_run({ sessionId: SESSION_ID_FORK, prompt: "Write a 500-line TypeScript module with detailed comments for every function." })
```
Immediately call:
```
prefect_abort({ sessionId: SESSION_ID_FORK })
```

**Pass:** Abort returns success. The `prefect_run` call either returns with partial output or returns error mentioning abort. Server is not left in a hung state.  
**Note:** This test has a race condition — the run may complete before abort is called on slow connections. Acceptable if abort returns `{"aborted": true}` or similar.

---

## Part 5 — Delegate and Dispatch

### T5.1 — `prefect_delegate` creates a session and runs a prompt atomically

```
prefect_delegate({
  title: "Delegate UAT",
  prompt: "Create a file delegate-test.ts with a single exported function named greet that returns a string.",
  directory: "/tmp/prefect-uat",
  server: "thor"
})
```

**Pass:** Returns `{ sessionId, response }`. Session is created, prompt executed. `delegate-test.ts` exists in `/tmp/prefect-uat`.  
**Save:** `SESSION_ID_DELEGATE = <returned sessionId>`

---

### T5.2 — `prefect_delegate` with existing `sessionId` reuses the session

```
prefect_delegate({
  sessionId: SESSION_ID_DELEGATE,
  prompt: "Add a second exported function named farewell that returns a string.",
  directory: "/tmp/prefect-uat"
})
```

**Pass:** Runs in SESSION_ID_DELEGATE (no new session created). File now has both `greet` and `farewell`.  
**Partial:** If the call times out after PREFECT_TIMEOUT_MS and returns `isError: true` with "run aborted" — this is a model-speed issue, not a code defect. The session is kept alive and the in-flight run is aborted to prevent cascading busy state. Increase `PREFECT_TIMEOUT_MS` in `.mcp.json` if model is consistently slow.

---

### T5.3 — `prefect_dispatch` sends a fire-and-forget prompt

```
prefect_dispatch({
  title: "Dispatch UAT",
  prompt: "Create a file dispatch-test.ts with export const VERSION = '1.0.0'.",
  directory: "/tmp/prefect-uat",
  server: "thor"
})
```

**Pass:** Returns `{ sessionId }` immediately (does not block for completion).  
**Save:** `SESSION_ID_DISPATCH = <returned sessionId>`

---

### T5.4 — `prefect_await` polls until dispatch completes

```
prefect_await({ sessionId: SESSION_ID_DISPATCH })
```

**Pass:** Returns the last assistant message once the session is idle. `dispatch-test.ts` exists.  
**Time limit:** Completes within 120s.

---

### T5.5 — `prefect_inspect` returns full session state

```
prefect_inspect({ sessionId: SESSION_ID_DISPATCH })
```

**Pass:** Returns a compact snapshot `{ status, todos, changedFiles }`. No `isError: true`. (`prefect_inspect` is not a full session object — use `prefect_session_get` for full session details.)

---

### T5.6 — `prefect_session_status` returns running/idle status

`prefect_session_status` takes no `sessionId` — it returns a map of ALL sessions. `directory` is the only optional parameter.

```
prefect_session_status({ directory: "/tmp/prefect-uat" })
```

**Pass:** Returns a map `{ [sessionId]: { type: "busy" | "retry" } }` containing only **non-idle** sessions. An empty map `{}` is a valid response when all sessions are idle — it means no active runs. No `isError: true`.

---

## Part 6 — Capacity Enforcement (Phase 15.1)

### T6.1 — Re-register `lab` with `--max-sessions 1`

```bash
prefect add-server lab localhost 4096 vllm "Qwen/Qwen3-Coder-30B-A3B-Instruct" --max-sessions 1
```

**Pass:** `servers.json` has `lab` with `maxSessions: 1`.

---

### T6.2 — Create one session on `lab` (succeeds)

```
prefect_create_session({ title: "cap test 1", server: "lab", directory: "/tmp/prefect-uat" })
```

**Pass:** Session created. `sessions.json` shows one active session for server `lab`.  
**Save:** `SESSION_ID_CAP1 = <returned id>`

---

### T6.3 — Create a second session on `lab` (rejected at capacity)

```
prefect_create_session({ title: "cap test 2", server: "lab" })
```

**Pass:** Error contains: `Server 'lab' is at capacity (1/1 active sessions)`.  
**Fail:** Session created (capacity not enforced).

---

### T6.4 — Delete cap session and confirm capacity frees

```
prefect_session_delete({ sessionId: SESSION_ID_CAP1 })
```

Then retry:
```
prefect_create_session({ title: "cap test 2 retry", server: "lab", directory: "/tmp/prefect-uat" })
```

**Pass:** Second session now created successfully.

---

### T6.5 — Capacity enforced on `prefect_delegate` entry point

Re-create the cap situation (lab at 1/1), then:

```
prefect_delegate({
  title: "Delegate cap test",
  prompt: "echo test",
  server: "lab",
  directory: "/tmp/prefect-uat"
})
```

**Pass:** Returns capacity error (same message as T6.3).

---

### T6.6 — Capacity enforced on `prefect_dispatch` entry point

With lab still at capacity:

```
prefect_dispatch({
  title: "Dispatch cap test",
  prompt: "echo test",
  server: "lab"
})
```

**Pass:** Returns capacity error.

---

## Part 7 — Session Utilities

### T7.1 — `prefect_session_rename` changes the session title

```
prefect_session_rename({ sessionId: SESSION_ID_THOR, title: "UAT Thor (renamed)" })
```

**Pass:** `prefect_session_get({ sessionId: SESSION_ID_THOR })` returns `title: "UAT Thor (renamed)"`.

---

### T7.2 — `prefect_session_get` returns full session details

```
prefect_session_get({ sessionId: SESSION_ID_THOR })
```

**Pass:** Returns session object with `id` matching SESSION_ID_THOR. Note: `messages` is not a top-level field on the session object — use `prefect_session_messages` to retrieve message history separately.

---

### T7.3 — `prefect_session_summarize` accepts the request

```
prefect_session_summarize({
  sessionId: SESSION_ID_THOR,
  providerID: "vllm",
  modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct"
})
```

**Pass:** Returns `true` (async acceptance). No `isError: true`. The summary is generated asynchronously by the model — poll `prefect_session_messages` to retrieve it once the session is idle.

---

### T7.4 — `prefect_session_todo` returns a TODO list

```
prefect_session_todo({ sessionId: SESSION_ID_THOR })
```

**Pass:** Returns a structured TODO list or empty array. No error.

---

### T7.5 — `prefect_session_command` runs a slash command

First check what commands exist:
```
prefect_list_commands({ directory: "/tmp/prefect-uat" })
```

Then run `gsd-help` (always available). Note: `command` is the name WITHOUT a leading slash; `arguments` is required (pass empty string if none).
```
prefect_session_command({
  sessionId: SESSION_ID_THOR,
  command: "gsd-help",
  arguments: ""
})
```

**Pass:** Returns response without `isError: true`. (Use any available command from the list; skip this test if list is empty.)

---

### T7.6 — `prefect_session_shell` executes a shell command in session context

```
prefect_session_shell({
  sessionId: SESSION_ID_THOR,
  command: "echo 'UAT shell test'",
  agent: "general",
  directory: "/tmp/prefect-uat"
})
```

**Pass:** Response includes `UAT shell test` in output.  
**Fail:** Error, or agent name mismatch error (check `prefect_list_agents` for valid agent names).

---

### T7.7 — `prefect_session_init` creates AGENTS.md

(Run in a session whose project directory lacks AGENTS.md)

```bash
# Remove AGENTS.md. If it is git-tracked, also remove from the index so git does not
# show it as `D` (deleted) — the model treats a git-deleted file as intentionally removed
# and will skip writing it.
git -C $SUPERVISOR_REPO rm --cached AGENTS.md 2>/dev/null || true
rm -f $SUPERVISOR_REPO/AGENTS.md
```

```
prefect_session_init({
  sessionId: SESSION_ID_THOR,
  providerID: "vllm",
  modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  messageID: "msg_uat_init_01",
  directory: "/mnt/c/Users/larry/Documents/repos/personal/supervisor"
})
```

**Pass:** Returns `{ existed: false, accepted: true }`. AGENTS.md created in the supervisor repo.  
**Partial:** If `{ existed: false, accepted: true }` is returned but AGENTS.md was not written — the model accepted the request but skipped the write tool. This is known model behavior when git shows AGENTS.md as `D` (deleted); ensure the prerequisite `git rm --cached` step was run. Mark as PARTIAL.  
**Known issue (OpenCode 1.14.33):** The `/session/{id}/init` endpoint may never return an HTTP response on this OpenCode version. If so, Prefect will timeout after TIMEOUT_MS and return an `isError: true` response mentioning the upstream issue. Check whether AGENTS.md was created regardless. Mark as PARTIAL if file was created but tool returned timeout error.  
**Note:** Using the supervisor repo (not the sparse scratch dir) ensures the model has real code context to generate meaningful AGENTS.md content.

---

### T7.8 — `prefect_session_init` guard fires when AGENTS.md exists

```
prefect_session_init({
  sessionId: SESSION_ID_THOR,
  providerID: "vllm",
  modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  messageID: "msg_uat_init_02",
  directory: "/mnt/c/Users/larry/Documents/repos/personal/supervisor"
})
```

**Pass:** Returns `{ existed: true, content: "<current AGENTS.md content>" }`. Endpoint NOT called (model does not rewrite file).

---

### T7.9 — `prefect_session_init` with `force: true` bypasses guard

```
prefect_session_init({
  sessionId: SESSION_ID_THOR,
  providerID: "vllm",
  modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  messageID: "msg_uat_init_03",
  directory: "/mnt/c/Users/larry/Documents/repos/personal/supervisor",
  force: true
})
```

**Pass:** Returns `{ existed: true, accepted: true }`. Endpoint called. AGENTS.md may be rewritten.  
**Known issue (OpenCode 1.14.33):** Same timeout caveat as T7.7 — mark as PARTIAL if AGENTS.md was rewritten but tool returned timeout error.

---

### T7.10 — `prefect_session_init` rejects UUID as messageID

```bash
rm -f /mnt/c/Users/larry/Documents/repos/personal/supervisor/AGENTS.md
```

```
prefect_session_init({
  sessionId: SESSION_ID_THOR,
  providerID: "vllm",
  modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  messageID: "550e8400-e29b-41d4-a716-446655440000",
  directory: "/mnt/c/Users/larry/Documents/repos/personal/supervisor"
})
```

**Pass:** Error response (UUID rejected by OpenCode). messageID must start with `msg`.  
**Note:** Based on Phase 11 UAT findings — this is a known constraint.

---

### T7.11 — `prefect_session_share` makes a session shareable

```
prefect_session_share({ sessionId: SESSION_ID_THOR })
```

**Pass:** Returns Session object. `session.share.url` is populated (non-null string).  
**Save:** `SHARE_URL = session.share.url`

---

### T7.12 — `prefect_session_unshare` removes sharing

```
prefect_session_unshare({ sessionId: SESSION_ID_THOR })
```

**Pass:** Returns success. Subsequent `prefect_session_get` shows `share` field as null or removed.

---

## Part 8 — API Introspection Tools

### T8.1 — `prefect_list_providers` returns configured providers

```
prefect_list_providers({ directory: "/tmp/prefect-uat" })
```

**Pass:** Returns array containing at least `{ id: "vllm", name: "vLLM (Thor)", models: [...] }`. Both `vllm` and `mlx` providers appear (per opencode.json).

---

### T8.2 — `prefect_list_agents` returns configured agents

```
prefect_list_agents({ directory: "/tmp/prefect-uat" })
```

**Pass:** Returns array of agent objects. At minimum `general` agent is present.

---

### T8.3 — `prefect_find_symbol` finds a TypeScript symbol

> **EXPERIMENTAL — Skip unless testing LSP specifically.** As of OpenCode 1.14.33, the `/find/symbol` endpoint returns `[]` even when the TypeScript LSP is running and has indexed the file. The LSP client does not implement `workspace/symbol` requests in this version; the endpoint is not yet wired to the LSP protocol.
>
> **Requirements when this does work (future OpenCode versions):**
> 1. `"lsp": true` must be set in `~/.config/opencode/opencode.json`
> 2. `typescript-language-server` must be installed globally (`npm install -g typescript-language-server typescript`)
> 3. A session must have opened/edited a TypeScript file to trigger `textDocument/didOpen` before querying

```
prefect_find_symbol({
  query: "greet",
  directory: "/mnt/c/Users/larry/Documents/repos/personal/supervisor"
})
```

**Pass:** Returns array with at least one entry pointing to `test/uat-dummy.ts`.  
**Skip:** If OpenCode version ≤ 1.14.33 — workspace symbol search not implemented. Mark as SKIP.  
**Note:** Uses the supervisor repo (not the scratch dir) — LSP indexing requires a real TypeScript project with tsconfig.json.

---

### T8.4 — `prefect_find_file` finds files by name pattern

```
prefect_find_file({
  query: "uat-dummy",
  directory: "/mnt/c/Users/larry/Documents/repos/personal/supervisor"
})
```

**Pass:** Returns array containing path to `test/uat-dummy.ts`.

---

### T8.5 — `prefect_get_file_content` returns file content

```
prefect_get_file_content({
  path: "test/uat-dummy.ts",
  directory: "/mnt/c/Users/larry/Documents/repos/personal/supervisor"
})
```

**Pass:** Returns `{ type: "text", content: "<file contents>" }`. Content contains `greet` and `farewell` functions.

---

### T8.6 — `prefect_vcs_info` returns git branch

```
prefect_vcs_info({ directory: "/tmp/prefect-uat" })
```

**Pass:** Returns an object containing `branch: "master"` (or `"main"`, whichever branch was created in the prerequisite `git init`). The response may also include `default_branch` — both keys are valid. Presence of either or both is a pass.

---

### T8.7 — `prefect_file_status` returns modified files

First make a change to the committed fixture:
```bash
echo "// uat-modified" >> /mnt/c/Users/larry/Documents/repos/personal/supervisor/test/uat-dummy.ts
```

```
prefect_file_status({
  directory: "/mnt/c/Users/larry/Documents/repos/personal/supervisor"
})
```

**Pass:** Returns array with `test/uat-dummy.ts` having `status: "modified"`.  
**Cleanup:** `git checkout -- test/uat-dummy.ts` after the test.

---

### T8.8 — `prefect_list_mcp_servers` returns MCP server status map

```
prefect_list_mcp_servers({
  directory: "/mnt/c/Users/larry/Documents/repos/personal/supervisor"
})
```

**Pass:** Returns object `{ [serverName]: McpStatus }`. At minimum one server entry appears.  
**Note:** MCP server visibility depends on the OpenCode host's project-level config. An empty map `{}` is acceptable if no MCP servers are configured for this project on the OpenCode host — this is not a Prefect defect.

---

### T8.9 — `prefect_get_config` returns OpenCode config

```
prefect_get_config({ directory: "/tmp/prefect-uat" })
```

**Pass:** Returns JSON config object. `model` field matches `vllm/Qwen/Qwen3-Coder-30B-A3B-Instruct`. Provider entries for `vllm` and `mlx` present.  
**WARNING:** Do NOT log or paste raw output — may contain credentials.

---

### T8.10 — `prefect_list_commands` returns slash commands

```
prefect_list_commands({ directory: "/tmp/prefect-uat" })
```

**Pass:** Returns `Array<{ name, description?, template, ... }>`. No error.

---

### T8.11 — `prefect_list_tools` without provider/model returns all tool IDs

```
prefect_list_tools({})
```

**Pass:** Returns `Array<string>` of tool ID strings. Non-empty.

---

### T8.12 — `prefect_list_tools` with provider+model returns tool details

```
prefect_list_tools({
  provider: "vllm",
  model: "Qwen/Qwen3-Coder-30B-A3B-Instruct"
})
```

**Pass:** Returns `Array<{ id, description, parameters }>`.

---

### T8.13 — `prefect_list_tools` with only provider (no model) returns error

```
prefect_list_tools({ provider: "vllm" })
```

**Pass:** Error: `provider and model must be supplied together`.

---

### T8.14 — `prefect_inject_mcp_server` adds a local MCP server at runtime

```
prefect_inject_mcp_server({
  name: "uat-test-server",
  configType: "local",
  commandArgs: ["node", "/tmp/prefect-uat/nonexistent.js"],
  enabled: false
})
```

**Pass:** Returns updated MCP status map containing `uat-test-server` (status may be `disabled` or `failed` since it's disabled/nonexistent — that's fine).  
**Fail:** Error thrown by Prefect layer (not by OpenCode responding with a known error status).

---

### T8.15 — `prefect_inject_mcp_server` without commandArgs rejects local config

```
prefect_inject_mcp_server({
  name: "bad-local",
  configType: "local"
})
```

**Pass:** Error: `commandArgs is required when configType is "local"`.

---

### T8.16 — `prefect_prompt_async` sends non-blocking prompt

Note: model override uses a nested `model` object, not top-level `providerID`/`modelID`.

```
prefect_prompt_async({
  sessionId: SESSION_ID_FORK,
  prompt: "What is 2+2?",
  model: { providerID: "vllm", modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct" },
  messageID: "msg_uat_async_01",
  directory: "/tmp/prefect-uat"
})
```

**Pass:** Returns `{ sessionId: SESSION_ID_FORK, accepted: true }` immediately without blocking.

---

## Part 9 — Stale Session Routing Guard

### T9.1 — Stale session ID returns clear not-found error

Use a made-up session ID that doesn't exist:

```
prefect_run({ sessionId: "nonexistent_session_id_xyz", prompt: "test" })
```

**Pass:** Error contains: `Session 'nonexistent_session_id_xyz' not found in sessions.json`.  
**Fail:** Generic connection error, silent `{}` response, or silent hang.

---

### T9.2 — `prefect_session_delete` removes session from registry

```
prefect_session_delete({ sessionId: SESSION_ID_DEFAULT })
```

**Pass:** Returns success. `prefect_session_list` no longer includes SESSION_ID_DEFAULT.

---

## Part 10 — Autostart (Optional — requires no running server)

> **Note:** This test requires temporarily stopping the OpenCode server.

### T10.1 — `prefect_create_session` autostarts OpenCode when server is down

```bash
pkill -f "opencode serve" || true
```

Then immediately:
```
prefect_create_session({ title: "autostart test", server: "thor", directory: "/tmp/prefect-uat" })
```

**Pass:** Session created successfully (Prefect spawned `opencode serve`, health-polled, then connected). May take up to 30s.  
**Fail:** Error after timeout without autostart attempt.

---

## Summary Scorecard

| Part | Area | Tests | Pass | Fail | Skip |
|------|------|-------|------|------|------|
| 1 | CLI Commands | 8 | | | |
| 2 | Server Routing + Session Creation | 4 | | | |
| 3 | Core Run Loop | 5 | | | |
| 4 | Fork / Revert / Abort | 5 | | | |
| 5 | Delegate and Dispatch | 6 | | | |
| 6 | Capacity Enforcement | 6 | | | |
| 7 | Session Utilities | 12 | | | |
| 8 | API Introspection | 16 | | | |
| 9 | Stale Session Guard | 2 | | | |
| 10 | Autostart | 1 | | | |
| **Total** | | **65** | | | |

---

## Known Constraints (from prior UAT sessions)

1. `messageID` must start with `msg` — UUIDs are rejected by OpenCode (Phase 11 finding).
2. `providerID` must match a provider configured in the connected OpenCode server's `opencode.json`.
3. Before re-running UAT, delete `~/.config/prefect/servers.json` and `sessions.json` to avoid stale entries causing list-servers crash.
4. `add-server` uses `providerID` and `modelID` as separate fields (not a flat `model` string).
5. Sessions persist across server restarts only if `sessions.json` is intact — if the OpenCode server is replaced/restarted, `sessions.json` entries pointing to old session IDs will return 404 and should be cleaned up.
6. `prefect_session_init` on a sparse/empty directory with no relevant code may produce a minimal or empty AGENTS.md even with `force: true` — this is expected model behavior.
7. `prefect_find_symbol` (T8.3) is non-functional in OpenCode ≤ 1.14.33 — the `/find/symbol` endpoint returns `[]` because `workspace/symbol` LSP requests are not yet implemented. Mark T8.3 as SKIP on this version.
8. LSP features require two setup steps: (a) `"lsp": true` in `~/.config/opencode/opencode.json`, and (b) `npm install -g typescript-language-server typescript`. Without these, OpenCode logs "all LSPs are disabled" and all LSP-backed endpoints fail silently.

---

## UAT Sign-off

| Criterion | Status |
|---|---|
| All Part 1–3 (core loop) tests pass | |
| All Part 6 capacity tests pass | |
| All Part 9 stale session guard tests pass | |
| No unexpected hangs or silent failures | |
| No `isError: true` on happy-path tests | |

**Overall verdict:** PASS / FAIL / CONDITIONAL PASS  
**Notes:**
