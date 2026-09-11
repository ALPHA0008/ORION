// Model errors, in their own module.
//
// Extracted from index.mjs in Wave 4 so a provider implementation can import it without importing
// the factory that imports the provider — a cycle that would otherwise appear the moment a second
// provider existed. `index.mjs` re-exports it, so the public surface is unchanged.

export class ModelError extends Error {
  /** @type {any} Partial stream accumulation, present when a stream died mid-flight (W5 Q1). */
  partial;
  /**
   * @type {number|undefined} How long the retry loop waited before re-issuing, in ms — either the
   * provider's own `Retry-After` or the computed backoff. Assigned at the retry site and read back
   * there; declared here because a field only ever set from outside the class is invisible to the
   * type checker, which is the same declare-once gap `partial` above was fixing.
   */
  retryAfterMs;
  constructor(msg, { retryable = false, status = null, kind = 'unknown' } = {}) {
    super(msg); this.name = 'ModelError';
    this.retryable = retryable; this.status = status; this.kind = kind;
  }
}
