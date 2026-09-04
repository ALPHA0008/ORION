// Planning as a DERIVED projection over the authoritative event log (Wave 2).
//
// The whole design rests on one rule: a plan is never held in memory. `plan.created`,
// `plan.revised`, `plan.step_started` and `plan.step_finished` are the only durable record, and
// the current plan is a pure fold over them. Everything else follows from that:
//
//   - a plan survives a crash, because the worker holds none of it;
//   - `resume` reconstructs the identical plan, because it folds the same events;
//   - `replay` and `fork` reconstruct it too, at zero model cost;
//   - a revision cannot lose history, because `plan.revised` is appended, never overwritten.
//
// This is deliberately NOT a workflow engine. There is no scheduler, no execution graph and no
// step runner. The model decides what to do next; these events record what it declared and what
// actually happened, so the claim "the task is done" becomes checkable rather than asserted.

/** A step id is derived from its position at declaration time, so it is stable across a fold. */
const stepId = (revision, index) => `s${revision}.${index + 1}`;

/**
 * Normalise a declared step list into records.
 * Accepts plain strings (the common case) or `{ title, depends_on }` objects.
 */
export function normaliseSteps(steps, revision) {
  return (Array.isArray(steps) ? steps : []).map((s, i) => {
    const title = typeof s === 'string' ? s : String(s?.title ?? '').trim();
    const dependsOn = typeof s === 'object' && s !== null && s.depends_on != null
      ? (Array.isArray(s.depends_on) ? s.depends_on : [s.depends_on]).map(String)
      // Default dependency is the previous step: a plan is an ordered list unless it says
      // otherwise. Making this explicit means `blockedSteps` never has to guess.
      : (i > 0 ? [stepId(revision, i - 1)] : []),
    id = stepId(revision, i);
    return { id, title, depends_on: dependsOn, state: 'pending', evidence: null, retry: 0 };
  });
}

/**
 * Fold plan events into the current plan.
 *
 * @param {Array} events  the run's events, in order
 * @returns {null | {goal, revision, steps, history}} null when the run has no plan
 */
export function projectPlan(events) {
  let plan = null;
  const history = [];        // every superseded step list, oldest first — a revision never erases

  for (const e of events ?? []) {
    const p = e.payload ?? {};
    switch (e.type) {
      case 'plan.created':
        plan = { goal: String(p.goal ?? ''), revision: 1,
                 steps: normaliseSteps(p.steps, 1), history: [] };
        break;

      case 'plan.revised': {
        if (!plan) {              // a revision with no prior plan is still a plan
          plan = { goal: String(p.goal ?? ''), revision: 1, steps: normaliseSteps(p.steps, 1), history: [] };
          break;
        }
        // Preserve what is being replaced BEFORE replacing it. T2 asserts on this: replanning
        // must not be a destructive in-place edit, or the trajectory would no longer explain
        // why the run did what it did.
        history.push({ revision: plan.revision, goal: plan.goal, steps: plan.steps,
                       reason: String(p.reason ?? '') });
        const revision = plan.revision + 1;
        plan = { goal: String(p.goal ?? plan.goal), revision,
                 steps: normaliseSteps(p.steps, revision), history: [...history] };
        break;
      }

      case 'plan.step_started': {
        const s = plan?.steps.find(x => x.id === p.step_id);
        if (s) s.state = 'active';
        break;
      }

      case 'plan.step_finished': {
        const s = plan?.steps.find(x => x.id === p.step_id);
        if (s) {
          s.state = p.state === 'done' ? 'done' : 'failed';
          s.evidence = p.evidence != null ? String(p.evidence) : null;
          if (s.state === 'failed') s.retry += 1;
        }
        break;
      }
    }
  }
  return plan;
}

/** Steps whose dependencies are all `done` and which are not themselves finished. */
export function readySteps(plan) {
  if (!plan) return [];
  const byId = new Map(plan.steps.map(s => [s.id, s]));
  return plan.steps.filter(s =>
    (s.state === 'pending' || s.state === 'failed')
    && s.depends_on.every(d => byId.get(d)?.state === 'done'));
}

/** Is every step of the current revision done? A plan with no steps is not "complete". */
export function planSatisfied(plan) {
  return !!plan && plan.steps.length > 0 && plan.steps.every(s => s.state === 'done');
}

/** One-line rendering for `explain` and the CLI. */
export function summarisePlan(plan) {
  if (!plan) return null;
  const done = plan.steps.filter(s => s.state === 'done').length;
  return `plan r${plan.revision}: ${done}/${plan.steps.length} steps — ${plan.goal}`;
}
