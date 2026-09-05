// Artifacts: stable, hashed, provenance-bearing references to oversized tool output (Wave 3).
//
// The important design decision is what an artifact is NOT. It is not a second storage system,
// and it does not copy content anywhere. The full text of a large tool result ALREADY lives
// durably in its `tool.succeeded` event — the projection merely clamps it to MSG_CLAMP before
// showing it to the model. What was missing was identity: nothing could name that content, prove
// it had not changed, or point back to where it came from.
//
// So an artifact is a DERIVED INDEX ENTRY over the log:
//
//     tool.succeeded (seq 37, 41 kB)  ──▶  artifact.created { id, source_seq: 37, sha256, bytes }
//                                              │
//     outbound message / compaction placeholder ┘  references artifact:ab12cd34
//
// That buys three things the clamp alone could not:
//
//   - the model, and the human reading `explain`, can SEE that content exists and how much of it
//     was withheld, rather than a silently truncated tail;
//   - a compaction placeholder can point AT the evidence instead of orphaning it, which is what
//     keeps evidence integrity intact once compaction is on by default;
//   - the sha256 makes it checkable — an artifact referenced later is provably the same bytes.
//
// Everything here is a pure fold over events, exactly like the plan projection. Nothing is
// stored, so replay, fork and resume reconstruct the identical artifact set for free.

import crypto from 'node:crypto';

/** Content at or above this size earns an artifact. Below it, the clamp is already enough. */
export const ARTIFACT_MIN_BYTES = 4_096;

/** How much of the content the reference carries inline, so a preview costs no lookup. */
export const ARTIFACT_PREVIEW_BYTES = 240;

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * A content-addressed id. Deriving it from the bytes rather than from a counter means the same
 * content yields the same id on replay, on a fork, and in another process — an artifact id is
 * therefore reproducible evidence rather than a session-local handle.
 */
export const artifactId = (content) => `a_${sha256(content).slice(0, 10)}`;

/** Should this tool result become an artifact? */
export function qualifiesAsArtifact(content, { minBytes = ARTIFACT_MIN_BYTES } = {}) {
  return Buffer.byteLength(String(content ?? '')) >= minBytes;
}

/**
 * Build the `artifact.created` payload for a tool result.
 * `sourceSeq` is the provenance link — the event whose payload holds the full bytes.
 */
export function describeArtifact({ content, tool, target = null, sourceSeq = null }) {
  const text = String(content ?? '');
  return {
    artifact_id: artifactId(text),
    source_seq: sourceSeq,
    tool: tool ?? null,
    target,                                   // the path/command the content describes, if any
    bytes: Buffer.byteLength(text),
    sha256: sha256(text),
    preview: text.slice(0, ARTIFACT_PREVIEW_BYTES),
  };
}

/** Fold `artifact.created` events into an id -> record map. */
export function projectArtifacts(events) {
  const out = new Map();
  for (const e of events ?? []) {
    if (e.type !== 'artifact.created') continue;
    const p = e.payload ?? {};
    if (!p.artifact_id) continue;
    out.set(p.artifact_id, { ...p, created_seq: e.seq ?? null });
  }
  return out;
}

/**
 * Retrieve an artifact's FULL bytes by following its provenance back to the source event.
 *
 * This is the reason the source_seq link matters: the artifact record is an index, and the log
 * is the storage. If the source event cannot be found the answer is an explicit miss — never a
 * silent empty string, which would read as "the content was empty" rather than "we lost it".
 */
export function resolveArtifact(events, artifactId) {
  const rec = projectArtifacts(events).get(artifactId);
  if (!rec) return { ok: false, reason: 'no such artifact', content: null };
  const src = (events ?? []).find(e => e.seq === rec.source_seq);
  if (!src) return { ok: false, reason: `source event #${rec.source_seq} not found`, content: null, record: rec };
  const content = String(src.payload?.result ?? '');
  // Integrity: the log is append-only, so a mismatch means the reference is not what it claims.
  const intact = sha256(content) === rec.sha256;
  return { ok: intact, reason: intact ? null : 'sha256 mismatch', content, record: rec, verified: intact };
}

