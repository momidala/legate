# End-to-End Test Task: Validate Full Loop

This task validates that the full Prefect loop works after setup. Run it once after a fresh setup to confirm `.mcp.json` is registered, OpenCode is reachable on `http://localhost:4096`, and the create -> run -> diff -> commit cycle produces a real diff in git history.

## Prerequisites

Before running this task:
1. `npm install && npm run build` has been run (otherwise the MCP server cannot start; `build/index.js` does not exist).
2. `opencode serve --port 4096` is running **from the project root** in another terminal (verify: `curl http://localhost:4096/global/health` returns `{"healthy":true,...}`). OpenCode fixes its working directory at startup — sessions created from a wrong-directory server will write files there, not here.
3. Claude Code has been opened in the project root and `/mcp` shows `prefect` as connected.

## The Prompt

Send this exact prompt to OpenCode via `prefect_run`:

> Create a file at `examples/hello.ts` that exports a function `greet(name: string): string` which returns `'Hello, ' + name + '!'`. At the bottom of the file, add the line: `console.log(greet('World'));`

This prompt is intentionally specified in full so the model has no ambiguity. The prompt must instruct OpenCode to write a file — Phase 1 UAT proved that prompts which only ask for a text reply return an empty diff.

## Steps

Claude Code (or a human operator) executes the following 6 steps in order:

1. **Create session.** Call `prefect_create_session` with `{title: "test-task"}`. Save the returned `id` as `SESSION_ID`.
2. **Run prompt.** Call `prefect_run` with `{sessionId: SESSION_ID, prompt: <the prompt above>}`. Wait for it to return (up to 120 seconds — the default `PREFECT_TIMEOUT_MS`).
3. **Get diff.** Call `prefect_get_diff` with `{sessionId: SESSION_ID}`. Confirm the returned array contains at least one `FileDiff` whose `file` field references `examples/hello.ts`. If the array is empty, the loop failed — re-run step 2 with a correction prompt or fork the session.
4. **Read file.** Read `examples/hello.ts` from disk. Confirm it contains the substring `greet` and a call to `console.log`.
5. **Commit.** Run `git add examples/hello.ts && git commit -m "test: validate full prefect loop"`.
6. **Done.** The diff is now in git history. The full loop works.

## Success Assertions

The test passed if and only if ALL of these are true:
- `prefect_get_diff` returned a non-empty array (at least 1 FileDiff entry).
- At least one FileDiff has a `file` field that includes `hello.ts`.
- `examples/hello.ts` exists on disk after step 4.
- `examples/hello.ts` contains the substring `greet`.
- `git log --oneline -1` after step 5 shows the commit message starting with `test: validate full prefect loop`.

## Failure Modes

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `/mcp` does not list prefect | Build missing or `.mcp.json` malformed | `npm run build`, restart Claude Code, check `.mcp.json` is valid JSON |
| `prefect_create_session` fails with connection error | OpenCode not running or wrong port | Start `opencode serve --port 4096`; verify with `curl http://localhost:4096/global/health` |
| `prefect_run` times out | Model is slow or task too large | Increase `PREFECT_TIMEOUT_MS` env var; for this task 120000ms is sufficient |
| `prefect_get_diff` returns `[]` | OpenCode replied without writing files | Run step 2 again with a more explicit prompt; this exact prompt has been validated |

## After Success

Delete `examples/hello.ts` if you do not want it tracked long-term:
```bash
git rm examples/hello.ts
git commit -m "chore: remove validation artifact"
```

Or keep it as a permanent example of OpenCode-generated output.
