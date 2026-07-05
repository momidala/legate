// legate-dxw: typed representation of OpenCode SDK API errors.
//
// Replaces the fragile pattern that was scattered across index.ts/handlers.ts:
// `throw new Error(JSON.stringify(error))` on the throw side, and downstream
// catch blocks that detected stale sessions by STRING-MATCHING the serialized
// JSON (`.message.includes('"status":404') || .includes('"NotFoundError"')`).
// That matching broke whenever the SDK changed how it serialized errors.
// Callers can now do `err instanceof OpenCodeApiError && err.isNotFound()`.

/**
 * Standalone 404 predicate. Preserves EXACTLY the semantics of the original
 * module-local isNotFound helper (former src/index.ts:111-115), including its
 * guard for non-object / null values: SDK { data, error } pairs surface a 404
 * as either { status: 404 } or { name: 'NotFoundError' } depending on the SDK
 * version and endpoint. Every other API error (400, 403, 500) is NOT a 404.
 */
export function isNotFound(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const e = raw as Record<string, unknown>;
  return e.status === 404 || e.name === 'NotFoundError';
}

/**
 * Typed wrapper around an OpenCode SDK error object. The Error `message` remains
 * JSON.stringify(raw) so user-visible error text is unchanged from the old
 * `throw new Error(JSON.stringify(error))` sites.
 */
export class OpenCodeApiError extends Error {
  /** HTTP-ish status pulled from raw.status when it is a number. */
  readonly status?: number;
  /** Error name pulled from raw.name when it is a string (e.g. 'NotFoundError'). */
  readonly errorName?: string;
  /** The original SDK error object, untouched. */
  readonly raw: unknown;

  constructor(raw: unknown) {
    super(JSON.stringify(raw));
    this.name = 'OpenCodeApiError';
    this.raw = raw;
    if (typeof raw === 'object' && raw !== null) {
      const e = raw as Record<string, unknown>;
      if (typeof e.status === 'number') this.status = e.status;
      if (typeof e.name === 'string') this.errorName = e.name;
    }
  }

  /** Same semantics as the standalone isNotFound helper, over the parsed fields. */
  isNotFound(): boolean {
    return this.status === 404 || this.errorName === 'NotFoundError';
  }
}

/** Factory that keeps call sites terse: `throw apiError(error)`. */
export function apiError(raw: unknown): OpenCodeApiError {
  return new OpenCodeApiError(raw);
}
