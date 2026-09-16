// W10 — spawning and running a child trajectory.
//
// A CHILD IS A REAL RUN. That sentence is the whole design.
//
// It gets its own row in `runs` (with `parent_run_id` set — a column the store has had since
// Wave 1 and nothing until now populated), its own lease, its own event stream, its own plan, its
// own budget and its own completion verdict. Nothing about a child is a special case inside the
// parent's loop: the child is driven by the SAME `Worker` class, through the SAME store, under the
// SAME authorizer, and its work is recovered by the SAME crash machinery. If this file vanished,
// `explain` would still narrate every child from its own log.
//
// WHY IN-PROCESS AND NOT A SUBPROCESS
//
// The tempting shape is `spawn('orionctl', ['run', task])`. It is wrong here for a reason the plan
// names directly: event-store write contention is part of the design. One process holding one
// SQLite connection in WAL mode serialises its own writes through one lock it already owns.
// Two OS processes contend for that lock across a file boundary, with a 5s busy timeout as the
// only arbiter — and every child added is another contender. In-process children also share the
// parent's already-acquired container, so a child costs no second `docker run`.
//
// The lease is what keeps this honest. Parent and child hold SEPARATE leases on SEPARATE runs, so
// the fencing invariant (4) is untouched: neither can write to the other's trajectory, and a
// child that loses its lease stops exactly as a parent would.
//
// WHAT THE PARENT SEES
//
// The child's TURNS never enter the parent's message window — only its final result, plus the
// child's run id. That is the point of delegation: the parent spends a few hundred bytes on an
// answer that may have cost the child fifty thousand tokens to produce, and a reviewer can still
// open the child's trajectory and read every step.

import { uid } from '../run/store.mjs';
import { Worker, ExitReason, DEFAULT_SYSTEM } from '../../agent/loop/worker.mjs';
import { projectLineage, ChildStatus } from '../projection/lineage.mjs';
import { project } from '../projection/index.mjs';
import { resolveChildTools, childAuthOptions, narrowestPosture, mutatingGrants } from './scope.mjs';
// W10-A: `canSpawn`/`QuotaError` moved to `store.reserveChildSpawn`, which evaluates the verdict
// inside the spawn transaction so concurrent siblings cannot race past the live ceiling.
import { resolveQuota } from './quota.mjs';

/** The instructions a child runs under. Deliberately narrower than the parent's. */
export const CHILD_SYSTEM = [
  DEFAULT_SYSTEM,
  '',
  'You are a SUBAGENT working on one bounded task delegated by a parent agent.',
  '',
  '- Do the delegated task and nothing else. You cannot see the parent\'s conversation, and the',
  '  parent cannot see your steps — only the final answer you leave in your last message.',
  '- Your last message IS your result. Make it self-contained: state what you found or did, with',
  '  the specifics (paths, names, numbers) the parent needs. Do not say "done" and stop.',
  '- You cannot ask a human anything. If the task is ambiguous, state the ambiguity and the',
  '  assumption you made in your final answer, then finish.',
  '- Your toolset is deliberately narrower than the parent\'s. If you lack a tool you need, say so',
  '  in your answer rather than working around it.',
].join('\n');

/**
 * Build the child's run id.
 *
 * Fresh rather than derived: unlike a W6 resource — which must be RE-found after a crash and so
 * needs a recomputable identity — a child run is CREATED once and thereafter referenced by the id
 * recorded in `child.spawned`. Deriving it would invite two different spawns to collide on one id
 * and interleave their events into a single, uninterpretable trajectory.
 */
export const childRunId = () => uid('run');

/**
 * Spawn a child trajectory and run it to a terminal state.
 *
 * Returns the child's result rather than throwing for ordinary failures: a child that fails is an
 * ANSWER the parent folds into its own reasoning ("the sub-task failed, here is why"), not an
 * exception that ends the parent. Only a quota refusal throws, because that is the parent asking
 * for something it may not have.
 *
 * @returns {Promise<{child_run: string, status: string, result: string, detail: string|null,
 *                    tokens: number, tool_calls: number, granted: string[],
 *                    refused: {name: string, why: string}[], posture: string}>}
 */
