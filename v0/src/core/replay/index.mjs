// ADR-007 — replay vs fork vs rerun. These are three different operations and the API
// must never blur them, because only one of them is free of model nondeterminism.
//
//   replay(run, at?)  -> reconstruct historical state.  NO model calls. Deterministic.
//   fork(run, at)     -> new Run seeded with history[1..at]. Future is NEW (model will be called).
//   rerun(task)       -> brand new Run from the same task. Shares nothing but intent.
//
// Replay MUST NOT imply that re-executing the model would produce the same output.

import { project } from '../projection/index.mjs';
import { uid } from '../run/store.mjs';

/** Reconstruct historical state. Pure read. Never invokes a model. */
export function replay(store, runId, { at = null } = {}) {
  const upToSeq = at ?? Number.MAX_SAFE_INTEGER;
  const state = project(store, runId, { upToSeq, useSnapshot: false });
  return {
    kind: 'replay',
    run_id: runId,
    at: at ?? store.lastSeq(runId),
    state,
    model_calls_made: 0,          // structurally zero — replay does not call a model
    deterministic: true,
  };
}

/** Verify that snapshot-assisted projection equals full replay (Phase B invariant). */
export function verifyProjectionEquivalence(store, runId) {
  const cold = project(store, runId, { useSnapshot: false });
  const warm = project(store, runId, { useSnapshot: true });
  return { equal: JSON.stringify(cold) === JSON.stringify(warm), cold, warm };
}

/**
 * Fork: create a NEW run seeded with the source's history up to `atSeq`.
 * The copied prefix is historical fact; everything after is a new future.
 */
export function fork(store, srcRunId, atSeq, { newRunId = uid('run'), scope = null, principal = null } = {}) {
  const src = store.run(srcRunId);
  if (!src) throw new Error(`no such run: ${srcRunId}`);
  const last = store.lastSeq(srcRunId);
  if (!Number.isInteger(atSeq) || atSeq < 1 || atSeq > last)
    throw new RangeError(`fork point ${atSeq} out of range 1..${last}`);

  const prefix = store.events(srcRunId, 0, atSeq);

  // FINDING (real-model Step 12): forking MID-TURN is semantically ambiguous.
  // If the prefix ends with an assistant message that requested tools but has no terminal
  // tool event, transcript repair fills the gap with "[no result recorded]" — and a real model
  // read that as "already done" and replied DONE without redoing the work.
  // We do not forbid it (a mid-turn fork is sometimes exactly what you want), but the caller
  // must be told, so this is reported rather than silently accepted.
  const openToolCalls = openToolCallsAt(prefix);
  const atTurnBoundary = openToolCalls.length === 0;

  store.tx(() => {
    store.db.prepare(`INSERT INTO runs (id,parent_run_id,forked_from_seq,scope,principal,status,attempts,created_at,task)
                      VALUES (?,?,?,?,?,'pending',0,?,?)`)
      .run(newRunId, srcRunId, atSeq, scope ?? src.scope, principal ?? src.principal, Date.now(), src.task);
    const ins = store.db.prepare('INSERT INTO events (run_id,seq,type,at,causation_id,payload) VALUES (?,?,?,?,?,?)');
    for (const e of prefix)
      ins.run(newRunId, e.seq, e.type, e.at, e.causation_id, e.payload == null ? null : JSON.stringify(e.payload));
  });

  // Mark the seam explicitly so `explain` can show where history stops and the new future starts.
  store.append(newRunId, 'run.resumed', {
    forked_from: srcRunId, at_seq: atSeq, seam: true,
    at_turn_boundary: atTurnBoundary,
    ...(atTurnBoundary ? {} : { open_tool_calls: openToolCalls }),
  });
  if (!atTurnBoundary)
    store.append(newRunId, 'degraded', { subsystem: 'fork',
      reason: `forked mid-turn: ${openToolCalls.length} tool call(s) requested but not resolved ` +
              `(${openToolCalls.join(', ')}). The resumed model sees "[no result recorded]" for these ` +
              `and may treat them as already done.` });
  return { kind: 'fork', run_id: newRunId, parent_run_id: srcRunId, forked_from_seq: atSeq,
           at_turn_boundary: atTurnBoundary, open_tool_calls: openToolCalls };
}

/** Tool calls the model asked for but which have no terminal event within `events`. */
function openToolCallsAt(events) {
  const wanted = new Map();
  for (const e of events) {
    if (e.type === 'model.responded')
      for (const tc of e.payload?.tool_calls ?? []) wanted.set(tc.id, tc.name);
    if (['tool.succeeded', 'tool.failed', 'tool.denied', 'tool.timed_out'].includes(e.type))
      wanted.delete(e.payload?.tool_call_id);
  }
  return [...wanted.entries()].map(([id, name]) => `${name}#${id}`);
}

/** Suggest the nearest earlier seq that IS a clean turn boundary. */
export function nearestTurnBoundary(store, runId, atSeq) {
  for (let s = atSeq; s >= 1; s--)
    if (openToolCallsAt(store.events(runId, 0, s)).length === 0) return s;
  return 1;
}

/** Rerun: a brand-new run from the same task. Shares no history. */
export function rerun(store, srcRunId, { newRunId = uid('run') } = {}) {
  const src = store.run(srcRunId);
  if (!src) throw new Error(`no such run: ${srcRunId}`);
  store.createRun(newRunId, { scope: src.scope, principal: src.principal, task: src.task });
  return { kind: 'rerun', run_id: newRunId, source_run_id: srcRunId, task: src.task };
}
