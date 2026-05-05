#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createOpencodeClient } from '@opencode-ai/sdk';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fetchWithAuth } from './fetch.js';
import { resolveDirectory } from './config.js';
import { PartSchema } from './parts.js';
import { createSession, runPrompt, getDiff } from './handlers.js';
import { readRegistry } from './registry.js';
import { addSession, lookupSession, removeSession, readSessionMap } from './sessions.js';

// CORE-08: Base URL from PREFECT_SERVER_URL env var (OPENCODE_URL accepted with deprecation warning)
const BASE_URL =
  process.env.PREFECT_SERVER_URL ??
  (() => {
    const old = process.env.OPENCODE_URL;
    if (old) console.error('[Prefect] OPENCODE_URL is deprecated, use PREFECT_SERVER_URL');
    return old;
  })() ??
  'http://localhost:4096';
const TIMEOUT_MS = parseInt(process.env.PREFECT_TIMEOUT_MS ?? '', 10) || 120_000;

// D-01..D-03: per-URL client cache. Replaces the single global client so the
// MCP server can route tool calls to multiple OpenCode instances.
const clientCache = new Map<string, ReturnType<typeof createOpencodeClient>>();

function getClient(serverUrl: string): ReturnType<typeof createOpencodeClient> {
  let c = clientCache.get(serverUrl);
  if (!c) {
    c = createOpencodeClient({ baseUrl: serverUrl, fetch: fetchWithAuth });
    clientCache.set(serverUrl, c);
  }
  return c;
}

// D-06: server URL resolution fallback chain.
//   1. sessionId → sessions.json lookup → that session's server URL
//   2. serverName (entry points only) → registry lookup by name
//   3. no inputs → first entry in registry
//   4. registry empty → BASE_URL (PREFECT_SERVER_URL env var)
// D-07: unknown serverName throws with the exact message below.
function resolveServerUrl(sessionId?: string, serverName?: string): string {
  if (sessionId) {
    const entry = lookupSession(sessionId);
    if (entry) return entry.url;
    throw new Error(
      `Session '${sessionId}' not found in sessions.json. It may have been deleted or never created via prefect_create_session.`,
    );
  }
  if (serverName) {
    const reg = readRegistry();
    const found = reg.servers.find((s) => s.name === serverName);
    if (!found) {
      throw new Error(
        `Server '${serverName}' not found in registry. Run 'prefect list-servers' to see registered servers.`,
      );
    }
    return `http://${found.host}:${found.port}`;
  }
  const reg = readRegistry();
  if (reg.servers.length > 0) {
    const s = reg.servers[0];
    return `http://${s.host}:${s.port}`;
  }
  return BASE_URL;
}

// D-12 helper: SDK returns { data, error } pairs; 404 surfaces as either { status: 404 }
// or { name: 'NotFoundError' } depending on the SDK version and endpoint.
// Without this check, every API error (400, 403, 500) would be treated as a stale session.
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as Record<string, unknown>;
  return e.status === 404 || e.name === 'NotFoundError';
}

// Resolve the canonical server name for a URL — used by entry points to write
// sessions.json with both name and URL (D-08). Falls back to the supplied
// serverParam (entry point's optional input) or the literal 'default' when
// no registry match exists (registry-empty fallback path).
function serverNameForUrl(serverUrl: string, serverParam?: string): string {
  if (serverParam) return serverParam;
  const reg = readRegistry();
  const found = reg.servers.find((s) => `http://${s.host}:${s.port}` === serverUrl);
  return found?.name ?? 'default';
}

export { resolveDirectory };

const packageVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const server = new McpServer({ name: 'prefect', version: packageVersion });