/** One-line human rendering, used by `explain` and the CLI. */
export function summariseArtifact(rec) {
  const kb = (rec.bytes / 1024).toFixed(1);
  return `${rec.artifact_id}  ${String(rec.tool ?? '?').padEnd(7)} ${kb}kB  ${rec.target ?? ''}`.trimEnd();
}

// ── Request provenance (Wave 4a) ────────────────────────────────────────────
//
// Lives here, beside the artifact hashing, for two reasons: it reuses the same `sha256`, and it is
// the same SHAPE of idea — a link plus a hash rather than a copy. Deliberately NOT in
// core/recovery, which stays a recovery-classification module (the standing isKnownDangerous vs
// classifyShell boundary).

/**
 * Stable JSON: object keys sorted at every level, so two structurally identical requests digest
 * identically regardless of key order. Without this the digest would be an accident of
 * serialisation order and could not answer "was this the same request?".
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + stableStringify(value[k]))
    .join(',') + '}';
}

/**
 * Digest of the NORMALISED request — messages, tool definitions and the parameters that actually
 * change the outcome.
 *
 * A digest, not the request itself. Storing the full request would duplicate the entire context
 * into the log on every single turn, which is exactly the unbounded-blob problem Wave 3 exists to
 * avoid. 64 hex characters answer the question that matters: was this the same request?
 *
 * This is what makes model-vs-provider-vs-harness attribution possible (master plan §9). Two runs
 * that behaved differently can now be compared at the request level instead of guessed at.
 */
export function requestDigest({ messages = [], tools = [], params = {} } = {}) {
  return sha256(stableStringify({ messages, tools, params }));
}

/**
 * Host of an endpoint, and ONLY the host.
 *
 * Never the full URL. A base URL can carry a key in a query string or in userinfo, and a
 * trajectory is meant to be readable and shareable evidence. The host answers "which endpoint
 * family served this?" without carrying anything secret. Unparseable input yields null rather
 * than the raw string, so a malformed URL cannot leak by falling through.
 */
export function endpointHost(url) {
  try { return new URL(String(url)).host || null; } catch { return null; }
}

/**
 * Strip secrets out of text that is about to be written to the log.
 *
 * FOUND BY THE WAVE 4 LEAK SCAN, and not in the provenance code. `fetch` refuses a URL carrying
 * credentials with an error that ECHOES THE FULL URL BACK, and the worker records provider error
 * messages verbatim:
 *
 *   model.failed: "Request cannot be constructed from a URL that includes credentials:
 *                  http://someuser:SUPERSECRET@127.0.0.1:8000/v1/chat/completions"
 *
 * So a secret can reach the trajectory through an ERROR STRING even when every field the runtime
 * chooses to record is clean. A trajectory is meant to be shareable evidence, so this is scrubbed
 * where it is written rather than only where it is displayed — redaction at render time would
 * leave the secret sitting in the durable log.
 *
 * Deliberately narrow: URL userinfo and the common bearer/`sk-` token shapes. It is a safety net
 * for text the runtime did not author, NOT a general secret scanner — pretending otherwise would
 * invite reliance it cannot support.
 */
export function redactSecrets(text) {
  return String(text ?? '')
    // scheme://user:pass@host  ->  scheme://<redacted>@host
    .replace(/([a-zA-Z][\w+.-]*:\/\/)[^/\s@]+@/g, '$1<redacted>@')
    .replace(/\b(sk-|pk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g, '$1<redacted>')
    .replace(/\b(Bearer|x-api-key|authorization)\s*[:=]?\s*[A-Za-z0-9._-]{8,}/gi, '$1 <redacted>');
}
