import { createOpencodeClient } from '@opencode-ai/sdk';
import { createPatch } from 'diff';
import { z } from 'zod';
import { PartSchema } from './parts.js';

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

export interface RunPromptOptions {
  model?: { providerID: string; modelID: string };
  agent?: string;
  system?: string;
  // New in Phase 10:
  tools?: { [key: string]: boolean };                                                       // RUN-05
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
  parentID?: string,                                       // NEW — SESSION-10 (trailing optional, existing 3-arg callers unaffected)
): Promise<{ id: string; [key: string]: unknown }> {
  const { data, error } = await client.session.create({
    body: {
      title,
      ...(parentID ? { parentID } : {}),                   // NEW — only included when provided
    },
    query: directory ? { directory } : undefined,
  });
  if (error) throw new Error(JSON.stringify(error));
  if (!data) throw new Error('createSession: API returned no data and no error');
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
  const validatedParts = PartSchema.array().parse(data.parts);
  return { info: data.info, parts: validatedParts };
}

/**
 * Get the file diff for a session with computed unified-diff patch strings.
 * Extracted from prefect_get_diff handler in src/index.ts.
 * Appends patch: createPatch(d.file, d.before, d.after) to each FileDiff.
 * Throws on API error.
 */
export async function getDiff(
  client: OpencodeClient,
  sessionId: string,
  messageID: string | undefined,
  directory: string | undefined,
): Promise<Array<{ file: string; before: string; after: string; additions: number; deletions: number; patch: string }>> {
  const { data, error } = await client.session.diff({
    path: { id: sessionId },
    query: {
      ...(messageID ? { messageID } : {}),
      ...(directory ? { directory } : {}),
    },
  });
  if (error) throw new Error(JSON.stringify(error));
  return (data ?? []).map((d) => ({
    ...d,
    patch: createPatch(d.file, d.before, d.after),
  }));
}
