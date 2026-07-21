// legate-tcg: server-side credential redaction for legate_get_config.
//
// legate_get_config returns the FULL OpenCode config, which can carry provider
// API keys, tokens, and other credentials. Because a compromised/prompt-injected
// caller could exfiltrate those by simply invoking the tool, we redact any field
// whose KEY looks credential-shaped before the value ever leaves this process.
// This is defense-in-depth (MCP clients still gate tool calls behind user
// approval), not the only line of defense.

// legate-tcg: match on the KEY name, not the value — value shapes are unreliable
// (a token can be any string) but credential keys follow well-known naming.
const SECRET_KEY_RE = /apiKey|api_key|token|secret|password|credential|authorization/i;

const REDACTED = '[REDACTED]';
const REDACTED_CYCLE = '[REDACTED:cycle]';

/**
 * Deep-clones `value`, replacing the value of any property whose KEY matches
 * SECRET_KEY_RE with the literal string '[REDACTED]'. A matched key's value is
 * replaced wholesale — arrays and nested objects under a secret key are NOT
 * descended into (the whole subtree becomes '[REDACTED]'). Non-matching keys
 * are descended recursively. Primitives and null pass through untouched.
 *
 * The input is never mutated (this returns a fresh structure). Non-secret values
 * are deep-equal to their inputs. Reference cycles are handled defensively via a
 * per-walk WeakSet: a value already on the current descent path is replaced with
 * '[REDACTED:cycle]' rather than recursed into.
 */
export function redactSecrets(value: unknown): unknown {
  return redactWalk(value, new WeakSet<object>());
}

function redactWalk(value: unknown, seen: WeakSet<object>): unknown {
  // Primitives (and null) pass through unchanged.
  if (value === null || typeof value !== 'object') return value;

  // legate-tcg: path-based cycle guard — add before descending, remove after, so
  // that shared (non-cyclic) references are cloned normally and only true cycles
  // (a node reachable from itself) collapse to the cycle sentinel.
  if (seen.has(value)) return REDACTED_CYCLE;
  seen.add(value);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => redactWalk(item, seen));
  } else {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      // legate-tcg: matched key → replace value wholesale, do NOT descend.
      out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redactWalk(val, seen);
    }
    result = out;
  }

  seen.delete(value);
  return result;
}
