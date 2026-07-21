// legate-hry: session-management tools — session_list/get/status/messages/message/
// delete/rename/children/unrevert/command/init/summarize/todo/share/unshare. Moved
// verbatim from index.ts; shared state now arrives via ServerContext.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { ServerContext } from '../server-context.js';
import { resolveDirectory } from '../config.js';
import { readSessionMap, removeSession } from '../sessions.js';
import { apiError } from '../errors.js';
import { validateParts } from '../parts.js';
// legate-o1u: the real session_command input schema (shared home, imported by the test too).
import { SessionCommandInputSchema } from '../schemas.js';
// legate-ur1: response-size cap for legate_session_messages.
import { capMessagesResponse, maxResponseChars } from '../response-cap.js';

export function registerSession(server: McpServer, ctx: ServerContext): void {
  const {
    TIMEOUT_MS,
    getClient,
    resolveServerUrl,
    okJson,
    errText,
    handleNotFound,
    registerSessionTool,
    registerServerTool,
  } = ctx;

  // SESSION-01: List all OpenCode sessions
  registerServerTool(
    'legate_session_list',
    {
      description:
        'List all OpenCode sessions. Returns an array of Session objects each with id, title, directory, time.created, time.updated, and optional summary/share/revert fields. Pass directory to filter sessions by project root.',
      inputSchema: z.object({
        directory: z.string().optional().describe('Filter sessions by project directory path'),
      }),
    },
    async ({ client, dir }) => {
      const { data, error } = await client.session.list({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw apiError(error);
      return data;
    },
  );

  // SESSION-02: Fetch a single OpenCode session by ID
  registerSessionTool(
    'legate_session_get',
    {
      description:
        'Fetch a single OpenCode session by ID. Returns the full Session object including id, title, directory, parentID (if forked), and revert state.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID to fetch'),
        directory: z.string().optional().describe('Optional directory filter'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId } = args;
      const { data, error } = await client.session.get({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      return data;
    },
  );

  // SESSION-03: Get real-time status of ALL active sessions (global endpoint).
  // FIX: accepts optional sessionId to route to the correct server in multi-server
  // setups — without it, the default server would always be queried regardless of
  // which server owns the session.
  server.registerTool(
    'legate_session_status',
    {
      description:
        'Get the real-time status of active OpenCode sessions. Returns a map of sessionID → SessionStatus where status is one of: { type: "idle" }, { type: "busy" }, or { type: "retry", attempt, message, next }. Pass sessionId to scope the result to one session and route to the correct server (required when multiple servers are registered).',
      inputSchema: z.object({
        sessionId: z
          .string()
          .optional()
          .describe(
            'Optional: scope to a specific session and route to the server that owns it. If omitted, queries the default/first registered server.',
          ),
        directory: z.string().optional().describe('Optional directory filter'),
      }),
    },
    async ({ sessionId, directory }) => {
      const dir = resolveDirectory(directory);
      try {
        const serverUrl = sessionId ? resolveServerUrl(sessionId) : resolveServerUrl();
        const { data, error } = await getClient(serverUrl).session.status({
          query: dir ? { directory: dir } : undefined,
        });
        if (error) throw apiError(error);
        if (sessionId) {
          // Return just the requested session; treat missing-from-map as idle (consistent with legate_await)
          const entry = (data as Record<string, unknown>)[sessionId] ?? { type: 'idle' };
          return okJson({ [sessionId]: entry });
        }
        return okJson(data);
      } catch (err) {
        return errText(err);
      }
    },
  );

  // SESSION-04: Retrieve message history for a session (limit = most-recent-N, no cursor)
  registerSessionTool(
    'legate_session_messages',
    {
      description:
        'Retrieve the message history for an OpenCode session. Each message includes an info object (UserMessage or AssistantMessage) and a parts array (TextPart, ToolPart, PatchPart, etc.). Use limit to cap the number of messages returned — this returns the most recent N messages only; there is no cursor or offset. Omit limit to return all messages. When the response would exceed LEGATE_MAX_RESPONSE_CHARS characters (default 400000), the oldest messages are dropped and the result becomes { truncated: true, omittedMessages: n, messages: [...] }.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Maximum number of messages to return. Returns the most recent N messages — there is no offset or cursor. Omit to return all messages.',
          ),
        directory: z.string().optional().describe('Optional directory filter'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId, limit } = args;
      const { data, error } = await client.session.messages({
        path: { id: sessionId },
        query: { ...(limit !== undefined ? { limit } : {}), ...(dir ? { directory: dir } : {}) },
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      // legate-ur1: cap the payload so a long history cannot blow the MCP client's context.
      return capMessagesResponse((data ?? []) as unknown[], maxResponseChars());
    },
  );

  // SESSION-05: Fetch a single message by ID within a session
  registerSessionTool(
    'legate_session_message',
    {
      description:
        'Fetch a single message by ID within an OpenCode session. Returns the message info and all its parts (TextPart, ToolPart, PatchPart, etc.).',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID'),
        messageId: z.string().describe('Message ID to fetch'),
        directory: z.string().optional().describe('Optional directory filter'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId, messageId } = args;
      const { data, error } = await client.session.message({
        path: { id: sessionId, messageID: messageId }, // SDK path param is messageID (capital D)
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      return data;
    },
  );

  // SESSION-06: Delete a session permanently (irreversible)
  registerSessionTool(
    'legate_session_delete',
    {
      description:
        'Delete an OpenCode session and all its data permanently. Returns true on success. WARNING: this is irreversible — all messages, parts, and session history will be deleted. Consider using legate_session_rename to archive instead of deleting.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID to delete'),
        directory: z.string().optional().describe('Optional directory filter'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId } = args;
      const { data, error } = await client.session.delete({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      await removeSession(sessionId);
      return data;
    },
  );

  // SESSION-07: Rename a session — MCP tool is "rename" but SDK method is client.session.update()
  registerSessionTool(
    'legate_session_rename',
    {
      description: 'Rename an OpenCode session. Returns the full updated Session object.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID to rename'),
        title: z.string().describe('New display title for the session'),
        directory: z.string().optional().describe('Optional directory filter'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId, title } = args;
      const { data, error } = await client.session.update({
        // NOT client.session.rename — does not exist
        path: { id: sessionId },
        body: { title },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      return data;
    },
  );

  // SESSION-08: List child sessions forked from a parent session
  registerSessionTool(
    'legate_session_children',
    {
      description:
        'List all child sessions forked from a given PARENT session. sessionId must be the parent (the session that was forked FROM, not a child). Returns an empty array if no forks have been made from this session. Use legate_fork to create child sessions.',
      inputSchema: z.object({
        sessionId: z
          .string()
          .min(1)
          .describe('Parent session ID — the session that child forks were created from (not a child session ID)'),
        directory: z.string().optional().describe('Optional directory filter'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId } = args;
      const { data, error } = await client.session.children({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      // OpenCode only tracks sessions created with parentID (native children).
      // Fork-created sessions are tracked locally in sessions.json with parentId set.
      // Merge both sources, deduplicating by session id.
      const serverChildren: Array<{ id: string }> = (data as Array<{ id: string }>) ?? [];
      const serverChildIds = new Set(serverChildren.map((s) => s.id));
      const localMap = readSessionMap();
      const localChildren = Object.entries(localMap.sessions)
        .filter(([id, e]) => e.parentId === sessionId && !serverChildIds.has(id))
        .map(([id, e]) => ({ id, server: e.server, url: e.url }));
      return [...serverChildren, ...localChildren];
    },
  );

  // SESSION-09: Undo a prior revert — NO body (SessionUnrevertData.body is typed never)
  registerSessionTool(
    'legate_session_unrevert',
    {
      description:
        'Restore all messages removed by a prior legate_revert — undo the revert. Only valid if the session is in a reverted state (Session.revert field is non-null). Returns the updated Session object with the revert field cleared.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID to unrevert — must have been previously reverted'),
        directory: z.string().optional().describe('Optional directory filter'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId } = args;
      const { data, error } = await client.session.unrevert({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
        // NO body — SessionUnrevertData.body is typed `never`
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      return data;
    },
  );

  // CMD-01: Run a slash command inside an OpenCode session (e.g. /compact, /clear).
  // Calls POST /session/:id/command. Same response shape as legate_run:
  // { info: AssistantMessage, parts: Part[] }. Note that `model` here is a plain
  // string (e.g. "anthropic/claude-3-5-sonnet"), NOT a { providerID, modelID }
  // object — this is deliberate; the OpenCode command endpoint accepts a single
  // model string, unlike the prompt endpoint.
  registerSessionTool(
    'legate_session_command',
    {
      description:
        'Run a slash command inside an OpenCode session (e.g. compact, clear). Returns { info: AssistantMessage, parts: Part[] } as JSON. Use this for session-level operations that have no equivalent SDK method.',
      // legate-o1u: the ONE definition of this schema lives in ../schemas.ts (also imported
      // by session-command.test.ts, replacing its former phantom local copy).
      inputSchema: SessionCommandInputSchema,
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId, command, arguments: cmdArgs, messageID, agent, model } = args;
      const { data, error } = await client.session.command({
        path: { id: sessionId },
        body: {
          command,
          arguments: cmdArgs,
          ...(messageID ? { messageID } : {}),
          ...(agent ? { agent } : {}),
          ...(model ? { model } : {}),
        },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      if (!data) throw new Error('Session command returned no data');
      // legate-ngl: honest per-element validation; partsDropped surfaced only when > 0.
      const { parts: cmdParts, dropped } = validateParts((data as { parts?: unknown }).parts, 'legate_session_command');
      return {
        info: (data as { info?: unknown }).info,
        parts: cmdParts,
        ...(dropped ? { partsDropped: dropped } : {}),
      };
    },
  );

  // SESSION-13: Generate AGENTS.md for the session's project (with existence guard)
  server.registerTool(
    'legate_session_init',
    {
      description: `Initialize AGENTS.md for the session's project. Use this decision flow:

1. Call legate_session_init (no force).
   - AGENTS.md absent → endpoint called, model generates AGENTS.md. Returns { existed: false, accepted: true }.
   - AGENTS.md exists → endpoint NOT called. Returns { existed: true, content: "<current content>" }.

2. If existed: true, read the returned content and decide:
   - Content is good → use as-is, skip further init.
   - Needs additions → augment directly via file write or legate_run prompt.
   - Needs full re-initialization → call legate_session_init({ force: true }).

3. force: true always calls the endpoint. OpenCode rewrites AGENTS.md using model judgment — it preserves sections it deems worth keeping and drops others. Custom or hand-authored content can be lost. Returns { existed: <bool>, accepted: true }.

providerID, modelID, and messageID are all required. messageID is the ID assigned to the new user message created by this call — pass any unique string (e.g. a UUID); it is not a reference to an existing message. accepted: true confirms the command was accepted, not that the file was written or changed.

WARNING: If AGENTS.md is staged for deletion in git (shows as "D" in git status), OpenCode will treat it as absent but the model may still skip writing it — interpreting the git-deleted state as an intentional removal. Before calling, ensure AGENTS.md is either committed (present) or fully removed from both the working tree and git index (git rm --cached AGENTS.md && rm AGENTS.md). A file that is deleted on disk but still tracked will confuse the model.`,
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID'),
        providerID: z
          .string()
          .describe(
            'Required. Provider ID — must match a provider configured in the OpenCode server (e.g. "vllm"). Using an unconfigured provider returns ProviderModelNotFoundError.',
          ),
        modelID: z.string().describe('Required. Model ID. Must be available under the specified providerID.'),
        messageID: z
          .string()
          .describe(
            'Required. The ID assigned to the new user message created by this call. Must start with "msg" (e.g. "msg_" + Date.now(), or "msg" + a random suffix). UUID format is rejected. Not a reference to an existing message.',
          ),
        directory: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
        force: z
          .boolean()
          .optional()
          .describe(
            'Skip the existence guard and always call the endpoint. OpenCode will rewrite AGENTS.md — custom content can be lost. Use when explicitly re-initializing.',
          ),
      }),
    },
    async ({ sessionId, providerID, modelID, messageID, directory, force }) => {
      const dir = resolveDirectory(directory);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const agentsPath = dir ? path.join(dir, 'AGENTS.md') : null;

        if (!force && agentsPath && existsSync(agentsPath)) {
          clearTimeout(timer);
          const content = readFileSync(agentsPath, 'utf8');
          return okJson({ existed: true, content });
        }

        const existed = agentsPath ? existsSync(agentsPath) : false;
        const serverUrl = resolveServerUrl(sessionId);
        const { data, error } = await getClient(serverUrl).session.init({
          path: { id: sessionId },
          body: { providerID, modelID, messageID } as { modelID: string; providerID: string; messageID: string },
          query: dir ? { directory: dir } : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (error) await handleNotFound(error, sessionId, serverUrl);
        return okJson({ existed, accepted: data });
      } catch (err) {
        clearTimeout(timer);
        if ((err as Error).name === 'AbortError') {
          return errText(
            `legate_session_init timed out after ${TIMEOUT_MS / 1000}s — the OpenCode server did not return a response. ` +
              `This is a known upstream issue: the /session/{id}/init endpoint may not send a response on some OpenCode versions. ` +
              `Check whether AGENTS.md was created in the project directory anyway.`,
          );
        }
        return errText(err);
      }
    },
  );

  // SESSION-11: Trigger session summary generation
  registerSessionTool(
    'legate_session_summarize',
    {
      description:
        'Trigger summary generation for an OpenCode session. Returns true when the summarization was accepted. providerID and modelID are required — the endpoint has no default fallback. providerID must match a provider configured in the OpenCode server (e.g. "vllm" or "anthropic"); using an unconfigured provider returns ProviderModelNotFoundError.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID'),
        providerID: z
          .string()
          .describe(
            'Required. Provider ID for summarization — must match a provider configured in the OpenCode server (e.g. "vllm"). Using an unconfigured provider returns ProviderModelNotFoundError.',
          ),
        modelID: z
          .string()
          .describe('Required. Model ID for summarization. Must be available under the specified providerID.'),
        directory: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId, providerID, modelID } = args;
      const { data, error } = await client.session.summarize({
        path: { id: sessionId },
        body: { providerID, modelID },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      return data;
    },
  );

  // SESSION-12: Get the current todo list for a session
  registerSessionTool(
    'legate_session_todo',
    {
      description:
        'Get the current todo list for an OpenCode session. Returns Array<{ id, content, status, priority }> where status is one of pending/in_progress/completed/cancelled and priority is high/medium/low.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID'),
        directory: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId } = args;
      const { data, error } = await client.session.todo({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      return data;
    },
  );

  // SESSION-15: Make a session publicly shareable
  registerSessionTool(
    'legate_session_share',
    {
      description:
        'Make an OpenCode session publicly shareable. Returns the full Session object — after sharing, the share URL is available at session.share.url in the returned Session.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID to share'),
        directory: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId } = args;
      const { data, error } = await client.session.share({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      return data;
    },
  );

  // SESSION-16: Remove sharing from a session
  registerSessionTool(
    'legate_session_unshare',
    {
      description:
        'Remove public sharing from an OpenCode session. Returns the updated Session object with the share field cleared (session.share will be absent/undefined).',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID to unshare'),
        directory: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId } = args;
      const { data, error } = await client.session.unshare({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await handleNotFound(error, sessionId, serverUrl);
      return data;
    },
  );
}