export async function spawnChild({
  store, parentRunId, parentLeaseToken, task, reason = null,
  tools, authOptions, posture: parentPosture, sandbox,
  makeModel, modelName = null, provider = null,
  createAuthorizer, quota: quotaCfg = {}, depth = 1,
  allowTools = null, requestedPosture = null,
  parentBudget = null, signal = null, log = null,
  isolated = null, project: projectKeyValue = null,
}) {
  const quota = resolveQuota(quotaCfg);
  const parentState = project(store, parentRunId);

  // ── policy: strictest of parent and request, tools the parent actually holds ────────
  const childPosture = narrowestPosture(parentPosture, requestedPosture);
  const { tools: childTools, granted, refused } = resolveChildTools(tools, allowTools,
    { denyTools: authOptions?.denyTools ?? [] });
  const childAuth = childAuthOptions(
    { ...authOptions, availableTools: Object.keys(tools ?? {}) },
    { granted, posture: childPosture });

  const childId = childRunId();
  const childBudget = quota.budget;
  const childModel = makeModel ? makeModel(modelName) : null;

  // ── the gate AND the child's durable birth, in ONE transaction (W10-A) ─────────────
  //
  // The quota verdict used to be computed here, outside any transaction, and the child was then
  // created by two separate writes. That was correct only while spawns were serial. Now that a
  // turn can dispatch sibling delegates concurrently, three racers could each fold "0 running"
  // before any `child.spawned` committed and all three would spawn past the live ceiling.
  //
  // `reserveChildSpawn` evaluates the verdict and writes the `runs` row, the child's `run.created`
  // and the parent's `child.spawned` under one write lock, so racers serialise and the second sees
  // the first. A refusal writes nothing at all.
  //
  // `parent_run_id` is still populated (the column the store has carried since Wave 1), so `runs`
  // itself knows the lineage — while the EVENTS remain the authority the projection folds.
  store.reserveChildSpawn(parentRunId, parentLeaseToken, {
    runId: childId,
    task: String(task),
    quota,
    depth,
    parentBudget,
    parentTokens: parentState?.budget?.tokens ?? 0,
    // Everything a reviewer needs to judge the delegation, in one payload.
    spawnedPayload: {
      parent_run: parentRunId,
      child_run: childId,
      task: String(task),
      reason: reason ? String(reason) : null,
      // The grant, in the log: "this child was allowed exactly these tools, of which these can
      // change the world". A reviewer never has to trust that the code did the right thing.
      scopes: {
        tools: granted,
        mutating: mutatingGrants(childTools),
        refused: refused.map(r => r.name),
        deny_tools: childAuth.denyTools.length,
      },
      // Model provenance (§10.2 W10): a child may run a different model than its parent, and which
      // one served it must be answerable from the log alone.
      model: modelName ?? childModel?.name ?? null,
      provider: provider ?? childModel?.provider ?? null,
      posture: childPosture,
      isolated: isolated ?? sandbox?.capabilities?.isolated ?? false,
      depth,
      budget: childBudget,
    },
  });

  log?.(`  subagent: spawned ${childId} (${granted.length} tools, posture ${childPosture})`);
  for (const r of refused) log?.(`  subagent: refused \`${r.name}\` — ${r.why}`);

  // ── run it ─────────────────────────────────────────────────────────────────────────
  // Annotated because the initial value would otherwise narrow the variable to the literal
  // `'failed'`, and every later assignment (completed, cancelled) would read as a type error
  // rather than as the state machine this actually is. Defaulting to FAILED is deliberate: a
  // child that throws before reaching any verdict must not fall through to "completed".
  /** @type {string} */
  let status = ChildStatus.FAILED;
  /** @type {string} */
  let result = '';
  /** @type {string|null} */
  let detail = null;
  /** @type {any} */
  let claimed = null;

  // The child's own wall clock. A child that never terminates would hold a quota slot and a lease
  // forever while the parent blocks on it — so the timeout is the parent's protection, not the
  // child's, and it composes with any signal the caller already passed.
  const ac = new AbortController();
  const onParentAbort = () => ac.abort();
  signal?.addEventListener?.('abort', onParentAbort);
  const timer = setTimeout(() => ac.abort(), quota.timeoutMs);

  try {
    claimed = store.claim(`child:${childId}`, { runId: childId });
    if (!claimed) {
      detail = 'the child run could not be leased';
    } else {
      const worker = new Worker(store, {
        sandbox,
        model: childModel,
        tools: childTools,
        authorize: createAuthorizer(childAuth),
        systemPrompt: CHILD_SYSTEM,
        budget: childBudget,
        maxTurns: quota.maxTurns,
        // The honest-completion rule (ADR-013) applies INSIDE a child exactly as at top level.
        // A child that stops without doing the thing must not report success to its parent —
        // that would launder a failure through a layer of delegation.
        completionContract: makeCompletionContract
          ? makeCompletionContract(store, childId, childTools)
          : null,
        authContext: { project: projectKeyValue, resource_id: null },
      });

      const res = await worker.run(childId, claimed.leaseToken, { input: String(task), signal: ac.signal });
      result = lastAssistantText(store, childId) || String(res.reason ?? '');
      detail = res.reason ?? null;

      status = res.status === 'completed' ? ChildStatus.COMPLETED
        : ac.signal.aborted ? ChildStatus.CANCELLED
        : ChildStatus.FAILED;

      if (res.status === 'parked' && res.reason === ExitReason.CANCELLED)
        status = ChildStatus.CANCELLED;
    }
  } catch (e) {
    status = ac.signal.aborted ? ChildStatus.CANCELLED : ChildStatus.FAILED;
    detail = String(e?.message ?? e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onParentAbort);
  }

  const childState = project(store, childId);
  const tokens = childState?.budget?.tokens ?? 0;
  const toolCalls = childState?.budget?.tool_calls ?? 0;

  // ── child.finished — the other reserved member, and the parent's only durable record of
  //    the outcome. Written under the PARENT's lease, because it is a fact about the parent's
  //    trajectory ("I delegated and this is what came back"), not about the child's.
  store.append(parentRunId, 'child.finished', {
    parent_run: parentRunId,
    child_run: childId,
    status,
    // A REFERENCE, not a copy. The child's full output lives in the child's own log; duplicating
    // it here would double the bytes and create two sources of truth for one answer.
    result_ref: { run: childId, kind: 'final_message' },
    detail: detail ? String(detail).slice(0, 500) : null,
    tokens,
    tool_calls: toolCalls,
    model: modelName ?? childModel?.name ?? null,
    depth,
  }, { leaseToken: parentLeaseToken });

  log?.(`  subagent: ${childId} ${status}${tokens ? ` (${tokens}tok)` : ''}`);

  return { child_run: childId, status, result, detail, tokens, tool_calls: toolCalls,
           granted, refused, posture: childPosture };
}

