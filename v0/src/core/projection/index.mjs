// Bounded state projection.
// ADR-001: the hot projection MUST NOT grow with conversation length. Experiment 1 measured
// an unbounded projection at 8 MB @100k events and p99=100.26ms on Postgres (target 50ms).
// Bounded: 10.2 KB at 1,000,000 events, p99 0.07ms. Full history lives in the event log.

export const WINDOW = 40;            // messages retained hot
export const DEGRADE_WINDOW = 10;    // recent degradations retained hot
// ADR-001 refinement (found in Phase H Test 7): capping the message COUNT is not enough —
// a window of 40 large tool results still grows the projection. Cap per-message bytes too,
// so hot state is bounded by WINDOW x MSG_CLAMP regardless of payload size. Full content
// stays in the event log and is retrievable.
export const MSG_CLAMP = 2_000;

function clampContent(text) {
  const s = String(text ?? '');
  if (s.length <= MSG_CLAMP) return s;
  return s.slice(0, MSG_CLAMP) + `
…[+${s.length - MSG_CLAMP} chars in the event log]`;
}

export function emptyState(runId) {
  return {
    run_id: runId,
    status: 'pending',
    seq: 0,
    // --- bounded conversation view ---
    recent_messages: [],
    message_count: 0,
    dropped_message_count: 0,
    elided_message_count: 0,
    // --- open items only (naturally bounded) ---
    pending_tool_calls: {},
    open_human_requests: {},
    // --- counters ---
    budget: { tokens: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
              cost_usd: 0, tool_calls: 0, model_calls: 0, turns: 0 },
    // --- degradation: count is unbounded-safe, list is windowed ---
    degradation_count: 0,
    recent_degradations: [],
    // --- no-progress detection (ADR-006) ---
    progress: { last_success_turn: 0, turns_without_progress: 0, repeat_key: null, repeat_count: 0,
                consecutive_model_failures: 0 },
    // --- terminal ---
    result: null,
    exit_reason: null,
    // --- lease view (informational; authority is the runs table) ---
    worker_id: null,
    attempts: 0,
  };
}

