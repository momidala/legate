// legate-ur1: response-size caps for the two tools that can return unbounded payloads
// (legate_get_diff and legate_session_messages). An oversized tool result blows the MCP
// client's context window, so past a character cap we return a STRUCTURED truncation
// envelope instead. Every function here builds the final object and then re-serializes to
// confirm it fits — we never truncate mid-JSON.
import { resolveEnvInt } from './env.js';

// ≈100k tokens at ~4 chars/token. Override with LEGATE_MAX_RESPONSE_CHARS.
export const DEFAULT_MAX_RESPONSE_CHARS = 400_000;

/** Resolve the response cap from LEGATE_MAX_RESPONSE_CHARS (read at call time). */
export function maxResponseChars(): number {
  return resolveEnvInt(['LEGATE_MAX_RESPONSE_CHARS'], DEFAULT_MAX_RESPONSE_CHARS);
}

function truncSuffix(droppedChars: number): string {
  return `…[truncated ${droppedChars} chars]`;
}

function truncateString(s: string, keep: number): string {
  if (s.length <= keep) return s;
  const head = s.slice(0, Math.max(0, keep));
  return head + truncSuffix(s.length - head.length);
}

export interface FileDiffEntry {
  file: string;
  before?: string;
  after?: string;
  additions: number;
  deletions: number;
  patch: string;
  status?: string;
}

export interface TruncatedDiff {
  truncated: true;
  files: Array<Omit<FileDiffEntry, 'before' | 'after'>>;
}

/**
 * legate-ur1: cap a legate_get_diff payload. Under the cap → return the array unchanged
 * (happy path). Over the cap → drop before/after from every entry first; if still over,
 * progressively truncate the `patch` strings (each with a '…[truncated N chars]' suffix)
 * until the whole envelope fits, and mark truncated: true.
 */
export function capDiffResponse(
  diffs: FileDiffEntry[],
  cap: number = maxResponseChars(),
): FileDiffEntry[] | TruncatedDiff {
  if (JSON.stringify(diffs).length <= cap) return diffs;

  // Step 1: drop the (typically largest) before/after blobs.
  const stripped = diffs.map(({ before: _before, after: _after, ...rest }) => rest);
  const envelope: TruncatedDiff = { truncated: true, files: stripped };
  if (JSON.stringify(envelope).length <= cap) return envelope;

  // Step 2: shrink patch strings. Start from the longest patch and halve the per-patch
  // budget until the serialized envelope fits (budget→0 leaves only the suffix, which is
  // bounded, so this always terminates).
  let budget = Math.max(...stripped.map((f) => f.patch.length), 0);
  while (budget > 0) {
    envelope.files = stripped.map((f) => ({ ...f, patch: truncateString(f.patch, budget) }));
    if (JSON.stringify(envelope).length <= cap) return envelope;
    budget = Math.floor(budget / 2);
  }
  // budget hit 0: patches collapse to their suffix only.
  envelope.files = stripped.map((f) => ({ ...f, patch: truncateString(f.patch, 0) }));
  return envelope;
}

export interface TruncatedMessages {
  truncated: true;
  omittedMessages: number;
  messages: unknown[];
}

/**
 * legate-ur1: cap a legate_session_messages payload. Under the cap → return the array
 * unchanged. Over the cap → drop the OLDEST messages (front of the array) one at a time
 * until the envelope fits, reporting truncated: true and how many were omitted.
 */
export function capMessagesResponse(
  messages: unknown[],
  cap: number = maxResponseChars(),
): unknown[] | TruncatedMessages {
  if (JSON.stringify(messages).length <= cap) return messages;

  const kept = [...messages];
  let omittedMessages = 0;
  // Loop re-serializes each iteration so the (growing) omittedMessages digits are counted.
  for (;;) {
    const envelope: TruncatedMessages = { truncated: true, omittedMessages, messages: kept };
    if (kept.length === 0 || JSON.stringify(envelope).length <= cap) return envelope;
    kept.shift();
    omittedMessages++;
  }
}
