// legate-hry: composite workflow tools — delegate, dispatch, inspect, await. Moved
// verbatim from index.ts; shared state now arrives via ServerContext.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerContext } from '../server-context.js';
import { resolveDirectory } from '../config.js';
import { createSessionOnServer, runPrompt, getDiff } from '../handlers.js';
import { lookupSession } from '../sessions.js';
import { apiError, OpenCodeApiError, isNotFound } from '../errors.js';
import { validateParts } from '../parts.js';

export function registerComposites(server: McpServer, ctx: ServerContext): void {
  const {
    TIMEOUT_MS, getClient, resolveServerUrl,
    okJson, errText, handleNotFound, staleErrorResponse,
  } = ctx;

  // WORKFLOW-01 + WORKFLOW-02: Blocking composite — createSession → runPrompt → getDiff.
  // Returns { sessionId, result, diff } in one call, replicating the canonical three-step loop.
  // On timeout: aborts the session and returns isError:true (D-05).
  // Session kept alive after completion — caller decides when to delete (D-06).
  server.registerTool(
    'legate_delegate',
    {
      description:
        'Blocking composite: run a prompt and return { sessionId, result, diff } in one call. ' +
        'When sessionId is provided: reuses that existing session (server/title/directory ignored). ' +
        'When omitted: creates a new session on the named server (server defaults to first registered or LEGATE_SERVER_URL). ' +
        'Session stays alive after completion — call legate_session_delete to clean up. ' +
        'On timeout (LEGATE_TIMEOUT_MS exceeded): aborts the in-flight run (both new and reused sessions) and returns isError:true — session itself is kept alive. ' +
        'Note: does not support tools/files/messageID/agentInput/subtaskInput — use legate_create_session + legate_run directly for those features.',
      inputSchema: z.object({
        sessionId: z.string().optional().describe(
          'Reuse an existing session. When provided: server/title/directory are ignored; the session runs on its already-registered server. model/agent/system still apply as per-prompt overrides.'
        ),
        prompt: z.string().describe('The coding task or instruction to execute'),
        title: z.string().optional().describe('Optional display title for the created session'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var.'),
        model: z
          .object({ providerID: z.string(), modelID: z.string() })
          .optional()
          .describe('Override the model for this call. Both providerID and modelID required together.'),
        agent: z.string().optional().describe('Override the agent for this call.'),
        system: z.string().optional().describe('Override the system prompt for this call.'),
        server: z.string().min(1).optional().describe(
          "Named server from registry (legate list-servers). Omit to use the first registered server or LEGATE_SERVER_URL."
        ),
      }),
    },
    async ({ sessionId: providedSessionId, prompt, title, directory, model, agent, system, server: serverParam }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      if (providedSessionId) {
        // D-08: reuse path — skip createSession; server/directory/title ignored
        const sessionEntry = lookupSession(providedSessionId);
        if (!sessionEntry) {
          clearTimeout(timer);
          return errText(`Session '${providedSessionId}' not found in sessions registry. It may have been cleared or registered on a different MCP instance. Call legate_session_list to see active sessions.`);
        }
        try {
          const serverUrl = sessionEntry.url;
          const c = getClient(serverUrl);
          const result = await runPrompt(c, providedSessionId, prompt, { model, agent, system }, undefined, controller.signal);
          clearTimeout(timer);
          const diff = await getDiff(c, providedSessionId, undefined, undefined);
          return okJson({ sessionId: providedSessionId, result, diff });
        } catch (err) {
          clearTimeout(timer);
          if ((err as Error).name === 'AbortError') {
            try { await getClient(sessionEntry.url).session.abort({ path: { id: providedSessionId } }); } catch { /* swallow */ }
            return errText(`legate_delegate timed out after ${TIMEOUT_MS / 1000}s — session ${providedSessionId} run aborted`);
          }
          return errText(err);
        }
      }

      // Create-new-session path. legate-0ys(b): resolve-server → model-lookup →
      // createSession is now the shared createSessionOnServer helper.
      const dir = resolveDirectory(directory);
      let sessionId: string | undefined;
      try {
        const { session, client: c } = await createSessionOnServer(ctx, { title, dir, serverParam });
        sessionId = session.id;
        const result = await runPrompt(c, sessionId, prompt, { model, agent, system }, dir, controller.signal);
        clearTimeout(timer);
        const diff = await getDiff(c, sessionId, undefined, dir);
        return okJson({ sessionId, result, diff });
      } catch (err) {
        clearTimeout(timer);
        if ((err as Error).name === 'AbortError') {
          // sessionId may be undefined if abort fired during createSession
          if (sessionId) {
            try { await getClient(resolveServerUrl(sessionId)).session.abort({ path: { id: sessionId } }); } catch { /* swallow */ }
          }
          return errText(`legate_delegate timed out after ${TIMEOUT_MS / 1000}s${sessionId ? ` — session ${sessionId} aborted` : ' — during session creation'}`);
        }
        return errText(err);
      }
    }
  );

  // WORKFLOW-03: Non-blocking composite — createSession → promptAsync → return { sessionId }.
  // Returns immediately; session runs in background. Use legate_await or
  // legate_inspect to track progress. Same model/agent/system fields as legate_run.
  server.registerTool(
    'legate_dispatch',
    {
      description:
        'Non-blocking composite: fire a prompt asynchronously and return { sessionId } immediately — the agent runs in the background. ' +
        'When sessionId is provided: reuses that existing session (server/title/directory ignored). ' +
        'When omitted: creates a new session on the named server (server defaults to first registered or LEGATE_SERVER_URL). ' +
        'Use legate_await to poll for completion or legate_inspect to check status. ' +
        'Note: does not support tools/files/messageID/agentInput/subtaskInput — use legate_create_session + legate_prompt_async directly for those features.',
      inputSchema: z.object({
        sessionId: z.string().optional().describe(
          'Reuse an existing session. When provided: server/title/directory are ignored; the session runs on its already-registered server. model/agent/system still apply as per-prompt overrides.'
        ),
        prompt: z.string().describe('The coding task or instruction to execute'),
        title: z.string().optional().describe('Optional display title for the created session'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var.'),
        model: z
          .object({ providerID: z.string(), modelID: z.string() })
          .optional()
          .describe('Override the model for this call. Both providerID and modelID required together.'),
        agent: z.string().optional().describe('Override the agent for this call.'),
        system: z.string().optional().describe('Override the system prompt for this call.'),
        server: z.string().min(1).optional().describe(
          "Named server from registry (legate list-servers). Omit to use the first registered server or LEGATE_SERVER_URL."
        ),
      }),
    },
    async ({ sessionId: providedSessionId, prompt, title, directory, model, agent, system, server: serverParam }) => {
      if (providedSessionId) {
        // D-09: reuse path — skip createSession; server/directory/title ignored
        const sessionEntry = lookupSession(providedSessionId);
        if (!sessionEntry) {
          return errText(`Session '${providedSessionId}' not found in sessions registry. It may have been cleared or registered on a different MCP instance. Call legate_session_list to see active sessions.`);
        }
        try {
          const serverUrl = sessionEntry.url;
          const { error } = await getClient(serverUrl).session.promptAsync({
            path: { id: providedSessionId },
            body: {
              parts: [{ type: 'text', text: prompt }],
              ...(model ? { model } : {}),
              ...(agent ? { agent } : {}),
              ...(system ? { system } : {}),
            },
            // directory ignored in reuse mode per D-09
          });
          // serverUrl === sessionEntry.url === (re-looked-up) entry?.url, so handleNotFound's
          // serverUrl arg reproduces the original `entry?.url ?? serverUrl` text byte-for-byte.
          if (error) await handleNotFound(error, providedSessionId, serverUrl);
          return okJson({ sessionId: providedSessionId });
        } catch (err) {
          return errText(err);
        }
      }

      // Create-new-session path. legate-0ys(b): shared createSessionOnServer helper.
      const dir = resolveDirectory(directory);
      try {
        const { session, client: c } = await createSessionOnServer(ctx, { title, dir, serverParam });
        const { error } = await c.session.promptAsync({
          path: { id: session.id },
          body: {
            parts: [{ type: 'text', text: prompt }],
            ...(model ? { model } : {}),
            ...(agent ? { agent } : {}),
            ...(system ? { system } : {}),
          },
          query: dir ? { directory: dir } : undefined,
        });
        if (error) throw apiError(error);
        return okJson({ sessionId: session.id });
      } catch (err) {
        return errText(err);
      }
    }
  );

  // WORKFLOW-04: Compact snapshot — { status, todos, changedFiles }.
  // Calls three endpoints in parallel: session.status() (global map — index by sessionId),
  // session.todo() (requires path.id), session.diff() (mapped to { file, additions, deletions }
  // only — no patch content per D-10).
  server.registerTool(
    'legate_inspect',
    {
      description:
        'Return a compact snapshot { status, todos, changedFiles } for a session. Faster than fetching full message history. changedFiles contains { file, additions, deletions } — use legate_get_diff for full patch content.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID to inspect'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var.'),
      }),
    },
    async ({ sessionId, directory }) => {
      const dir = resolveDirectory(directory);
      try {
        const serverUrl = resolveServerUrl(sessionId);
        const c = getClient(serverUrl);
        const [statusResult, todoResult, diffResult] = await Promise.all([
          c.session.status({ query: dir ? { directory: dir } : undefined }),
          c.session.todo({ path: { id: sessionId }, query: dir ? { directory: dir } : undefined }),
          c.session.diff({ path: { id: sessionId }, query: dir ? { directory: dir } : undefined }),
        ]);
        // Stale-session detection: if either todo or diff (the sessionId-bearing calls) returns 404, treat as stale
        for (const r of [todoResult, diffResult]) {
          if (r.error && isNotFound(r.error)) await handleNotFound(r.error, sessionId, serverUrl);
        }
        if (statusResult.error) throw apiError(statusResult.error);
        if (todoResult.error) throw apiError(todoResult.error);
        if (diffResult.error) throw apiError(diffResult.error);
        const status = (statusResult.data as Record<string, { type: string }>)[sessionId]?.type ?? 'unknown';
        const todos = todoResult.data ?? [];
        const changedFiles = (diffResult.data ?? []).map((d) => ({
          file: d.file,
          additions: d.additions,
          deletions: d.deletions,
        }));
        return okJson({ status, todos, changedFiles });
      } catch (err) {
        return errText(err);
      }
    }
  );

  // WORKFLOW-05 + WORKFLOW-06: Poll session.status() until the session's type is "idle",
  // then reconstruct { result: { info, parts }, diff } from messages + diff endpoints.
  // pollIntervalMs default 2000, timeoutMs default TIMEOUT_MS (D-14).
  // On timeout: return isError:true with sessionId in payload (D-15).
  // Undefined status entry (session not in map) is treated as idle — OpenCode may have
  // already completed and removed the session from the status map before first poll.
  server.registerTool(
    'legate_await',
    {
      description:
        'Poll a dispatched session until it reaches idle state, then return { result: { info, parts }, diff }. Use after legate_dispatch. Accepts pollIntervalMs (default 2000) and timeoutMs (default LEGATE_TIMEOUT_MS).',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID from legate_dispatch'),
        pollIntervalMs: z.number().int().positive().optional().describe('Milliseconds between status polls. Default: 2000.'),
        timeoutMs: z.number().int().positive().optional().describe('Maximum milliseconds to wait. Default: LEGATE_TIMEOUT_MS env var (default 120000).'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var.'),
      }),
    },
    async ({ sessionId, pollIntervalMs = 2000, timeoutMs = TIMEOUT_MS, directory }) => {
      const dir = resolveDirectory(directory);
      const deadline = Date.now() + timeoutMs;
      try {
        const serverUrl = resolveServerUrl(sessionId);
        // Poll until idle or timeout.
        // Stuck-busy escape: if status stays "busy" for STALE_BUSY_THRESHOLD consecutive polls,
        // cross-check against message history. If the last message is a COMPLETED assistant
        // message the agent has finished but OpenCode's status map has not caught up — break
        // and treat as idle.
        // Upstream bug: https://github.com/anomalyco/opencode/issues/35472 — remove this
        // escape once fixed upstream and the SDK is bumped past the fix.
        // legate-tia: role === 'assistant' alone is NOT sufficient — OpenCode creates the
        // assistant message row (role set, zero parts) the instant the prompt is accepted,
        // so any task busy >10s would match and legate_await would return empty/partial
        // results (reproduced live: message existed 90s before generation finished).
        // info.time.completed is only set when the message is truly done (AssistantMessage
        // type: time: { created: number; completed?: number }).
        const STALE_BUSY_THRESHOLD = 5;
        let staleBusyCount = 0;
        while (true) {
          const { data, error } = await getClient(serverUrl).session.status({ query: dir ? { directory: dir } : undefined });
          if (error) throw apiError(error);
          const statusEntry = (data as Record<string, { type: string }>)[sessionId];
          // Treat undefined (session not in map) as idle — may have completed before first poll
          if (!statusEntry || statusEntry.type === 'idle') break;
          if (statusEntry.type === 'busy') {
            staleBusyCount++;
            if (staleBusyCount >= STALE_BUSY_THRESHOLD) {
              const msgResult = await getClient(serverUrl).session.messages({ path: { id: sessionId }, query: dir ? { directory: dir } : undefined });
              if (!msgResult.error && Array.isArray(msgResult.data) && msgResult.data.length > 0) {
                const lastMsg = msgResult.data[msgResult.data.length - 1] as { info: { role?: string; time?: { completed?: number } } };
                if (lastMsg.info.role === 'assistant' && lastMsg.info.time?.completed !== undefined) {
                  console.error(`[Legate] legate_await: breaking on stale busy — last message is a completed assistant message after ${staleBusyCount} busy polls (session ${sessionId})`);
                  break;
                }
              }
              staleBusyCount = 0;
            }
          } else {
            staleBusyCount = 0; // reset on retry or other non-busy state
          }
          if (Date.now() >= deadline) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: `legate_await timed out after ${timeoutMs}ms`, sessionId }) }],
              isError: true,
            };
          }
          await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
        }
        // Reconstruct result from messages (last assistant message) and full diff
        const [messagesResult, diff] = await Promise.all([
          getClient(serverUrl).session.messages({ path: { id: sessionId }, query: dir ? { directory: dir } : undefined }),
          getDiff(getClient(serverUrl), sessionId, undefined, dir),
        ]);
        if (messagesResult.error) await handleNotFound(messagesResult.error, sessionId, serverUrl);
        // D-12: find last assistant message — same shape as legate_run result
        const msgs = messagesResult.data ?? [];
        const last = [...msgs].reverse().find((m) => (m.info as { role?: string }).role === 'assistant');
        if (!last) throw new Error('legate_await: no assistant message found in session after idle');
        // legate-ngl: honest per-element validation; partsDropped surfaced only when > 0.
        const { parts: validatedParts, dropped } = validateParts(last.parts, 'legate_await');
        // D-13: return shape matches legate_delegate for easy substitution
        return okJson({ result: { info: last.info, parts: validatedParts, ...(dropped ? { partsDropped: dropped } : {}) }, diff });
      } catch (err) {
        // D-12 stale-session detection — getDiff/status throw OpenCodeApiError; legate-dxw: typed 404 check replaces JSON string-matching
        if (err instanceof OpenCodeApiError && err.isNotFound()) {
          return await staleErrorResponse(sessionId);
        }
        return errText(err);
      }
    }
  );
}
