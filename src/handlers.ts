import { createOpencodeClient } from '@opencode-ai/sdk';
import { createPatch } from 'diff';
import { validateParts, type Part } from './parts.js';
import { atomicCheckAndAdd } from './sessions.js';
import { apiError } from './errors.js'; // legate-dxw: typed SDK errors
import { findServerByName } from './registry.js';
import type { ServerContext } from './server-context.js';

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

export interface RunPromptOptions {
  model?: { providerID: string; modelID: string };
  agent?: string;
  system?: string;
  // New in Phase 10:
  tools?: Record<string, boolean>;                                                          // RUN-05
  files?: Array<{ type: 'file'; mime: string; filename?: string; url: string }>;            // RUN-06
  messageID?: string;                                                                        // RUN-07
  agentInput?: { type: 'agent'; name: string };                                             // RUN-08
  subtaskInput?: { type: 'subtask'; prompt: string; description: string; agent: string };   // RUN-08
}

/**
 * Create a new OpenCode session.
 * Extracted from legate_create_session handler in src/index.ts.
 * Throws on API error.
 */
export async function createSession(
  client: OpencodeClient,
  title: string | undefined,
  directory: string | undefined,
  parentID?: string,                                       // SESSION-10
  serverUrl?: string,                                      // NEW — for sessions.json write (D-11)
  serverName?: string,                                     // NEW — store name alongside URL per D-08
  model?: { providerID: string; modelID: string },         // registered server model — auto-injected on prefect_run
  maxSessions?: number | null,                             // WR-01: capacity cap for atomic check-and-add
): Promise<{ id: string; [key: string]: unknown }> {
  const { data, error } = await client.session.create({
    body: {
      ...(title !== undefined ? { title } : {}),
      ...(parentID ? { parentID } : {}),                   // NEW — only included when provided
    },
    query: directory ? { directory } : undefined,
  });
  if (error) throw apiError(error); // legate-dxw
  if (!data) throw new Error('createSession: API returned no data and no error');
  // D-11: persist sessionId → server mapping immediately so subsequent tool calls
  // route to the correct server even after an MCP server restart. Both serverUrl
  // and serverName must be present — entry-point handlers always pass both.
  if (serverUrl && serverName) {
    // legate-ale: persist the project directory so the liveness probe in atomicCheckAndAdd
    // can scope GET /session/:id to the right project. Omitted when no directory was provided.
    const entry = { server: serverName, url: serverUrl, ...(model ? { model } : {}), ...(directory ? { directory } : {}) };
    // WR-01: always use the atomic lock (even when maxSessions is null) so concurrent
    // instances cannot produce a lost write. atomicCheckAndAdd skips the capacity check
    // when maxSessions is null but still acquires the lock for the write.
    const capacityError = await atomicCheckAndAdd(data.id, entry, maxSessions);
    if (capacityError) {
      try { await client.session.delete({ path: { id: data.id } }); } catch { /* best-effort */ }
      throw new Error(capacityError);
    }
  }
  return data;
}

/**
 * legate-0ys(b): the resolve-server → registry-model-lookup → createSession recipe that
 * legate_create_session and the create-new-session paths of legate_delegate /
 * legate_dispatch each repeated verbatim. Extracted here so there is ONE copy:
 *   1. resolve the target server URL (registry name → URL, or first/default),
 *   2. resolve its canonical name and its registered provider/model (auto-injected model),
 *   3. createSession with capacity enforcement (the compensation-on-overflow already
 *      lives inside createSession above — unchanged).
 * Returns the created session plus the client and URL the callers go on to reuse.
 */
export async function createSessionOnServer(
  ctx: Pick<ServerContext, 'resolveServerUrl' | 'serverNameForUrl' | 'getClient'>,
  opts: { title?: string; dir?: string; parentID?: string; serverParam?: string },
): Promise<{ session: { id: string; [key: string]: unknown }; client: OpencodeClient; serverUrl: string }> {
  const serverUrl = ctx.resolveServerUrl(undefined, opts.serverParam);
  const serverName = ctx.serverNameForUrl(serverUrl, opts.serverParam);
  const client = ctx.getClient(serverUrl);
  const entry = findServerByName(serverName);
  const model = (entry?.providerID && entry?.modelID)
    ? { providerID: entry.providerID, modelID: entry.modelID }
    : undefined;
  const session = await createSession(client, opts.title, opts.dir, opts.parentID, serverUrl, serverName, model, entry?.maxSessions);
  return { session, client, serverUrl };
}

/**
 * Run a prompt against a session and return the assistant's structured response.
 * Extracted from legate_run handler in src/index.ts.
 * IMPORTANT: AbortError is NOT caught here — it propagates to the caller so
 * composite handlers (legate_delegate) can detect timeout and call session.abort().
 * The caller is responsible for managing the AbortController and clearTimeout.
 */
export async function runPrompt(
  client: OpencodeClient,
  sessionId: string,
  prompt: string,
  opts: RunPromptOptions,
  directory: string | undefined,
  signal: AbortSignal,
): Promise<{ info: unknown; parts: Part[] | unknown[]; partsDropped?: number }> {
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; mime: string; filename?: string; url: string }
    | { type: 'agent'; name: string }
    | { type: 'subtask'; prompt: string; description: string; agent: string }
  > = [
    { type: 'text', text: prompt },
    ...(opts.files ?? []),
    ...(opts.agentInput ? [opts.agentInput] : []),
    ...(opts.subtaskInput ? [opts.subtaskInput] : []),
  ];
  const { data, error } = await client.session.prompt({
    path: { id: sessionId },
    body: {
      parts,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.messageID ? { messageID: opts.messageID } : {}),
    },
    query: directory ? { directory } : undefined,
    signal,
  });
  if (error) throw apiError(error); // legate-dxw
  if (!data) throw new Error('runPrompt: API returned no data and no error');
  // legate-ngl: per-element validation with honest typing (no lying cast). partsDropped
  // is surfaced only when some parts failed, so the happy-path shape is unchanged.
  const { parts: validatedParts, dropped } = validateParts(data.parts, 'runPrompt');
  return { info: data.info, parts: validatedParts, ...(dropped ? { partsDropped: dropped } : {}) };
}

/**
 * Get the file diff for a session with unified-diff patch strings.
 * Extracted from legate_get_diff handler in src/index.ts.
 * Uses the API-provided patch when present (OpenCode ≥1.14.33); falls back to
 * createPatch(before, after) for older server versions that return before/after.
 * Throws on API error.
 */
export async function getDiff(
  client: OpencodeClient,
  sessionId: string,
  messageID: string | undefined,
  directory: string | undefined,
): Promise<Array<{ file: string; before?: string; after?: string; additions: number; deletions: number; patch: string; status?: string }>> {
  const { data, error } = await client.session.diff({
    path: { id: sessionId },
    query: {
      ...(messageID ? { messageID } : {}),
      ...(directory ? { directory } : {}),
    },
  });
  if (error) throw apiError(error); // legate-dxw
  return (data ?? []).map((d) => {
    const raw = d as Record<string, unknown>;
    const apiPatch = typeof raw.patch === 'string' ? raw.patch : undefined;
    return {
      ...d,
      patch: apiPatch ?? createPatch(d.file, d.before ?? '', d.after ?? ''),
    };
  });
}
