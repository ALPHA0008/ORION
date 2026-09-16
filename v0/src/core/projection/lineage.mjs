// W10 — LINEAGE: who delegated what to whom, folded from the log.
//
// The organising principle (plan §1.2) says a subagent is a child trajectory, not a side system.
// So there is no children table and no registry object. `child.spawned` and `child.finished` — both
// frozen members of the v6 vocabulary since the Wave-1 audit, reserved and never emitted until now
// — ARE the record, and everything below is a fold over them, exactly as `plan.mjs` folds
// `plan.*` into the current plan.
//
// WHY THIS MATTERS MORE THAN IT LOOKS
//
// If lineage were a column, three things would break the moment a run crashed. A parent resumed in
// a new process would not know what it had spawned. `replay` would have to re-execute children to
// rebuild the graph, violating Invariant 2 (deterministic replay at ZERO model cost). And `fork`
// would inherit rows describing children that belong to a different history. As a fold, all three
// fall out for free: the parent's own log already contains everything, replay reconstructs the
// graph without a single model call, and a fork carries the events it actually copied.
//
// A CHILD IS A REAL RUN, NOT A RECORD OF ONE
//
// `child.spawned` names a `child_run` that exists in the same event store with its own id, lease,
// plan and budget. This projection deliberately does NOT copy the child's trajectory into the
// parent — it holds a REFERENCE. The child's turns stay in the child's log where they belong, and
// the parent's context window stays bounded no matter how much work the child did. That is the
// whole reason delegation buys anything: a child has its own context window.

/** Terminal dispositions a child can reach, as recorded in `child.finished.status`. */
export const ChildStatus = Object.freeze({
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  LOST: 'lost',          // the child's run could not be accounted for on resume
});

/** A child that has been spawned and has not yet reported a terminal status. */
export const ChildState = Object.freeze({
  RUNNING: 'running',
  FINISHED: 'finished',
});

/** Statuses that mean the child did NOT deliver what it was asked for. */
const UNSUCCESSFUL = new Set([ChildStatus.FAILED, ChildStatus.CANCELLED, ChildStatus.LOST]);

/**
 * Fold one run's events into the children it spawned.
 *
 * @param {Array<{type: string, payload?: any, seq?: number, at?: number}>} events
 * @returns {{ children: any[], byId: Record<string, any>, running: any[],
 *             spawned: number, finished: number, failed: number, tokens: number }}
 */
export function projectLineage(events) {
  /** @type {Record<string, any>} */
  const byId = {};
  const order = [];

  for (const e of events ?? []) {
    if (e?.type !== 'child.spawned' && e?.type !== 'child.finished') continue;
    const p = e.payload ?? {};
    const id = p.child_run;
    if (!id) continue;

    if (e.type === 'child.spawned') {
      if (!byId[id]) order.push(id);
      byId[id] = {
        child_run: id,
        parent_run: p.parent_run ?? null,
        reason: p.reason ?? null,
        task: p.task ?? null,
        // The scopes the child was GRANTED, recorded at spawn. This is the evidence for "a child
        // cannot widen its parent's policy": the grant is in the log, so a later audit does not
        // have to trust that the code did the right thing.
        scopes: p.scopes ?? null,
        // Provenance the plan names explicitly (§10.2 W10): a child may run a different model, and
        // under what posture it ran must be answerable from the log alone (Invariant 6).
        model: p.model ?? null,
        provider: p.provider ?? null,
        posture: p.posture ?? null,
        isolated: p.isolated ?? null,
        depth: p.depth ?? 1,
        budget: p.budget ?? null,
        state: ChildState.RUNNING,
        status: null,
        result_ref: null,
        detail: null,
        tokens: 0,
        tool_calls: 0,
        spawned_at: e.at ?? null,
        spawned_seq: e.seq ?? null,
        finished_at: null,
        finished_seq: null,
      };
      continue;
    }

    // `child.finished` with no matching spawn is not nonsense — a log can be replayed from a
    // snapshot boundary that cut between the two — so synthesise rather than dropping the event,
    // the same accommodation `resource.mjs` makes for a reattach without an acquire.
    if (!byId[id]) {
      order.push(id);
      byId[id] = {
        child_run: id, parent_run: p.parent_run ?? null, reason: null, task: null,
        scopes: null, model: null, provider: null, posture: null, isolated: null,
        depth: p.depth ?? 1, budget: null, state: ChildState.RUNNING, status: null,
        result_ref: null, detail: null, tokens: 0, tool_calls: 0,
        spawned_at: null, spawned_seq: null, finished_at: null, finished_seq: null,
      };
    }
    const c = byId[id];
    c.state = ChildState.FINISHED;
    c.status = p.status ?? ChildStatus.FAILED;
    c.result_ref = p.result_ref ?? null;
    c.detail = p.detail ?? null;
    c.tokens = Number(p.tokens ?? 0) || 0;
    c.tool_calls = Number(p.tool_calls ?? 0) || 0;
    c.finished_at = e.at ?? null;
    c.finished_seq = e.seq ?? null;
    // Provenance can arrive on either event: a child that died before its first model call still
    // has a posture, and one that switched model mid-flight records what actually served it.
    if (p.model && !c.model) c.model = p.model;
    if (p.provider && !c.provider) c.provider = p.provider;
  }

  const children = order.map(id => byId[id]);
  return {
    children,
    byId,
    running: children.filter(c => c.state === ChildState.RUNNING),
    spawned: children.length,
    finished: children.filter(c => c.state === ChildState.FINISHED).length,
    failed: children.filter(c => UNSUCCESSFUL.has(c.status)).length,
    tokens: children.reduce((n, c) => n + c.tokens, 0),
  };
}