/**
 * Injected by the composition root so this module does not import the CLI (which would be a cycle:
 * the CLI imports the tool that imports this).
 */
let makeCompletionContract = null;
export function setChildCompletionContract(fn) { makeCompletionContract = fn; }

/**
 * The child's answer: the text of its last assistant message.
 *
 * Read from the LOG rather than returned from the worker, so a child recovered in a later process
 * — or inspected long after it finished — yields the identical answer. `model.responded` is the
 * durable record of what the model actually said.
 */
export function lastAssistantText(store, runId) {
  let text = '';
  for (const e of store.events(runId)) {
    if (e.type !== 'model.responded') continue;
    const c = e.payload?.content;
    if (typeof c === 'string' && c.trim()) text = c.trim();
  }
  return text;
}

/**
 * Account for children a resumed parent believed were running.
 *
 * An in-process child cannot outlive the process that ran it, so on resume a `running` child is
 * gone. Recording it `lost` is not bookkeeping pedantry: a parent that silently forgets the child
 * it was waiting on has lost work without saying so, and `explain` would show a spawn with no
 * outcome forever. This is the same honesty W9 applied to an MCP pipe that could not survive its
 * owner.
 *
 * @returns {number} how many children were reconciled
 */
export function reconcileChildren(store, parentRunId, leaseToken, { log = null } = {}) {
  const { running } = projectLineage(store.events(parentRunId));
  for (const c of running) {
    const childRun = store.run(c.child_run);
    const childState = childRun ? project(store, c.child_run) : null;
    store.append(parentRunId, 'child.finished', {
      parent_run: parentRunId,
      child_run: c.child_run,
      status: ChildStatus.LOST,
      result_ref: { run: c.child_run, kind: 'final_message' },
      detail: 'the process running this child did not survive; the child was not resumed',
      tokens: childState?.budget?.tokens ?? 0,
      tool_calls: childState?.budget?.tool_calls ?? 0,
      model: c.model ?? null,
      depth: c.depth ?? 1,
    }, { leaseToken });
    log?.(`  subagent: ${c.child_run} recorded lost (its process did not survive)`);
  }
  return running.length;
}
