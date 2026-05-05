import { z } from 'zod';

// ApiError — used by RetryPart.error
export const ApiErrorSchema = z.object({
  name: z.literal('APIError'),
  data: z.object({
    message: z.string(),
    statusCode: z.number().optional(),
    isRetryable: z.boolean(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    responseBody: z.string().optional(),
  }),
});

// ToolState sub-types — discriminated on `status` (NOT `type`)
export const ToolStatePendingSchema = z.object({
  status: z.literal('pending'),
  input: z.record(z.string(), z.unknown()),
  raw: z.string(),
});

export const ToolStateRunningSchema = z.object({
  status: z.literal('running'),
  input: z.record(z.string(), z.unknown()),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  time: z.object({ start: z.number() }),
});

// FilePartSchema forward reference needed for ToolStateCompletedSchema.attachments
// Declared here as a lazy reference; defined fully below
const FilePartSourceTextSchema = z.object({
  value: z.string(),
  start: z.number(),
  end: z.number(),
});

const FileSourceSchema = z.object({
  text: FilePartSourceTextSchema,
  type: z.literal('file'),
  path: z.string(),
});

const SymbolSourceSchema = z.object({
  text: FilePartSourceTextSchema,
  type: z.literal('symbol'),
  path: z.string(),
  range: z.object({
    start: z.object({ line: z.number(), character: z.number() }),
    end: z.object({ line: z.number(), character: z.number() }),
  }),
  name: z.string(),
  kind: z.number(),
});

export const FilePartSourceSchema = z.discriminatedUnion('type', [FileSourceSchema, SymbolSourceSchema]);

// FilePartSchema — defined before ToolStateCompletedSchema so the lazy reference works
export const FilePartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('file'),
  mime: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  source: FilePartSourceSchema.optional(),
});

export const ToolStateCompletedSchema = z.object({
  status: z.literal('completed'),
  input: z.record(z.string(), z.unknown()),
  output: z.string(),
  title: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  time: z.object({
    start: z.number(),
    end: z.number(),
    compacted: z.number().optional(),
  }),
  attachments: z.array(FilePartSchema).optional(),
});

export const ToolStateErrorSchema = z.object({
  status: z.literal('error'),
  input: z.record(z.string(), z.unknown()),
  error: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  time: z.object({ start: z.number(), end: z.number() }),
});

export const ToolStateSchema = z.discriminatedUnion('status', [
  ToolStatePendingSchema,
  ToolStateRunningSchema,
  ToolStateCompletedSchema,
  ToolStateErrorSchema,
]);

// All 12 Part schemas — base fields: id, sessionID, messageID, type

export const TextPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('text'),
  text: z.string(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
  time: z.object({ start: z.number(), end: z.number().optional() }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ReasoningPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('reasoning'),
  text: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // NOTE: time is REQUIRED on ReasoningPart unlike TextPart
  time: z.object({ start: z.number(), end: z.number().optional() }),
});

// FilePartSchema already defined above (needed by ToolStateCompletedSchema)

export const ToolPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('tool'),
  callID: z.string(),
  tool: z.string(), // REQUIRED — easy to miss
  state: ToolStateSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const StepStartPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('step-start'),
  snapshot: z.string().optional(),
});

export const StepFinishPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('step-finish'),
  reason: z.string(),
  snapshot: z.string().optional(),
  cost: z.number(), // REQUIRED
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({ read: z.number(), write: z.number() }),
  }), // REQUIRED
});

export const SnapshotPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('snapshot'),
  snapshot: z.string(),
});

export const PatchPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('patch'),
  hash: z.string(),
  files: z.array(z.string()),
});

export const AgentPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('agent'),
  name: z.string(),
  source: z.object({ value: z.string(), start: z.number(), end: z.number() }).optional(),
});

export const RetryPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('retry'),
  attempt: z.number(),
  error: ApiErrorSchema, // ApiError shape, NOT a plain string
  time: z.object({ created: z.number() }),
});

export const CompactionPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('compaction'),
  auto: z.boolean(),
});

// SubtaskPart has NO named SDK export — defined inline in the Part union
export const SubtaskPartSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal('subtask'),
  prompt: z.string(),
  description: z.string(),
  agent: z.string(),
});

// PartSchema — discriminated union over all 12 Part types using `type` field
export const PartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  ReasoningPartSchema,
  FilePartSchema,
  ToolPartSchema,
  StepStartPartSchema,
  StepFinishPartSchema,
  SnapshotPartSchema,
  PatchPartSchema,
  AgentPartSchema,
  RetryPartSchema,
  CompactionPartSchema,
  SubtaskPartSchema,
]);