/**
 * Children this run believes are still live.
 *
 * Read on resume: a child in this list either has a run that can be reacquired, or is genuinely
 * gone and must be recorded `lost` rather than quietly forgotten. "Quietly forgotten" is the
 * failure mode — a parent that resumes and never mentions the child it was waiting on has lost
 * work without saying so.
 */
export const liveChildren = (events) => projectLineage(events).running;

/**
 * Total tokens spent by every child of this run.
 *
 * The parent's aggregate budget has to include work it delegated, or delegation becomes a way to
 * spend without limit: ten children at the per-child cap would otherwise cost ten times the
 * parent's ceiling while the parent's own counter reads nearly zero.
 */
export const childTokens = (events) => projectLineage(events).tokens;

/**
 * One-line-per-child summary for `explain`.
 *
 * Deliberately names the model and posture on every row. "Which model did the work, under which
 * boundary" is the question a reviewer asks about delegated work first, and a summary that omits
 * it forces them back into the raw log.
 */
export function summariseLineage(events) {
  const { children } = projectLineage(events);
  if (!children.length) return null;
  return children.map((c) => {
    const bits = [`${c.child_run}`, c.state === ChildState.RUNNING ? 'running' : String(c.status)];
    if (c.model) bits.push(c.model);
    if (c.posture) bits.push(`posture ${c.posture}`);
    if (c.tokens) bits.push(`${c.tokens}tok`);
    if (c.depth > 1) bits.push(`depth ${c.depth}`);
    return `  ${bits.join('  ')}${c.task ? `  — ${String(c.task).slice(0, 60)}` : ''}`;
  }).join('\n');
}

/**
 * Walk a whole family tree across runs.
 *
 * A child may spawn a grandchild (scope §6), so lineage is compositional: the graph is assembled by
 * reading each child's own log rather than by keeping a global index. `readEvents` is injected so
 * this stays a pure fold over whatever the caller can supply — a Store, a replayed array, a test
 * fixture — and so a cycle or a runaway depth cannot wedge the traversal.
 */
export function lineageTree(rootRunId, readEvents, { maxDepth = 8, maxNodes = 200 } = {}) {
  const seen = new Set();
  let nodes = 0;

  const visit = (runId, depth) => {
    if (depth > maxDepth || nodes >= maxNodes) return { run: runId, depth, truncated: true, children: [] };
    // A cycle is impossible by construction (a child id is fresh), but a malformed or hand-edited
    // log could still describe one, and a projection that hangs is worse than one that says so.
    if (seen.has(runId)) return { run: runId, depth, cycle: true, children: [] };
    seen.add(runId);
    nodes += 1;

    const { children } = projectLineage(readEvents(runId) ?? []);
    return {
      run: runId,
      depth,
      truncated: false,
      children: children.map(c => ({ ...c, tree: visit(c.child_run, depth + 1) })),
    };
  };

  return visit(rootRunId, 0);
}
