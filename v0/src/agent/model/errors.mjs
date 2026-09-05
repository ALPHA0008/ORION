// Model errors, in their own module.
//
// Extracted from index.mjs in Wave 4 so a provider implementation can import it without importing
// the factory that imports the provider — a cycle that would otherwise appear the moment a second
// provider existed. `index.mjs` re-exports it, so the public surface is unchanged.

export class ModelError extends Error {
  constructor(msg, { retryable = false, status = null, kind = 'unknown' } = {}) {
    super(msg); this.name = 'ModelError';
    this.retryable = retryable; this.status = status; this.kind = kind;
  }
}
