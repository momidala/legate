// legate-0ys / legate-o1u: the ONE home for tool input schemas that are shared across
// modules (or across a module's own tools). Importing this file is side-effect free —
// it only constructs Zod schema objects. Reusing a ZodType instance across multiple
// z.object() spreads is safe; the schemas are immutable descriptors.
import { z } from 'zod';

// legate-0ys(a): the per-call override fields carried byte-identically by legate_run and
// legate_prompt_async (model/agent/system/tools/files/messageID/agentInput/subtaskInput).
// Spread into each tool's z.object() so there is ONE definition of these ~50 lines.
// NOTE: legate_delegate / legate_dispatch deliberately do NOT reuse this — their
// model/agent/system descriptions differ ("this call" vs "this single call") and they
// omit tools/files/messageID/agentInput/subtaskInput, so forcing the share would change
// their user-facing schema text. Those two share their own schema below instead.
export const promptOverrideFields = {
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
  tools: z
    .record(z.string(), z.boolean())
    .optional()
    .describe(
      'Override enabled tools for this call. Map of tool ID to boolean enable/disable flag. Example: { "bash": true, "edit": false }',
    ),
  // RUN-06: file attachments — FilePartInput shape (use file:// URIs for local files)
  files: z
    .array(
      z.object({
        type: z.literal('file'),
        mime: z.string(),
        filename: z.string().optional(),
        url: z.string().refine((u) => u.startsWith('file://'), { message: 'files[].url must be a file:// URI' }),
      }),
    )
    .optional()
    .describe(
      'File attachments to include as context. Each file requires mime type and url (use file:// URIs for local paths).',
    ),
  // RUN-07: message ID assignment (idempotency key for user message creation)
  messageID: z
    .string()
    .optional()
    .describe(
      'Assign a specific ID to the new user message being created. If a message with this ID already exists in the session, OpenCode returns the cached response (idempotency — useful for safe retries). Omit to auto-generate. For branching a conversation at a prior message point, use legate_fork instead.',
    ),
  // RUN-08: structured agent part input (distinct from the top-level agent string override)
  agentInput: z
    .object({
      type: z.literal('agent'),
      name: z.string(),
    })
    .optional()
    .describe(
      'Structured agent part input — specify the agent name for this prompt. Distinct from the top-level agent string override.',
    ),
  // RUN-08: structured subtask part input
  subtaskInput: z
    .object({
      type: z.literal('subtask'),
      prompt: z.string(),
      description: z.string(),
      agent: z.string(),
    })
    .optional()
    .describe('Structured subtask part input — delegate a subtask to a specific agent.'),
} as const;

// legate-0ys(a): agent XOR agentInput refine — shared by legate_run and legate_prompt_async.
// Kept as a predicate + message pair (rather than a wrapped schema) so each tool applies
// `.refine(agentXorRefineCheck, { message: agentXorRefineMessage })` on its own z.object.
export const agentXorRefineMessage =
  'Provide either agent or agentInput, not both — they are mutually exclusive overrides';
export function agentXorRefineCheck(v: { agent?: unknown; agentInput?: unknown }): boolean {
  return !(v.agent && v.agentInput);
}

// legate-8jm: the canonical zod mirror of a registry ServerEntry. registry.ts cannot use
// zod (it is on the CLI's dependency-free import graph — see isValidServerEntry there), so
// this schema lives in schemas.ts (tool-layer only). registry.test.ts asserts this schema
// and registry.isValidServerEntry agree, so the two shape definitions cannot drift.
// Routing-critical fields are strict; providerID/modelID/maxSessions are lenient (optional).
export const ServerEntrySchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  providerID: z.string().optional(),
  modelID: z.string().optional(),
  maxSessions: z.number().optional(),
});

// legate-o1u: session_command input schema, exported so the test imports the REAL schema
// instead of asserting against a phantom local copy. Also the single definition consumed
// by tools/session.ts's registration.
export const SessionCommandInputSchema = z.object({
  sessionId: z.string().min(1).describe('Session ID'),
  command: z.string().describe('The slash command name without the leading slash (e.g. "compact")'),
  arguments: z.string().describe('Arguments string to pass to the command (use empty string if none)'),
  messageID: z.string().optional().describe('Optional message ID for context'),
  agent: z.string().optional().describe('Optional agent override'),
  model: z
    .string()
    .optional()
    .describe(
      'Optional model override as a plain string (NOT { providerID, modelID } — this endpoint takes a single string).',
    ),
  directory: z
    .string()
    .optional()
    .describe(
      "Routes this call to the OpenCode project at the specified path. Does not change the session's working directory. Falls back to LEGATE_DEFAULT_PROJECT env var.",
    ),
});
