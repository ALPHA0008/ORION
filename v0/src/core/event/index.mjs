// Core event vocabulary.
// ADR-004: event TYPES are closed (the reducer must be total); PAYLOADS are extensible
// via `payload.ext` so provider metadata (cost, latency, cache, uuids) survives adaptation.

/**
 * Version of the event vocabulary.
 *
 * The type set is CLOSED, so growing it is a contract change and must be visible rather than
 * silent. A log written under an earlier version replays unchanged — members are only ever
 * added, never removed or renamed, because removal would break replay of existing logs.
 *
 *   1 — 31 types. The original frozen set.
 *   2 — adds plan.* (4 types). Planning as derived-but-durable trajectory structure (Wave 2).
 *   3 — adds artifact.created (1 type). Oversized tool output gains a hashed, provenance-bearing
 *       identity so it can be referenced instead of inlined, and so a compaction placeholder
 *       points at evidence rather than orphaning it (Wave 3).
 */
export const EVENT_CONTRACT_VERSION = 3;

export const EVENT_TYPES = Object.freeze([
  // lifecycle
  'run.created', 'run.leased', 'run.lease_renewed', 'run.lease_lost',
  'run.paused', 'run.resumed', 'run.parked', 'run.completed', 'run.failed',
  // turn
  'turn.started', 'turn.finished',
  // model
  'model.requested', 'model.responded', 'model.failed',
  // tool
  'tool.requested', 'tool.authorized', 'tool.denied', 'tool.escalated',
  'tool.started', 'tool.succeeded', 'tool.failed', 'tool.timed_out',
  // recovery (ADR-002/003)
  'tool.recovery_decided',
  // context / memory
  'context.compacted', 'context.retrieved',
  // human
  'human.requested', 'human.responded', 'human.timed_out',
  // children
  // RESERVED (Wave 1 audit): declared in the closed vocabulary but not yet emitted by any code
  // path. They are kept here deliberately rather than removed, because the type set is frozen
  // and removing a member would be a breaking contract change for anything replaying an older
  // log. Emitted when the corresponding capability lands:
  //   child.spawned / child.finished — subagents as child trajectories (a later wave)
  //   context.retrieved              — retrieval/memory (a later wave)
  // `turn.finished` was in this state too; Wave 1 now emits it on normal turn completion.
  'child.spawned', 'child.finished',
  // planning (contract v2, Wave 2)
  //
  // A plan is DERIVED state, not a side system: these events are the only durable record, and
  // the current plan is a fold over them (see core/projection/plan.mjs). Nothing about a plan
  // is held in worker memory, which is what makes a plan survive a crash and reconstruct
  // identically under replay and fork.
  'plan.created', 'plan.revised', 'plan.step_started', 'plan.step_finished',
  // artifacts (contract v3, Wave 3)
  //
  // An artifact does NOT copy content. The full bytes stay in the `tool.succeeded` event this
  // record points at; the artifact adds identity (content-addressed id), integrity (sha256) and
  // provenance (source_seq). See core/projection/artifacts.mjs.
  'artifact.created',
  // degradation (ADR: named degradation — never silent fallback)
  'degraded',
]);

const TYPE_SET = new Set(EVENT_TYPES);
export const isKnownType = (t) => TYPE_SET.has(t);

/** Terminal statuses — a run in one of these is finished and must never be re-terminalized. */
export const TERMINAL = Object.freeze(new Set(['completed', 'failed', 'parked']));

/**
 * Promoted-to-core fields (ADR-004): every provider has cost and latency, and they answer
 * first-order operational questions, so they are first-class rather than buried in ext.
 */
export function modelRespondedPayload({
  content = '', tool_calls = null,
  input_tokens = 0, output_tokens = 0,
  cache_read_tokens = 0, cache_write_tokens = 0,
  cost_usd = null, ttft_ms = null, duration_ms = null,
  ext = undefined,
} = {}) {
  const p = { content, tool_calls, input_tokens, output_tokens,
              cache_read_tokens, cache_write_tokens, cost_usd, ttft_ms, duration_ms };
  if (ext && Object.keys(ext).length) p.ext = ext;
  return p;
}

export class UnknownEventType extends Error {
  constructor(type) { super(`unknown event type: ${String(type)}`); this.name = 'UnknownEventType'; this.type = type; }
}