// CORE-01: Create a new OpenCode session
server.registerTool(
  'prefect_create_session',
  {
    description: 'Create a new OpenCode coding session. Returns the Session object including the session id (ULID) used by all other tools. Pass directory to pin the session to a specific project root — required when OpenCode serves multiple projects from a single running instance.',
    inputSchema: z.object({
      title: z.string().optional().describe('Optional display title for the session'),
      parentID: z.string().optional().describe('Optional parent session ID — creates this session as a child of the given parent for hierarchy tracking.'),
      directory: z.string().optional().describe('Absolute path to the project root for this session. Defaults to the directory OpenCode was started from.'),
      server: z.string().min(1).optional().describe(
        "Named server from registry (prefect list-servers). Omit to use the first registered server or PREFECT_SERVER_URL."
      ),
    }),
  },
  async ({ title, parentID, directory, server: serverParam }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(undefined, serverParam);
      const serverName = serverNameForUrl(serverUrl, serverParam);
      const reg = readRegistry();
      const serverEntry = reg.servers.find((s) => s.name === serverName);
      const model = (serverEntry?.providerID && serverEntry?.modelID)
        ? { providerID: serverEntry.providerID, modelID: serverEntry.modelID }
        : undefined;
      const session = await createSession(getClient(serverUrl), title, dir, parentID, serverUrl, serverName, model, serverEntry?.maxSessions);
      return { content: [{ type: 'text', text: JSON.stringify(session) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// CORE-07: Abort a running session
server.registerTool(
  'prefect_abort',
  {
    description: 'Abort a running OpenCode session. Returns true on success.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID returned from prefect_create_session'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ sessionId, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.abort({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: String(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
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
  'prefect_run',
  {
    description:
      'Send a prompt to an OpenCode session and block until the agent finishes. Returns { info: AssistantMessage, parts: Part[] } as JSON. Optional model/agent/system override the session defaults for this single call. May take seconds to minutes depending on task complexity.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID from prefect_create_session'),
      prompt: z.string().describe('The coding task or instruction to send'),
      directory: z.string().optional().describe('Routes this call to the OpenCode project at the specified path. Does not change the session\'s working directory. Falls back to OPENCODE_DEFAULT_PROJECT env var.'),
      // RUN-01: model override — both providerID AND modelID required together
      model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
        })
        .optional()
        .describe('Override the model for this single call. Both providerID and modelID are required together.'),
      // RUN-02: agent override
      agent: z.string().optional().describe('Override the agent for this single call.'),
      // RUN-03: system prompt override
      system: z.string().optional().describe('Override the system prompt for this single call.'),
      // RUN-05: tools override — CRITICAL: record (Map<string, boolean>), NOT array of strings
      tools: z.record(z.string(), z.boolean()).optional()
        .describe('Override enabled tools for this call. Map of tool ID to boolean enable/disable flag. Example: { "bash": true, "edit": false }'),
      // RUN-06: file attachments — FilePartInput shape (use file:// URIs for local files)
      files: z.array(z.object({
        type: z.literal('file'),
        mime: z.string(),
        filename: z.string().optional(),
        url: z.string().refine(
          (u) => u.startsWith('file://'),
          { message: 'files[].url must be a file:// URI' }
        ),
      })).optional()
        .describe('File attachments to include as context. Each file requires mime type and url (use file:// URIs for local paths).'),
      // RUN-07: message ID assignment (idempotency key for user message creation)
      messageID: z.string().optional()
        .describe('Assign a specific ID to the new user message being created. If a message with this ID already exists in the session, OpenCode returns the cached response (idempotency — useful for safe retries). Omit to auto-generate. For branching a conversation at a prior message point, use prefect_fork instead.'),
      // RUN-08: structured agent part input (distinct from the top-level agent string override)
      agentInput: z.object({
        type: z.literal('agent'),
        name: z.string(),
      }).optional()
        .describe('Structured agent part input — specify the agent name for this prompt. Distinct from the top-level agent string override.'),
      // RUN-08: structured subtask part input
      subtaskInput: z.object({
        type: z.literal('subtask'),
        prompt: z.string(),
        description: z.string(),
        agent: z.string(),
      }).optional()
        .describe('Structured subtask part input — delegate a subtask to a specific agent.'),
    }).refine(
      (v) => !(v.agent && v.agentInput),
      { message: 'Provide either agent or agentInput, not both — they are mutually exclusive overrides' }
    ),
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
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        return {
          content: [
            {
              type: 'text',
              text: `prefect_run timed out after ${TIMEOUT_MS / 1000}s — check PREFECT_SERVER_URL and model endpoint`,
            },
          ],
          isError: true,
        };
      }
      // D-12 stale-session detection inside the JSON-encoded error string from runPrompt
      if (typeof (err as Error).message === 'string' && (
        (err as Error).message.includes('"status":404') ||
        (err as Error).message.includes('"NotFoundError"')
      )) {
        const entry = lookupSession(sessionId);
        removeSession(sessionId);
        const staleUrl = entry?.url ?? resolveServerUrl();
        return {
          content: [{ type: 'text', text:
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${staleUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`
          }], isError: true,
        };
      }
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// RUN-04: Fire-and-forget prompt — POST /session/:id/prompt_async returns 204 void.
// Same body shape as prefect_run (model/agent/system supported) but no timeout
// because the API returns immediately. Use prefect_session_status to poll for
// completion.
server.registerTool(
  'prefect_prompt_async',
  {
    description:
      'Send a prompt to an OpenCode session and return immediately without waiting for the agent to finish. Returns { sessionId, accepted: true } on success. Use prefect_session_status to poll for completion, then prefect_session_messages or prefect_get_diff to retrieve results.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID from prefect_create_session'),
      prompt: z.string().describe('The coding task or instruction to send'),
      directory: z.string().optional().describe('Routes this call to the OpenCode project at the specified path. Does not change the session\'s working directory. Falls back to OPENCODE_DEFAULT_PROJECT env var.'),
      model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
        })
        .optional()
        .describe('Override the model for this single call. Both providerID and modelID are required together.'),
      agent: z.string().optional().describe('Override the agent for this single call.'),
      system: z.string().optional().describe('Override the system prompt for this single call.'),
      // RUN-05: tools override — CRITICAL: record (Map<string, boolean>), NOT array of strings
      tools: z.record(z.string(), z.boolean()).optional()
        .describe('Override enabled tools for this call. Map of tool ID to boolean enable/disable flag. Example: { "bash": true, "edit": false }'),
      // RUN-06: file attachments — FilePartInput shape (use file:// URIs for local files)
      files: z.array(z.object({
        type: z.literal('file'),
        mime: z.string(),
        filename: z.string().optional(),
        url: z.string().refine(
          (u) => u.startsWith('file://'),
          { message: 'files[].url must be a file:// URI' }
        ),
      })).optional()
        .describe('File attachments to include as context. Each file requires mime type and url (use file:// URIs for local paths).'),
      // RUN-07: message ID assignment (idempotency key for user message creation)
      messageID: z.string().optional()
        .describe('Assign a specific ID to the new user message being created. If a message with this ID already exists in the session, OpenCode returns the cached response (idempotency — useful for safe retries). Omit to auto-generate. For branching a conversation at a prior message point, use prefect_fork instead.'),
      // RUN-08: structured agent part input (distinct from the top-level agent string override)
      agentInput: z.object({
        type: z.literal('agent'),
        name: z.string(),
      }).optional()
        .describe('Structured agent part input — specify the agent name for this prompt. Distinct from the top-level agent string override.'),
      // RUN-08: structured subtask part input
      subtaskInput: z.object({
        type: z.literal('subtask'),
        prompt: z.string(),
        description: z.string(),
        agent: z.string(),
      }).optional()
        .describe('Structured subtask part input — delegate a subtask to a specific agent.'),
    }).refine(
      (v) => !(v.agent && v.agentInput),
      { message: 'Provide either agent or agentInput, not both — they are mutually exclusive overrides' }
    ),
  },
  async ({ sessionId, prompt, directory, model, agent, system, tools, files, messageID, agentInput, subtaskInput }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { error } = await getClient(serverUrl).session.promptAsync({
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
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return {
        content: [
          { type: 'text', text: JSON.stringify({ sessionId, accepted: true }) },
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// CORE-03: Get the file diff for a session (or for a specific message)
server.registerTool(
  'prefect_get_diff',
  {
    description: 'Get the file diff for an OpenCode session. Returns an array of FileDiff objects (file, before, after, additions, deletions). If messageID is provided, returns the diff for that message; otherwise returns the diff for the session.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID'),
      messageID: z.string().optional().describe('Optional message ID to scope the diff to a single message'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ sessionId, messageID, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const diffs = await getDiff(getClient(serverUrl), sessionId, messageID, dir);
      return { content: [{ type: 'text', text: JSON.stringify(diffs) }] };
    } catch (err) {
      // D-12 stale-session detection inside the JSON-encoded error string from getDiff
      if (typeof (err as Error).message === 'string' && (
        (err as Error).message.includes('"status":404') ||
        (err as Error).message.includes('"NotFoundError"')
      )) {
        const entry = lookupSession(sessionId);
        removeSession(sessionId);
        const staleUrl = entry?.url ?? resolveServerUrl();
        return {
          content: [{ type: 'text', text:
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${staleUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`
          }], isError: true,
        };
      }
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// CORE-04: Respond to an OpenCode permission request
// NOTE: REQUIREMENTS.md says allow/deny/allow_always — that's WRONG.
// The OpenCode API enum is "once" | "always" | "reject" (verified from @opencode-ai/sdk types).
server.registerTool(
  'prefect_approve_permission',
  {
    description: 'Respond to an OpenCode permission request. once = approve this request only; always = approve similar future requests; reject = deny.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID'),
      permissionId: z.string().describe('Permission request ID'),
      response: z.enum(['once', 'always', 'reject']).describe(
        'once = approve this request only; always = approve similar future requests; reject = deny'
      ),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ sessionId, permissionId, response, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      // CRITICAL: permissions method is on TOP-LEVEL client, NOT client.session
      const { data, error } = await getClient(serverUrl).postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: permissionId },
        body: { response },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// CORE-05: Fork a session (escape hatch for corrupted sessions)
server.registerTool(
  'prefect_fork',
  {
    description: 'Fork an OpenCode session, optionally at a specific message. Returns a new Session. Use this as an escape hatch when a session has gone off the rails.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID to fork from'),
      messageID: z.string().optional().describe('Optional message ID to fork at; if omitted, forks at the current tip'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var if not provided.'),
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
        if (isNotFound(error)) {
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${sourceEntry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      // Persist the forked session so subsequent tool calls can route to the same server.
      // Store parentId so prefect_session_children can find fork-created children locally.
      if (data && sourceEntry) {
        addSession((data as { id: string }).id, { ...sourceEntry, parentId: sessionId });
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// CORE-06: Revert a session to a prior message
server.registerTool(
  'prefect_revert',
  {
    description: 'Revert an OpenCode session to a prior message. messageID is required. Optionally scope to a specific part of that message via partID.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID'),
      messageID: z.string().describe('Required: message ID to revert to'),
      partID: z.string().optional().describe('Optional: specific part within the message'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ sessionId, messageID, partID, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.revert({
        path: { id: sessionId },
        body: { messageID, ...(partID ? { partID } : {}) },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-01: List all OpenCode sessions
server.registerTool(
  'prefect_session_list',
  {
    description: 'List all OpenCode sessions. Returns an array of Session objects each with id, title, directory, time.created, time.updated, and optional summary/share/revert fields. Pass directory to filter sessions by project root.',
    inputSchema: z.object({
      directory: z.string().optional().describe('Filter sessions by project directory path'),
    }),
  },
  async ({ directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).session.list({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-02: Fetch a single OpenCode session by ID
server.registerTool(
  'prefect_session_get',
  {
    description: 'Fetch a single OpenCode session by ID. Returns the full Session object including id, title, directory, parentID (if forked), and revert state.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID to fetch'),
      directory: z.string().optional().describe('Optional directory filter'),
    }),
  },
  async ({ sessionId, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.get({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-03: Get real-time status of ALL active sessions (global endpoint — no sessionId param)
server.registerTool(
  'prefect_session_status',
  {
    description: 'Get the real-time status of all active OpenCode sessions. Returns a map of sessionID → SessionStatus where status is one of: { type: "idle" }, { type: "busy" }, or { type: "retry", attempt, message, next }. Use this before calling prefect_run to verify the target session is idle and not still processing a previous prompt.',
    inputSchema: z.object({
      directory: z.string().optional().describe('Optional directory filter'),
    }),
  },
  async ({ directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).session.status({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-04: Retrieve message history for a session (limit = most-recent-N, no cursor)
server.registerTool(
  'prefect_session_messages',
  {
    description: 'Retrieve the message history for an OpenCode session. Each message includes an info object (UserMessage or AssistantMessage) and a parts array (TextPart, ToolPart, PatchPart, etc.). Use limit to cap the number of messages returned — this returns the most recent N messages only; there is no cursor or offset. Omit limit to return all messages.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID'),
      limit: z.number().int().positive().optional().describe(
        'Maximum number of messages to return. Returns the most recent N messages — there is no offset or cursor. Omit to return all messages.'
      ),
      directory: z.string().optional().describe('Optional directory filter'),
    }),
  },
  async ({ sessionId, limit, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.messages({
        path: { id: sessionId },
        query: { ...(limit !== undefined ? { limit } : {}), ...(dir ? { directory: dir } : {}) },
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-05: Fetch a single message by ID within a session
server.registerTool(
  'prefect_session_message',
  {
    description: 'Fetch a single message by ID within an OpenCode session. Returns the message info and all its parts (TextPart, ToolPart, PatchPart, etc.).',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID'),
      messageId: z.string().describe('Message ID to fetch'),
      directory: z.string().optional().describe('Optional directory filter'),
    }),
  },
  async ({ sessionId, messageId, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.message({
        path: { id: sessionId, messageID: messageId },  // SDK path param is messageID (capital D)
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-06: Delete a session permanently (irreversible)
server.registerTool(
  'prefect_session_delete',
  {
    description: 'Delete an OpenCode session and all its data permanently. Returns true on success. WARNING: this is irreversible — all messages, parts, and session history will be deleted. Consider using prefect_session_rename to archive instead of deleting.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID to delete'),
      directory: z.string().optional().describe('Optional directory filter'),
    }),
  },
  async ({ sessionId, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.delete({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      removeSession(sessionId);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-07: Rename a session — MCP tool is "rename" but SDK method is client.session.update()
server.registerTool(
  'prefect_session_rename',
  {
    description: 'Rename an OpenCode session. Returns the full updated Session object.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID to rename'),
      title: z.string().describe('New display title for the session'),
      directory: z.string().optional().describe('Optional directory filter'),
    }),
  },
  async ({ sessionId, title, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.update({  // NOT client.session.rename — does not exist
        path: { id: sessionId },
        body: { title },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-08: List child sessions forked from a parent session
server.registerTool(
  'prefect_session_children',
  {
    description: 'List all child sessions forked from a given PARENT session. sessionId must be the parent (the session that was forked FROM, not a child). Returns an empty array if no forks have been made from this session. Use prefect_fork to create child sessions.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Parent session ID — the session that child forks were created from (not a child session ID)'),
      directory: z.string().optional().describe('Optional directory filter'),
    }),
  },
  async ({ sessionId, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.children({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      // OpenCode only tracks sessions created with parentID (native children).
      // Fork-created sessions are tracked locally in sessions.json with parentId set.
      // Merge both sources, deduplicating by session id.
      const serverChildren: Array<{ id: string }> = (data as Array<{ id: string }>) ?? [];
      const serverChildIds = new Set(serverChildren.map((s) => s.id));
      const localMap = readSessionMap();
      const localChildren = Object.entries(localMap.sessions)
        .filter(([id, e]) => e.parentId === sessionId && !serverChildIds.has(id))
        .map(([id, e]) => ({ id, server: e.server, url: e.url }));
      const merged = [...serverChildren, ...localChildren];
      return { content: [{ type: 'text', text: JSON.stringify(merged) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-09: Undo a prior revert — NO body (SessionUnrevertData.body is typed never)
server.registerTool(
  'prefect_session_unrevert',
  {
    description: 'Restore all messages removed by a prior prefect_revert — undo the revert. Only valid if the session is in a reverted state (Session.revert field is non-null). Returns the updated Session object with the revert field cleared.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID to unrevert — must have been previously reverted'),
      directory: z.string().optional().describe('Optional directory filter'),
    }),
  },
  async ({ sessionId, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.unrevert({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
        // NO body — SessionUnrevertData.body is typed `never`
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// CMD-01: Run a slash command inside an OpenCode session (e.g. /compact, /clear).
// Calls POST /session/:id/command. Same response shape as prefect_run:
// { info: AssistantMessage, parts: Part[] }. Note that `model` here is a plain
// string (e.g. "anthropic/claude-3-5-sonnet"), NOT a { providerID, modelID }
// object — this is deliberate; the OpenCode command endpoint accepts a single
// model string, unlike the prompt endpoint.
server.registerTool(
  'prefect_session_command',
  {
    description:
      'Run a slash command inside an OpenCode session (e.g. compact, clear). Returns { info: AssistantMessage, parts: Part[] } as JSON. Use this for session-level operations that have no equivalent SDK method.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID'),
      command: z.string().describe('The slash command name without the leading slash (e.g. "compact")'),
      arguments: z.string().describe('Arguments string to pass to the command (use empty string if none)'),
      messageID: z.string().optional().describe('Optional message ID for context'),
      agent: z.string().optional().describe('Optional agent override'),
      model: z
        .string()
        .optional()
        .describe('Optional model override as a plain string (NOT { providerID, modelID } — this endpoint takes a single string).'),
      directory: z.string().optional().describe('Routes this call to the OpenCode project at the specified path. Does not change the session\'s working directory. Falls back to OPENCODE_DEFAULT_PROJECT env var.'),
    }),
  },
  async ({ sessionId, command, arguments: args, messageID, agent, model, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.command({
        path: { id: sessionId },
        body: {
          command,
          arguments: args,
          ...(messageID ? { messageID } : {}),
          ...(agent ? { agent } : {}),
          ...(model ? { model } : {}),
        },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      if (!data) throw new Error('Session command returned no data');
      const cmdParseResult = PartSchema.array().safeParse((data as { parts?: unknown }).parts);
      if (!cmdParseResult.success) {
        console.error('PartSchema validation warning (prefect_session_command):', cmdParseResult.error.message);
      }
      const cmdParts = cmdParseResult.success ? cmdParseResult.data : (data as { parts?: unknown }).parts;
      return { content: [{ type: 'text', text: JSON.stringify({ info: (data as { info?: unknown }).info, parts: cmdParts }) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// WORKFLOW-01 + WORKFLOW-02: Blocking composite — createSession → runPrompt → getDiff.
// Returns { sessionId, result, diff } in one call, replicating the canonical three-step loop.
// On timeout: aborts the session and returns isError:true (D-05).
// Session kept alive after completion — caller decides when to delete (D-06).
server.registerTool(
  'prefect_delegate',
  {
    description:
      'Blocking composite: run a prompt and return { sessionId, result, diff } in one call. ' +
      'When sessionId is provided: reuses that existing session (server/title/directory ignored). ' +
      'When omitted: creates a new session on the named server (server defaults to first registered or PREFECT_SERVER_URL). ' +
      'Session stays alive after completion — call prefect_session_delete to clean up. ' +
      'On timeout (PREFECT_TIMEOUT_MS exceeded): aborts the in-flight run (both new and reused sessions) and returns isError:true — session itself is kept alive. ' +
      'Note: does not support tools/files/messageID/agentInput/subtaskInput — use prefect_create_session + prefect_run directly for those features.',
    inputSchema: z.object({
      sessionId: z.string().optional().describe(
        'Reuse an existing session. When provided: server/title/directory are ignored; the session runs on its already-registered server. model/agent/system still apply as per-prompt overrides.'
      ),
      prompt: z.string().describe('The coding task or instruction to execute'),
      title: z.string().optional().describe('Optional display title for the created session'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var.'),
      model: z
        .object({ providerID: z.string(), modelID: z.string() })
        .optional()
        .describe('Override the model for this call. Both providerID and modelID required together.'),
      agent: z.string().optional().describe('Override the agent for this call.'),
      system: z.string().optional().describe('Override the system prompt for this call.'),
      server: z.string().min(1).optional().describe(
        "Named server from registry (prefect list-servers). Omit to use the first registered server or PREFECT_SERVER_URL."
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
        return {
          content: [{ type: 'text', text: `Session '${providedSessionId}' not found in sessions registry. It may have been cleared or registered on a different MCP instance. Call prefect_session_list to see active sessions.` }],
          isError: true,
        };
      }
      try {
        const serverUrl = sessionEntry.url;
        const c = getClient(serverUrl);
        const result = await runPrompt(c, providedSessionId, prompt, { model, agent, system }, undefined, controller.signal);
        clearTimeout(timer);
        const diff = await getDiff(c, providedSessionId, undefined, undefined);
        return { content: [{ type: 'text', text: JSON.stringify({ sessionId: providedSessionId, result, diff }) }] };
      } catch (err) {
        clearTimeout(timer);
        if ((err as Error).name === 'AbortError') {
          try { await getClient(sessionEntry.url).session.abort({ path: { id: providedSessionId } }); } catch { /* swallow */ }
          return {
            content: [{ type: 'text', text: `prefect_delegate timed out after ${TIMEOUT_MS / 1000}s — session ${providedSessionId} run aborted` }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: String(err) }], isError: true };
      }
    }

    // Create-new-session path (existing logic — unchanged)
    const dir = resolveDirectory(directory);
    let sessionId: string | undefined;
    try {
      const serverUrl = resolveServerUrl(undefined, serverParam);
      const serverName = serverNameForUrl(serverUrl, serverParam);
      const c = getClient(serverUrl);
      const reg2 = readRegistry();
      const serverEntry2 = reg2.servers.find((s) => s.name === serverName);
      const model2 = (serverEntry2?.providerID && serverEntry2?.modelID)
        ? { providerID: serverEntry2.providerID, modelID: serverEntry2.modelID }
        : undefined;
      const session = await createSession(c, title, dir, undefined, serverUrl, serverName, model2, serverEntry2?.maxSessions);
      sessionId = session.id;
      const result = await runPrompt(c, sessionId, prompt, { model, agent, system }, dir, controller.signal);
      clearTimeout(timer);
      const diff = await getDiff(c, sessionId, undefined, dir);
      return { content: [{ type: 'text', text: JSON.stringify({ sessionId, result, diff }) }] };
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        // sessionId may be undefined if abort fired during createSession
        if (sessionId) {
          try { await getClient(resolveServerUrl(sessionId)).session.abort({ path: { id: sessionId } }); } catch { /* swallow */ }
        }
        return {
          content: [{ type: 'text', text: `prefect_delegate timed out after ${TIMEOUT_MS / 1000}s${sessionId ? ` — session ${sessionId} aborted` : ' — during session creation'}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// WORKFLOW-03: Non-blocking composite — createSession → promptAsync → return { sessionId }.
// Returns immediately; session runs in background. Use prefect_await or
// prefect_inspect to track progress. Same model/agent/system fields as prefect_run.
server.registerTool(
  'prefect_dispatch',
  {
    description:
      'Non-blocking composite: fire a prompt asynchronously and return { sessionId } immediately — the agent runs in the background. ' +
      'When sessionId is provided: reuses that existing session (server/title/directory ignored). ' +
      'When omitted: creates a new session on the named server (server defaults to first registered or PREFECT_SERVER_URL). ' +
      'Use prefect_await to poll for completion or prefect_inspect to check status. ' +
      'Note: does not support tools/files/messageID/agentInput/subtaskInput — use prefect_create_session + prefect_prompt_async directly for those features.',
    inputSchema: z.object({
      sessionId: z.string().optional().describe(
        'Reuse an existing session. When provided: server/title/directory are ignored; the session runs on its already-registered server. model/agent/system still apply as per-prompt overrides.'
      ),
      prompt: z.string().describe('The coding task or instruction to execute'),
      title: z.string().optional().describe('Optional display title for the created session'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var.'),
      model: z
        .object({ providerID: z.string(), modelID: z.string() })
        .optional()
        .describe('Override the model for this call. Both providerID and modelID required together.'),
      agent: z.string().optional().describe('Override the agent for this call.'),
      system: z.string().optional().describe('Override the system prompt for this call.'),
      server: z.string().min(1).optional().describe(
        "Named server from registry (prefect list-servers). Omit to use the first registered server or PREFECT_SERVER_URL."
      ),
    }),
  },
  async ({ sessionId: providedSessionId, prompt, title, directory, model, agent, system, server: serverParam }) => {
    if (providedSessionId) {
      // D-09: reuse path — skip createSession; server/directory/title ignored
      const sessionEntry = lookupSession(providedSessionId);
      if (!sessionEntry) {
        return {
          content: [{ type: 'text', text: `Session '${providedSessionId}' not found in sessions registry. It may have been cleared or registered on a different MCP instance. Call prefect_session_list to see active sessions.` }],
          isError: true,
        };
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
        if (error) {
          if (isNotFound(error)) {
            const entry = lookupSession(providedSessionId);
            removeSession(providedSessionId);
            throw new Error(
              `Session ${providedSessionId} not found on server '${entry?.server ?? 'unknown'}' (${entry?.url ?? serverUrl}).\n` +
              `The session may have been deleted or the server restarted.\n` +
              `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`
            );
          }
          throw new Error(JSON.stringify(error));
        }
        return { content: [{ type: 'text', text: JSON.stringify({ sessionId: providedSessionId }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: String(err) }], isError: true };
      }
    }

    // Create-new-session path (existing logic — unchanged)
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(undefined, serverParam);
      const serverName = serverNameForUrl(serverUrl, serverParam);
      const c = getClient(serverUrl);
      const reg2 = readRegistry();
      const serverEntry2 = reg2.servers.find((s) => s.name === serverName);
      const model2 = (serverEntry2?.providerID && serverEntry2?.modelID)
        ? { providerID: serverEntry2.providerID, modelID: serverEntry2.modelID }
        : undefined;
      const session = await createSession(c, title, dir, undefined, serverUrl, serverName, model2, serverEntry2?.maxSessions);
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
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify({ sessionId: session.id }) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// WORKFLOW-04: Compact snapshot — { status, todos, changedFiles }.
// Calls three endpoints in parallel: session.status() (global map — index by sessionId),
// session.todo() (requires path.id), session.diff() (mapped to { file, additions, deletions }
// only — no patch content per D-10).
server.registerTool(
  'prefect_inspect',
  {
    description:
      'Return a compact snapshot { status, todos, changedFiles } for a session. Faster than fetching full message history. changedFiles contains { file, additions, deletions } — use prefect_get_diff for full patch content.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID to inspect'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var.'),
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
        if (r.error && isNotFound(r.error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
      }
      if (statusResult.error) throw new Error(JSON.stringify(statusResult.error));
      if (todoResult.error) throw new Error(JSON.stringify(todoResult.error));
      if (diffResult.error) throw new Error(JSON.stringify(diffResult.error));
      const status = (statusResult.data as Record<string, { type: string }>)[sessionId]?.type ?? 'unknown';
      const todos = todoResult.data ?? [];
      const changedFiles = (diffResult.data ?? []).map((d) => ({
        file: d.file,
        additions: d.additions,
        deletions: d.deletions,
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ status, todos, changedFiles }) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
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
  'prefect_await',
  {
    description:
      'Poll a dispatched session until it reaches idle state, then return { result: { info, parts }, diff }. Use after prefect_dispatch. Accepts pollIntervalMs (default 2000) and timeoutMs (default PREFECT_TIMEOUT_MS).',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID from prefect_dispatch'),
      pollIntervalMs: z.number().int().positive().optional().describe('Milliseconds between status polls. Default: 2000.'),
      timeoutMs: z.number().int().positive().optional().describe('Maximum milliseconds to wait. Default: PREFECT_TIMEOUT_MS env var (default 120000).'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var.'),
    }),
  },
  async ({ sessionId, pollIntervalMs = 2000, timeoutMs = TIMEOUT_MS, directory }) => {
    const dir = resolveDirectory(directory);
    const deadline = Date.now() + timeoutMs;
    try {
      const serverUrl = resolveServerUrl(sessionId);
      // Poll until idle or timeout
      while (true) {
        const { data, error } = await getClient(serverUrl).session.status({ query: dir ? { directory: dir } : undefined });
        if (error) throw new Error(JSON.stringify(error));
        const statusEntry = (data as Record<string, { type: string }>)[sessionId];
        // Treat undefined (session not in map) as idle — may have completed before first poll
        if (!statusEntry || statusEntry.type === 'idle') break;
        if (Date.now() >= deadline) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `prefect_await timed out after ${timeoutMs}ms`, sessionId }) }],
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
      if (messagesResult.error) {
        if (isNotFound(messagesResult.error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(messagesResult.error));
      }
      // D-12: find last assistant message — same shape as prefect_run result
      const msgs = messagesResult.data ?? [];
      const last = [...msgs].reverse().find((m) => (m.info as { role?: string }).role === 'assistant');
      if (!last) throw new Error('prefect_await: no assistant message found in session after idle');
      const awaitParseResult = PartSchema.array().safeParse(last.parts);
      if (!awaitParseResult.success) {
        console.error('PartSchema validation warning (prefect_await):', awaitParseResult.error.message);
      }
      const validatedParts = awaitParseResult.success ? awaitParseResult.data : (last.parts as unknown[]);
      // D-13: return shape matches prefect_delegate for easy substitution
      return { content: [{ type: 'text', text: JSON.stringify({ result: { info: last.info, parts: validatedParts }, diff }) }] };
    } catch (err) {
      // D-12 stale-session detection inside the JSON-encoded error string from getDiff
      if (typeof (err as Error).message === 'string' && (
        (err as Error).message.includes('"status":404') ||
        (err as Error).message.includes('"NotFoundError"')
      )) {
        const entry = lookupSession(sessionId);
        removeSession(sessionId);
        const staleUrl = entry?.url ?? resolveServerUrl();
        return {
          content: [{ type: 'text', text:
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${staleUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`
          }], isError: true,
        };
      }
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-01: List OpenCode agents (Phase 8)
server.registerTool(
  'prefect_list_agents',
  {
    description: 'List the agents available in the connected OpenCode instance. Returns Array<{ name, description?, mode }>. Use the returned name (e.g. "build", "general") as the agent param when calling prefect_run. Pass directory to scope to a specific project root.',
    inputSchema: z.object({
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).app.agents({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      const mapped = (data ?? []).map((a) => ({
        name: a.name,
        description: a.description,
        mode: a.mode,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(mapped) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-02: List OpenCode providers and their models (Phase 8)
server.registerTool(
  'prefect_list_providers',
  {
    description: 'List the providers configured in the connected OpenCode instance and their available models. Returns Array<{ id, name, models: Array<{ id, name }> }>. Use returned provider.id + model.id as providerID/modelID params for prefect_run. Pass directory to scope to a specific project root.',
    inputSchema: z.object({
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).provider.list({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      const mapped = (data?.all ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        models: Object.values(p.models).map((m) => ({ id: m.id, name: m.name })),
      }));
      return { content: [{ type: 'text', text: JSON.stringify(mapped) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-03: Find workspace symbols by query (Phase 8)
server.registerTool(
  'prefect_find_symbol',
  {
    description: 'Search the OpenCode workspace for symbols matching a query string (e.g. function or class names). Returns Array<{ name, kind, path, range }> where path is project-root-relative when a directory is resolved (via directory param or OPENCODE_DEFAULT_PROJECT), absolute otherwise. kind is the LSP SymbolKind number.',
    inputSchema: z.object({
      query: z.string().describe('Symbol name or pattern to search for'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to OPENCODE_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async (args) => {
    const { query: symbolQuery, directory } = args;
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).find.symbols({
        query: { query: symbolQuery, ...(dir ? { directory: dir } : {}) },
      });
      if (error) throw new Error(JSON.stringify(error));
      const mapped = (data ?? []).map((sym) => {
        if (!sym.location.uri.startsWith('file://')) return null;
        const absolutePath = decodeURIComponent(sym.location.uri.replace(/^file:\/\//, ''));
        const filePath = dir ? path.relative(dir, absolutePath) : absolutePath;
        return {
          name: sym.name,
          kind: sym.kind,
          path: filePath,
          range: sym.location.range,
        };
      }).filter((sym): sym is NonNullable<typeof sym> => sym !== null);
      return { content: [{ type: 'text', text: JSON.stringify(mapped) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-11: Trigger session summary generation
server.registerTool(
  'prefect_session_summarize',
  {
    description: 'Trigger summary generation for an OpenCode session. Returns true when the summarization was accepted. providerID and modelID are required — the endpoint has no default fallback. providerID must match a provider configured in the OpenCode server (e.g. "vllm" or "anthropic"); using an unconfigured provider returns ProviderModelNotFoundError.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID'),
      providerID: z.string().describe('Required. Provider ID for summarization — must match a provider configured in the OpenCode server (e.g. "vllm"). Using an unconfigured provider returns ProviderModelNotFoundError.'),
      modelID: z.string().describe('Required. Model ID for summarization. Must be available under the specified providerID.'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ sessionId, providerID, modelID, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.summarize({
        path: { id: sessionId },
        body: { providerID, modelID },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-12: Get the current todo list for a session
server.registerTool(
  'prefect_session_todo',
  {
    description: 'Get the current todo list for an OpenCode session. Returns Array<{ id, content, status, priority }> where status is one of pending/in_progress/completed/cancelled and priority is high/medium/low.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ sessionId, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.todo({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-13: Generate AGENTS.md for the session's project (with existence guard)
server.registerTool(
  'prefect_session_init',
  {
    description: `Initialize AGENTS.md for the session's project. Use this decision flow:

1. Call prefect_session_init (no force).
   - AGENTS.md absent → endpoint called, model generates AGENTS.md. Returns { existed: false, accepted: true }.
   - AGENTS.md exists → endpoint NOT called. Returns { existed: true, content: "<current content>" }.

2. If existed: true, read the returned content and decide:
   - Content is good → use as-is, skip further init.
   - Needs additions → augment directly via file write or prefect_run prompt.
   - Needs full re-initialization → call prefect_session_init({ force: true }).

3. force: true always calls the endpoint. OpenCode rewrites AGENTS.md using model judgment — it preserves sections it deems worth keeping and drops others. Custom or hand-authored content can be lost. Returns { existed: <bool>, accepted: true }.

providerID, modelID, and messageID are all required. messageID is the ID assigned to the new user message created by this call — pass any unique string (e.g. a UUID); it is not a reference to an existing message. accepted: true confirms the command was accepted, not that the file was written or changed.

WARNING: If AGENTS.md is staged for deletion in git (shows as "D" in git status), OpenCode will treat it as absent but the model may still skip writing it — interpreting the git-deleted state as an intentional removal. Before calling, ensure AGENTS.md is either committed (present) or fully removed from both the working tree and git index (git rm --cached AGENTS.md && rm AGENTS.md). A file that is deleted on disk but still tracked will confuse the model.`,
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID'),
      providerID: z.string().describe('Required. Provider ID — must match a provider configured in the OpenCode server (e.g. "vllm"). Using an unconfigured provider returns ProviderModelNotFoundError.'),
      modelID: z.string().describe('Required. Model ID. Must be available under the specified providerID.'),
      messageID: z.string().describe('Required. The ID assigned to the new user message created by this call. Must start with "msg" (e.g. "msg_" + Date.now(), or "msg" + a random suffix). UUID format is rejected. Not a reference to an existing message.'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
      force: z.boolean().optional().describe('Skip the existence guard and always call the endpoint. OpenCode will rewrite AGENTS.md — custom content can be lost. Use when explicitly re-initializing.'),
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
        return { content: [{ type: 'text', text: JSON.stringify({ existed: true, content }) }] };
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
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify({ existed, accepted: data }) }] };
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        return {
          content: [{
            type: 'text',
            text: `prefect_session_init timed out after ${TIMEOUT_MS / 1000}s — the OpenCode server did not return a response. ` +
              `This is a known upstream issue: the /session/{id}/init endpoint may not send a response on some OpenCode versions. ` +
              `Check whether AGENTS.md was created in the project directory anyway.`,
          }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-15: Make a session publicly shareable
server.registerTool(
  'prefect_session_share',
  {
    description: 'Make an OpenCode session publicly shareable. Returns the full Session object — after sharing, the share URL is available at session.share.url in the returned Session.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID to share'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ sessionId, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.share({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-16: Remove sharing from a session
server.registerTool(
  'prefect_session_unshare',
  {
    description: 'Remove public sharing from an OpenCode session. Returns the updated Session object with the share field cleared (session.share will be absent/undefined).',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID to unshare'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ sessionId, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.unshare({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-04: prefect_vcs_info — get VCS/git info for the workspace
server.registerTool(
  'prefect_vcs_info',
  {
    description: 'Get VCS/git info for the OpenCode workspace. Returns { branch: string } with the current git branch name. Pass directory to scope to a specific project root.',
    inputSchema: z.object({
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).vcs.get({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-05: prefect_file_status — get git-tracked file status for the workspace
server.registerTool(
  'prefect_file_status',
  {
    description: 'Get git-tracked file status for the OpenCode workspace. Returns Array<{ path: string, added: number, removed: number, status: "added"|"deleted"|"modified" }>. Pass directory to scope to a specific project root.',
    inputSchema: z.object({
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).file.status({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-06: prefect_list_mcp_servers — list MCP servers configured in OpenCode
server.registerTool(
  'prefect_list_mcp_servers',
  {
    description: 'List the MCP servers configured in the connected OpenCode instance. Returns { [serverName: string]: McpStatus } where McpStatus has a status field of "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration". Pass directory to scope to a specific project root.',
    inputSchema: z.object({
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).mcp.status({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-11: prefect_get_config — get the current OpenCode configuration
server.registerTool(
  'prefect_get_config',
  {
    description: 'Get the current OpenCode configuration object. Returns the full Config as JSON. Pass directory to scope to a specific project root. WARNING: response may include sensitive values (API keys, tokens) from the OpenCode config. Do not log or display raw output in shared environments.',
    inputSchema: z.object({
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ directory }) => {
    const dir = resolveDirectory(directory);
    // NOTE: Response may contain API keys or provider credentials — do not log or cache.
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).config.get({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-12: prefect_list_commands — list available slash commands
server.registerTool(
  'prefect_list_commands',
  {
    description: 'List available slash commands in the OpenCode instance. Returns Array<{ name: string, description?: string, agent?: string, model?: string, template: string, subtask?: boolean }>. Complements prefect_session_command which executes a named command. Pass directory to scope to a specific project root.',
    inputSchema: z.object({
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).command.list({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// SESSION-14: prefect_session_shell — execute a shell command in a session context
server.registerTool(
  'prefect_session_shell',
  {
    description: 'WARNING: Executes an arbitrary shell command in the context of an OpenCode session. The command runs in the session\'s working directory with the session\'s environment. Returns AssistantMessage containing command output. Use with caution — there is no sandboxing at the Prefect layer. sessionId, agent, and command are all required. model override is optional.',
    inputSchema: z.object({
      sessionId: z.string().min(1).describe('Session ID in which to execute the command'),
      command: z.string().describe('Shell command to execute in the session\'s context'),
      agent: z.string().describe('Required. Agent context for command execution (e.g. "general"). Must match a configured agent name.'),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }).optional().describe('Optional model override. Both providerID and modelID required together if provided.'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ sessionId, command, agent, model, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl(sessionId);
      const { data, error } = await getClient(serverUrl).session.shell({
        path: { id: sessionId },
        body: {
          agent,
          command,
          ...(model ? { model } : {}),
        },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) {
        if (isNotFound(error)) {
          const entry = lookupSession(sessionId);
          removeSession(sessionId);
          throw new Error(
            `Session ${sessionId} not found on server '${entry?.server ?? 'unknown'}' (${serverUrl}).\n` +
            `The session may have been deleted or the server restarted.\n` +
            `Call prefect_session_list to see active sessions, or prefect_create_session to start a new one.`,
          );
        }
        throw new Error(JSON.stringify(error));
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-07: prefect_inject_mcp_server — add an MCP server to OpenCode at runtime
server.registerTool(
  'prefect_inject_mcp_server',
  {
    description: 'Add an MCP server to the OpenCode instance at runtime. For local stdio servers, pass configType: "local" with commandArgs as an array (e.g. ["node", "/path/to/server.js"]). For remote HTTP/SSE servers, pass configType: "remote" with url. Returns the updated MCP server map { [serverName]: McpStatus }.',
    inputSchema: z.object({
      name: z.string().describe('Unique name for this MCP server in the OpenCode MCP registry'),
      configType: z.enum(['local', 'remote']).describe('"local" for stdio subprocess MCP servers; "remote" for HTTP/SSE MCP servers'),
      commandArgs: z.array(z.string()).optional().describe('Required when configType is "local". Command and arguments as an array (e.g. ["node", "/path/to/server.js"]).'),
      environment: z.record(z.string(), z.string()).optional().describe('Environment variables to set when running a local MCP server'),
      url: z.string().optional().describe('Required when configType is "remote". URL of the remote MCP server'),
      headers: z.record(z.string(), z.string()).optional().describe('Optional HTTP headers for remote MCP server requests'),
      enabled: z.boolean().optional().describe('Whether to enable this MCP server. Defaults to true.'),
      timeout: z.number().int().positive().optional().describe('Timeout in ms for fetching tools from the MCP server (local only). Default: 5000.'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ name, configType, commandArgs, environment, url, headers, enabled, timeout, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      if (configType === 'local' && (!commandArgs || commandArgs.length === 0)) {
        throw new Error('prefect_inject_mcp_server: commandArgs is required when configType is "local"');
      }
      if (configType === 'remote' && !url) {
        throw new Error('prefect_inject_mcp_server: url is required when configType is "remote"');
      }
      const config: import('@opencode-ai/sdk').McpLocalConfig | import('@opencode-ai/sdk').McpRemoteConfig =
        configType === 'local'
          ? {
              type: 'local',
              command: commandArgs!,
              ...(environment ? { environment } : {}),
              ...(enabled !== undefined ? { enabled } : {}),
              ...(timeout !== undefined ? { timeout } : {}),
            }
          : {
              type: 'remote',
              url: url!,
              ...(headers ? { headers } : {}),
              ...(enabled !== undefined ? { enabled } : {}),
            };
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).mcp.add({
        body: { name, config },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-08: prefect_list_tools — list available tools per model (dual-endpoint)
server.registerTool(
  'prefect_list_tools',
  {
    description: 'List tools available in the OpenCode instance. When provider and model are both omitted, returns all tool IDs (Array<string>) via GET /experimental/tool/ids. When both provider and model are supplied, returns tool details (Array<{ id, description, parameters }>) for that specific model via GET /experimental/tool. Both provider and model are required together when using the detailed endpoint.',
    inputSchema: z.object({
      provider: z.string().optional().describe('Provider ID (e.g. "anthropic"). Required when model is provided.'),
      model: z.string().optional().describe('Model ID (e.g. "claude-sonnet-4-6"). Required when provider is provided.'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async ({ provider, model, directory }) => {
    const dir = resolveDirectory(directory);
    try {
      if ((provider && !model) || (!provider && model)) {
        throw new Error('prefect_list_tools: provider and model must be supplied together; omit both for tool IDs only');
      }
      const serverUrl = resolveServerUrl();
      if (provider && model) {
        // GET /experimental/tool — requires BOTH provider + model (non-optional in SDK types)
        const { data, error } = await getClient(serverUrl).tool.list({
          query: {
            provider,
            model,
            ...(dir ? { directory: dir } : {}),
          },
        });
        if (error) throw new Error(JSON.stringify(error));
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } else {
        // GET /experimental/tool/ids — no required params
        const { data, error } = await getClient(serverUrl).tool.ids({
          query: dir ? { directory: dir } : undefined,
        });
        if (error) throw new Error(JSON.stringify(error));
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-09: prefect_find_file — find files in the workspace by name or pattern
server.registerTool(
  'prefect_find_file',
  {
    description: 'Find files in the OpenCode workspace matching a query string. Returns Array<string> of matching file paths. Optionally include directories in results via dirs param. Pass directory to scope the search to a project root.',
    inputSchema: z.object({
      query: z.string().describe('Filename or pattern to search for'),
      dirs: z.enum(['true', 'false']).optional().describe('Whether to include directory paths in results. Defaults to "false". Must be the string "true" or "false", not a boolean.'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async (args) => {
    const { query: fileQuery, dirs, directory } = args;
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).find.files({
        query: {
          query: fileQuery,
          ...(dirs ? { dirs } : {}),
          ...(dir ? { directory: dir } : {}),
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

// API-10: prefect_get_file_content — get the content of a file in the workspace
server.registerTool(
  'prefect_get_file_content',
  {
    description: 'Get the content of a file in the OpenCode workspace. Returns { type: "text"|"binary", content: string, diff?, patch?, encoding?, mimeType? }. path is the file path — absolute or relative to directory if provided.',
    inputSchema: z.object({
      path: z.string().describe('File path to read (absolute, or relative to the directory param if provided)'),
      directory: z.string().optional().describe('Absolute path to the project root. Falls back to PREFECT_DEFAULT_PROJECT env var if not provided.'),
    }),
  },
  async (args) => {
    const { path: filePath, directory } = args;
    const dir = resolveDirectory(directory);
    try {
      const serverUrl = resolveServerUrl();
      const { data, error } = await getClient(serverUrl).file.read({
        query: {
          path: filePath,
          ...(dir ? { directory: dir } : {}),
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: String(err) }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — never stdout (corrupts JSON-RPC stream)
  console.error(`Prefect MCP server running (OpenCode: ${BASE_URL})`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
