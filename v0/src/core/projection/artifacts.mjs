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
