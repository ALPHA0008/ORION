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
 *   4 — adds stream.* (3 types). Streaming as DURABLE PARTIAL EXECUTION: a partially-completed
 *       model call leaves attributable evidence, so a crash mid-stream is recoverable and replay
 *       reconstructs the turn with no model call (Wave 4b).
 *   5 — adds resource.* (4), grant.* (2) and tool.output_delta (1) — 7 types, Wave 6.
 *
 *       Recovery 2.0: the runtime gains RESOURCES with durable identity, so resume can REATTACH
 *       to the sandbox a run was bound to instead of silently reconstructing a different one;
 *       approvals become durable, attributable facts rather than per-turn prompts; and a running
 *       command's output is observable while it runs.
 *
 *       The first two families are events rather than columns on purpose. TrueForge — the prior art —
 *       keeps resource identity in a mutable `TurnRecord.snapshot`, which is state beside the
 *       log: it would violate Invariant 1 and make replay non-deterministic. The current binding
 *       here is a FOLD over the log, exactly as `plan.*` works for plans.
 */
export const EVENT_CONTRACT_VERSION = 5;

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
  // live execution output (contract v5, Wave 6-L)
  //
  // A committed, incremental record of what a running command is printing, so a long `npm test`
  // is observable while it runs instead of only after it ends.
  //
  // Deliberately a NEW type rather than a reuse of `stream.*`. The streaming family's payloads
  // are model-specific — `model`, `provider`, `request_digest`, `ttft_ms` — and emitting a
  // `stream.started` carrying a model name for a shell command would put a false fact in the log
  // to save a type. The cadence mechanism is shared (bounded bytes/ms, never per line); the
  // vocabulary is not.
  //
  // Bounded exactly like `stream.delta`: the event carries a byte count and a short excerpt, and
  // the complete output still arrives in `tool.succeeded`. This is an observability record, not a
  // second copy of the output — replay reconstructs the result from the terminal event, so
  // dropping every delta would change nothing about what a run means.
  'tool.output_delta',
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
  // streaming (contract v4, Wave 4b)
  //
  // Streaming is NOT a rendering concern here — terminal output is a consumer of the stream,
  // never its purpose. These events make a partially-completed model call durable and
  // attributable: `stream.delta` is recorded at a BOUNDED cadence (never one event per token,
  // which would multiply the log by the token count) and promotes to an artifact once the
  // accumulation crosses the Wave 3 threshold.
  'stream.started', 'stream.delta', 'stream.finished',
  // resources (contract v5, Wave 6 — Recovery 2.0, plan §9.3)
  //
  // The first and most important resource is the SANDBOX. Recovery until now was effect-level:
  // "did this invocation's effect land?" It was silent about the handle the effect landed ON,
  // which was invisible only because `LocalSandbox` is reconstructed from a path every time and a
  // path is not stateful. A container is. If a run is killed and resumed, its sandbox is either
  // still alive (reattach), gone (recreate, and SAY SO), or unknown (escalate) — and before W6
  // the runtime had no vocabulary for any of those.
  //
  //   resource.acquired   — a resource was created and bound to this run. Carries the durable
  //                         identity, the backend's declared capabilities, and the posture
  //                         DERIVED from them (W6-G), so a later reader can see not just what
  //                         was allowed but why it could be.
  //   resource.reattached — a resume found the SAME resource, by identity, and rebound to it.
  //                         This is the event that distinguishes Recovery 2.0 from a silent
  //                         reconstruction.
  //   resource.released   — the run let the resource go deliberately. Terminal for that binding.
  //   resource.lost       — the resource was expected and is not there. NEVER silent: it records
  //                         what was lost and what was done about it (recreated / escalated), so
  //                         "the world changed under this run" is a fact in the trajectory
  //                         rather than an inference.
  'resource.acquired', 'resource.reattached', 'resource.released', 'resource.lost',
  // grants — approval memory (contract v5, Wave 6-M)
  //
  // An approval that is forgotten at the end of a turn is not an approval, it is a prompt. The
  // grant store makes "yes, `npm test` is fine in this project" a durable, attributable,
  // revocable fact. It is recorded as events for the same reason resources are: a grant decides
  // whether a future effect is allowed, so it must be reconstructible by replay rather than read
  // from mutable state beside the log.
  //
  //   grant.created — an approval was remembered. Records its scope (session / project /
  //                   command-pattern / resource), who decided it, and what it covers.
  //   grant.revoked — an approval was withdrawn. Present so the fold can express removal;
  //                   without it a grant store would be a one-way door.
  'grant.created', 'grant.revoked',
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
