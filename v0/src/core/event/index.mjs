// Core event vocabulary.
// ADR-004: event TYPES are closed (the reducer must be total); PAYLOADS are extensible
// via `payload.ext` so provider metadata (cost, latency, cache, uuids) survives adaptation.

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
  'child.spawned', 'child.finished',
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
