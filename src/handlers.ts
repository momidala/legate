import { createOpencodeClient } from '@opencode-ai/sdk';
import { createPatch } from 'diff';
import { z } from 'zod';
import { PartSchema } from './parts.js';
import { atomicCheckAndAdd } from './sessions.js';

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
 * Extracted from prefect_create_session handler in src/index.ts.
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
  if (error) throw new Error(JSON.stringify(error));
  if (!data) throw new Error('createSession: API returned no data and no error');
  // D-11: persist sessionId → server mapping immediately so subsequent tool calls
  // route to the correct server even after an MCP server restart. Both serverUrl
  // and serverName must be present — entry-point handlers always pass both.
  if (serverUrl && serverName) {
    const entry = { server: serverName, url: serverUrl, ...(model ? { model } : {}) };
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
 * Run a prompt against a session and return the assistant's structured response.
 * Extracted from prefect_run handler in src/index.ts.
 * IMPORTANT: AbortError is NOT caught here — it propagates to the caller so
 * composite handlers (prefect_delegate) can detect timeout and call session.abort().
 * The caller is responsible for managing the AbortController and clearTimeout.
 */
export async function runPrompt(
  client: OpencodeClient,
  sessionId: string,
  prompt: string,
  opts: RunPromptOptions,
  directory: string | undefined,
  signal: AbortSignal,
): Promise<{ info: unknown; parts: z.infer<typeof PartSchema>[] }> {
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
  if (error) throw new Error(JSON.stringify(error));
  if (!data) throw new Error('runPrompt: API returned no data and no error');
  const parseResult = PartSchema.array().safeParse(data.parts);
  if (!parseResult.success) {
    console.error('PartSchema validation warning (runPrompt):', parseResult.error.message);
  }
  const validatedParts = parseResult.success ? parseResult.data : (data.parts as z.infer<typeof PartSchema>[]);
  return { info: data.info, parts: validatedParts };
}

/**
 * Get the file diff for a session with unified-diff patch strings.
 * Extracted from prefect_get_diff handler in src/index.ts.
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
  if (error) throw new Error(JSON.stringify(error));
  return (data ?? []).map((d) => {
    const raw = d as Record<string, unknown>;
    const apiPatch = typeof raw.patch === 'string' ? raw.patch : undefined;
    return {
      ...d,
      patch: apiPatch ?? createPatch(d.file, d.before ?? '', d.after ?? ''),
    };
  });
}
