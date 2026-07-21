// legate-hry: core loop tools — create_session, abort, run, prompt_async, get_diff,
// approve_permission, fork, revert. Moved verbatim from index.ts; the only change is
// that shared state (getClient / resolveServerUrl / envelopes / stale handlers /
// TIMEOUT_MS / BASE_URL) now arrives via the ServerContext instead of module globals.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerContext } from '../server-context.js';
import { resolveDirectory } from '../config.js';
import { createSessionOnServer, runPrompt, getDiff } from '../handlers.js';
// legate-8jm: aliased to avoid shadowing the `serverUrl` string arg in several handlers.
import { readRegistry, findServerByName, serverUrl as toServerUrl } from '../registry.js';
import { addSession, lookupSession, removeSession } from '../sessions.js';
import { apiError, OpenCodeApiError, isNotFound } from '../errors.js';
// legate-0ys(a): shared prompt-override schema fields + agent/agentInput XOR refine.
import { promptOverrideFields, agentXorRefineCheck, agentXorRefineMessage } from '../schemas.js';
// legate-ur1: response-size cap for legate_get_diff.
import { capDiffResponse, maxResponseChars } from '../response-cap.js';

export function registerCore(server: McpServer, ctx: ServerContext): void {
  const {
    BASE_URL, TIMEOUT_MS, getClient, resolveServerUrl,
    okJson, okText, errText, staleSessionMessage, handleNotFound, staleErrorResponse,
    registerSessionTool,
  } = ctx;

  // CORE-01: Create a new OpenCode session
  server.registerTool(
    'legate_create_session',
    {
      description: 'Create a new OpenCode coding session. Returns the Session object including the session id (ULID) used by all other tools. Pass directory to pin the session to a specific project root — required when OpenCode serves multiple projects from a single running instance.',
      inputSchema: z.object({
        title: z.string().optional().describe('Optional display title for the session'),
        parentID: z.string().optional().describe('Optional parent session ID — creates this session as a child of the given parent for hierarchy tracking.'),
        directory: z.string().optional().describe('Absolute path to the project root for this session. Defaults to the directory OpenCode was started from.'),
        server: z.string().min(1).optional().describe(
          "Named server from registry (legate list-servers). Omit to use the first registered server or LEGATE_SERVER_URL."
        ),
      }),
    },
    async ({ title, parentID, directory, server: serverParam }) => {
      const dir = resolveDirectory(directory);
      try {
        // legate-0ys(b): resolve-server → model-lookup → createSession is now one helper.
        const { session } = await createSessionOnServer(ctx, { title, dir, parentID, serverParam });
        return okJson(session);
      } catch (err) {
        return errText(err);
      }
    }
  );

  // CORE-07: Abort a running session
  server.registerTool(
    'legate_abort',
    {
      description:
        'Abort a running OpenCode session. Returns true on success.\n\n' +
        'Zombie fallback: when the session is not found in local sessions.json (e.g. after a ' +
        'context reset or crash), the tool falls through to the server HTTP endpoint directly. ' +
        'Specify `server` to target a known server, or omit to fan out to all registered servers.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID returned from legate_create_session'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
        server: z.string().min(1).optional().describe(
          'Server name (from registry) to target when the session is not in local sessions.json. ' +
          'If omitted and the session is unknown locally, all registered servers are tried.',
        ),
      }),
    },
    async ({ sessionId, directory, server: serverParam }) => {
      const dir = resolveDirectory(directory);
      try {
        // Fast path: session is in sessions.json — use the known URL.
        const entry = lookupSession(sessionId);
        if (entry) {
          const serverUrl = entry.url;
          const { data, error } = await getClient(serverUrl).session.abort({
            path: { id: sessionId },
            query: dir ? { directory: dir } : undefined,
          });
          if (error) {
            if (isNotFound(error)) {
              removeSession(sessionId);
              throw new Error(staleSessionMessage(sessionId, entry.server, serverUrl));
            }
            throw apiError(error);
          }
          return okText(String(data));
        }

        // Zombie fallback: session not in sessions.json (context reset / crash scenario).
        // Try the specified server, or fan out to every registered server.
        // legate-8jm: findServerByName + serverUrl() replace the inline find + concatenation.
        const reg = readRegistry();
        type Target = { name: string; url: string };
        let targets: Target[];
        if (serverParam) {
          const found = findServerByName(serverParam);
          if (!found) {
            throw new Error(
              `Server '${serverParam}' not found in registry. Run 'legate list-servers' to see registered servers.`,
            );
          }
          targets = [{ name: found.name, url: toServerUrl(found) }];
        } else {
          targets = reg.servers.length > 0
            ? reg.servers.map((s) => ({ name: s.name, url: toServerUrl(s) }))
            : [{ name: 'default', url: BASE_URL }];
        }

        const misses: string[] = [];
        for (const target of targets) {
          try {
            const { data, error } = await getClient(target.url).session.abort({
              path: { id: sessionId },
              query: dir ? { directory: dir } : undefined,
            });
            if (error) {
              if (isNotFound(error)) { misses.push(`${target.name} (${target.url}): not found`); continue; }
              throw apiError(error);
            }
            return okText(`Aborted zombie session ${sessionId} on server '${target.name}' (${target.url}). Result: ${String(data)}`);
          } catch (err) {
            misses.push(`${target.name} (${target.url}): ${String(err)}`);
          }
        }

        throw new Error(
          `Session ${sessionId} not found in sessions.json and abort failed on all tried servers:\n` +
          misses.map((m) => `  • ${m}`).join('\n') + '\n' +
          `The session may have already been deleted. Verify with: curl -s http://<host>:<port>/session/status`,
        );
      } catch (err) {
        return errText(err);
      }
    }
  );

  // CORE-02 + RUN-01/02/03 + INFRA-01 + SURF-02:
  // Run a prompt against an OpenCode session. Optional per-call overrides for
  // model (providerID + modelID required together), agent, and system prompt.
  // Uses AbortController so timeout cancels the in-flight TCP connection rather
  // than orphaning it (the previous Promise.race left the request running on
  // OpenCode after we gave up on it). Response parts are validated against
  // PartSchema in handlers.ts:runPrompt and returned as a structured { info, parts } payload.
  server.registerTool(
    'legate_run',
    {
      description:
        'Send a prompt to an OpenCode session and block until the agent finishes. Returns { info: AssistantMessage, parts: Part[] } as JSON. Optional model/agent/system override the session defaults for this single call. May take seconds to minutes depending on task complexity.',
      // legate-0ys(a): the 8 override fields + the agent/agentInput XOR refine are shared
      // with legate_prompt_async via ../schemas.ts (spread + refine — one definition).
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID from legate_create_session'),
        prompt: z.string().describe('The coding task or instruction to send'),
        directory: z.string().optional().describe('Routes this call to the OpenCode project at the specified path. Does not change the session\'s working directory. Falls back to LEGATE_DEFAULT_PROJECT env var.'),
        ...promptOverrideFields,
      }).refine(agentXorRefineCheck, { message: agentXorRefineMessage }),
    },
    async ({ sessionId, prompt, directory, model, agent, system, tools, files, messageID, agentInput, subtaskInput }) => {
      const dir = resolveDirectory(directory);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const serverUrl = resolveServerUrl(sessionId);
        const stored = lookupSession(sessionId)?.model;
        const effectiveModel = model ?? (stored?.providerID && stored?.modelID ? stored : undefined);
        const result = await runPrompt(getClient(serverUrl), sessionId, prompt, { model: effectiveModel, agent, system, tools, files, messageID, agentInput, subtaskInput }, dir, controller.signal);
        clearTimeout(timer);
        // Grace delay: OpenCode's status map updates asynchronously after the stream closes.
        // Poll for up to 2s so that a legate_session_status call immediately after legate_run
        // returns sees idle rather than a stale busy.
        // Upstream bug: https://github.com/anomalyco/opencode/issues/35472 — delete this
        // workaround once fixed upstream and the SDK is bumped past the fix.
        try {
          const graceDeadline = Date.now() + 2000;
          while (Date.now() < graceDeadline) {
            const { data } = await getClient(serverUrl).session.status({ query: dir ? { directory: dir } : undefined });
            const statusEntry = (data as Record<string, { type: string }> | null)?.[sessionId];
            if (!statusEntry || statusEntry.type !== 'busy') break;
            await new Promise<void>((r) => setTimeout(r, 250));
          }
        } catch { /* best-effort — never block the return on status lag */ }
        return okJson(result);
      } catch (err) {
        clearTimeout(timer);
        if ((err as Error).name === 'AbortError') {
          return errText(`legate_run timed out after ${TIMEOUT_MS / 1000}s — check LEGATE_SERVER_URL and model endpoint`);
        }
        // D-12 stale-session detection — runPrompt throws OpenCodeApiError; legate-dxw: typed 404 check replaces JSON string-matching
        if (err instanceof OpenCodeApiError && err.isNotFound()) {
          return staleErrorResponse(sessionId);
        }
        return errText(err);
      }
    }
  );

  // RUN-04: Fire-and-forget prompt — POST /session/:id/prompt_async returns 204 void.
  // Same body shape as legate_run (model/agent/system supported) but no timeout
  // because the API returns immediately. Use legate_session_status to poll for
  // completion.
  registerSessionTool(
    'legate_prompt_async',
    {
      description:
        'Send a prompt to an OpenCode session and return immediately without waiting for the agent to finish. Returns { sessionId, accepted: true } on success. Use legate_session_status to poll for completion, then legate_session_messages or legate_get_diff to retrieve results.',
      // legate-0ys(a): identical override fields + refine as legate_run, shared via ../schemas.ts.
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID from legate_create_session'),
        prompt: z.string().describe('The coding task or instruction to send'),
        directory: z.string().optional().describe('Routes this call to the OpenCode project at the specified path. Does not change the session\'s working directory. Falls back to LEGATE_DEFAULT_PROJECT env var.'),
        ...promptOverrideFields,
      }).refine(agentXorRefineCheck, { message: agentXorRefineMessage }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId, prompt, model, agent, system, tools, files, messageID, agentInput, subtaskInput } = args;
      const { error } = await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [
            { type: 'text', text: prompt },
            ...(files ?? []),
            ...(agentInput ? [agentInput] : []),
            ...(subtaskInput ? [subtaskInput] : []),
          ],
          ...(model ? { model } : {}),
          ...(agent ? { agent } : {}),
          ...(system ? { system } : {}),
          ...(tools ? { tools } : {}),
          ...(messageID ? { messageID } : {}),
        },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) handleNotFound(error, sessionId, serverUrl);
      return { sessionId, accepted: true };
    }
  );

  // CORE-03: Get the file diff for a session (or for a specific message)
  server.registerTool(
    'legate_get_diff',
    {
      description: 'Get the file diff for an OpenCode session. Returns an array of FileDiff objects (file, before, after, additions, deletions). If messageID is provided, returns the diff for that message; otherwise returns the diff for the session. When the response would exceed LEGATE_MAX_RESPONSE_CHARS characters (default 400000), it is capped: before/after content is dropped and patch strings are truncated, and the result becomes { truncated: true, files: [...] }.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID'),
        messageID: z.string().optional().describe('Optional message ID to scope the diff to a single message'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ sessionId, messageID, directory }) => {
      const dir = resolveDirectory(directory);
      try {
        const serverUrl = resolveServerUrl(sessionId);
        const diffs = await getDiff(getClient(serverUrl), sessionId, messageID, dir);
        // legate-ur1: cap the payload so a huge diff cannot blow the MCP client's context.
        return okJson(capDiffResponse(diffs, maxResponseChars()));
      } catch (err) {
        // D-12 stale-session detection — getDiff throws OpenCodeApiError; legate-dxw: typed 404 check replaces JSON string-matching
        if (err instanceof OpenCodeApiError && err.isNotFound()) {
          return staleErrorResponse(sessionId);
        }
        return errText(err);
      }
    }
  );

  // CORE-04: Respond to an OpenCode permission request
  // NOTE: REQUIREMENTS.md says allow/deny/allow_always — that's WRONG.
  // The OpenCode API enum is "once" | "always" | "reject" (verified from @opencode-ai/sdk types).
  registerSessionTool(
    'legate_approve_permission',
    {
      description: 'Respond to an OpenCode permission request. once = approve this request only; always = approve similar future requests; reject = deny.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID'),
        permissionId: z.string().describe('Permission request ID'),
        response: z.enum(['once', 'always', 'reject']).describe(
          'once = approve this request only; always = approve similar future requests; reject = deny'
        ),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId, permissionId, response } = args;
      // CRITICAL: permissions method is on TOP-LEVEL client, NOT client.session
      const { data, error } = await client.postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: permissionId },
        body: { response },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) handleNotFound(error, sessionId, serverUrl);
      return data;
    }
  );

  // CORE-05: Fork a session (escape hatch for corrupted sessions)
  server.registerTool(
    'legate_fork',
    {
      description: 'Fork an OpenCode session, optionally at a specific message. Returns a new Session. Use this as an escape hatch when a session has gone off the rails.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID to fork from'),
        messageID: z.string().optional().describe('Optional message ID to fork at; if omitted, forks at the current tip'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ sessionId, messageID, directory }) => {
      const dir = resolveDirectory(directory);
      try {
        const serverUrl = resolveServerUrl(sessionId);
        // Capture sourceEntry before the async fork call to avoid a race condition
        // where another process removes the session from sessions.json during the API call.
        const sourceEntry = lookupSession(sessionId);
        const { data, error } = await getClient(serverUrl).session.fork({
          path: { id: sessionId },
          ...(messageID ? { body: { messageID } } : {}),
          query: dir ? { directory: dir } : undefined,
        });
        if (error) {
          // legate-epe: fork uses sourceEntry (captured pre-await) instead of a fresh
          // lookupSession, so it cannot use handleNotFound — but reuses staleSessionMessage
          // for the ONE canonical text. The pre-capture avoids the race where another
          // process removes the session from sessions.json during the API call.
          if (isNotFound(error)) {
            removeSession(sessionId);
            throw new Error(staleSessionMessage(sessionId, sourceEntry?.server ?? 'unknown', serverUrl));
          }
          throw apiError(error);
        }
        // Persist the forked session so subsequent tool calls can route to the same server.
        // Store parentId so legate_session_children can find fork-created children locally.
        if (data && sourceEntry) {
          addSession((data as { id: string }).id, { ...sourceEntry, parentId: sessionId, createdAt: Date.now() });
        }
        return okJson(data);
      } catch (err) {
        return errText(err);
      }
    }
  );

  // CORE-06: Revert a session to a prior message
  registerSessionTool(
    'legate_revert',
    {
      description: 'Revert an OpenCode session to a prior message. messageID is required. Optionally scope to a specific part of that message via partID.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID'),
        messageID: z.string().describe('Required: message ID to revert to'),
        partID: z.string().optional().describe('Optional: specific part within the message'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId, messageID, partID } = args;
      const { data, error } = await client.session.revert({
        path: { id: sessionId },
        body: { messageID, ...(partID ? { partID } : {}) },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) handleNotFound(error, sessionId, serverUrl);
      return data;
    }
  );
}