export function applyEvent(s, e) {
  const p = e.payload || {};
  s.seq = e.seq;

  const push = (m) => {
    s.message_count++;
    if (typeof m.content === 'string') m = { ...m, content: clampContent(m.content) };
    s.recent_messages.push(m);
    while (s.recent_messages.length > WINDOW) { s.recent_messages.shift(); s.dropped_message_count++; }
  };

  switch (e.type) {
    case 'run.created':       s.status = 'pending'; break;
    case 'run.leased':        s.status = 'running'; s.worker_id = p.worker_id; s.attempts++; break;
    case 'run.lease_renewed': break;
    case 'run.lease_lost':    s.worker_id = null; break;
    case 'run.paused':        s.status = 'paused'; s.worker_id = null; s.exit_reason = p.reason ?? s.exit_reason; break;
    case 'run.resumed':       s.status = 'running'; break;
    case 'run.parked':        s.status = 'parked'; s.exit_reason = p.reason ?? 'parked'; break;
    case 'run.completed':     s.status = 'completed'; s.result = p.result ?? null; s.exit_reason = p.reason ?? 'completed'; break;
    case 'run.failed':        s.status = 'failed'; s.exit_reason = p.reason ?? 'failed'; break;

    case 'turn.started':
      s.budget.turns++;
      push({ role: 'user', content: p.input ?? '' });
      break;
    case 'turn.finished':     break;

    case 'model.requested':   s.budget.model_calls++; break;
    case 'model.responded': {
      // ADR-006: progress is measured per MODEL ROUND-TRIP, not per user turn.
      // A run makes one turn.started but many model round-trips; counting turns
      // would never trip the detector.
      s.progress.turns_without_progress++;
      s.progress.consecutive_model_failures = 0;
      s.budget.input_tokens  += p.input_tokens  || 0;
      s.budget.output_tokens += p.output_tokens || 0;
      s.budget.tokens        += (p.input_tokens || 0) + (p.output_tokens || 0);
      s.budget.cache_read_tokens += p.cache_read_tokens || 0;
      if (typeof p.cost_usd === 'number') s.budget.cost_usd = round6(s.budget.cost_usd + p.cost_usd);
      push({ role: 'assistant', content: p.content ?? '', tool_calls: p.tool_calls ?? null });
      break;
    }
    case 'model.failed':
      // ADR-006: a model that ALWAYS fails never emits model.responded, so the
      // turns_without_progress counter would never advance. Track failures separately.
      s.progress.consecutive_model_failures++;
      break;

    case 'tool.requested': {
      // ADR-006: repeated identical requests are the primary no-progress signal.
      const key = `${p.name}:${stableDigest(p.args)}`;
      if (s.progress.repeat_key === key) s.progress.repeat_count++;
      else { s.progress.repeat_key = key; s.progress.repeat_count = 1; }
      break;
    }
    case 'tool.authorized':   break;
    case 'tool.escalated':
      s.pending_tool_calls[p.tool_call_id] = { name: p.name, args: p.args, escalated: true };
      break;
    case 'tool.denied':
      delete s.pending_tool_calls[p.tool_call_id];
      push({ role: 'tool', tool_call_id: p.tool_call_id, name: p.name, content: `DENIED: ${p.reason ?? ''}` });
      break;
    case 'tool.started':
      s.pending_tool_calls[p.tool_call_id] = { name: p.name, args: p.args };
      s.budget.tool_calls++;
      break;
    case 'tool.succeeded':
      delete s.pending_tool_calls[p.tool_call_id];
      s.progress.turns_without_progress = 0;
      s.progress.last_success_turn = s.budget.turns;
      push({ role: 'tool', tool_call_id: p.tool_call_id, name: p.name, content: p.result ?? '' });
      break;
    case 'tool.failed':
    case 'tool.timed_out':
      delete s.pending_tool_calls[p.tool_call_id];
      push({ role: 'tool', tool_call_id: p.tool_call_id, name: p.name,
             content: `ERROR (${e.type}): ${p.error ?? ''}` });
      break;
    case 'tool.recovery_decided':
      // bookkeeping only; the follow-up terminal tool event mutates state
      break;

    case 'context.compacted': {
      // Two distinct things share this event type, and they must not be conflated:
      //   `dropped` — messages removed from the hot window entirely (content no longer sent).
      //   `elided`  — superseded tool results replaced by a marker in the OUTBOUND message
      //               array only (compact.mjs). Hot state is unchanged, so this must NOT
      //               increment dropped_message_count or the "N earlier messages are not
      //               shown" notice would overcount and mislead the model.
      s.dropped_message_count += p.dropped ?? 0;
      s.elided_message_count = (s.elided_message_count ?? 0) + (p.elided ?? 0);
      break;
    }
    case 'context.retrieved': break;

    case 'human.requested':
      s.open_human_requests[p.request_id] = { prompt: p.prompt, tool_call_id: p.tool_call_id ?? null };
      break;
    case 'human.responded':
      delete s.open_human_requests[p.request_id];
      s.progress.turns_without_progress = 0;   // a human answering is progress
      break;
    case 'human.timed_out':
      delete s.open_human_requests[p.request_id];
      break;

    case 'child.spawned':  break;
    case 'child.finished': break;

    case 'degraded':
      s.degradation_count++;
      s.recent_degradations.push({ subsystem: p.subsystem, reason: p.reason, at: e.at });
      while (s.recent_degradations.length > DEGRADE_WINDOW) s.recent_degradations.shift();
      break;

    default:
      // Unreachable: Store.append rejects unknown types (ADR-004). Defensive only.
      break;
  }
  return s;
}

export function fold(events, base) {
  let s = base ?? emptyState(events.length ? events[0].run_id : null);
  for (let i = 0; i < events.length; i++) s = applyEvent(s, events[i]);
  return s;
}

/**
 * Project a run's state. Uses the newest snapshot at or before `upToSeq`, then replays the tail.
 * `useSnapshot:false` forces a full replay from event 1 (used by determinism tests).
 */
export function project(store, runId, { upToSeq = Number.MAX_SAFE_INTEGER, useSnapshot = true } = {}) {
  let base = null, from = 0;
  if (useSnapshot) {
    const snap = store.getSnapshot(runId, upToSeq);
    if (snap) { base = structuredClone(snap.state); from = snap.seq; }
  }
  return fold(store.events(runId, from, upToSeq), base ?? emptyState(runId));
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Stable, order-independent digest of tool arguments (used for repeat detection). */
export function stableDigest(v) {
  return JSON.stringify(sortKeys(v ?? null));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
