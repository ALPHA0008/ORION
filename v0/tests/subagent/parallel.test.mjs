// W10-A — TRUE child concurrency: two siblings in one turn actually overlap.
//
// W10 shipped delegation but its §11.4 recorded an honest gap: "two children have never run
// genuinely concurrently". The worker dispatched a turn's tool calls in a sequential `for` loop, so
// what existed was the CAPACITY for parallelism — quotas, separate leases, WAL isolation — never
// simultaneity. That is W10's acceptance criterion #4, and this suite closes it.
//
// THE PROOF IS A BARRIER, NOT A STOPWATCH
//
// A timing assertion ("both finished within N ms") is the tempting shape and it is a flake
// generator: it passes on a fast machine that ran them sequentially and fails on a slow one that
// ran them concurrently. Instead each child's first model call ENTERS A BARRIER and waits for its
// sibling. Under concurrent dispatch both children arrive and the barrier opens. Under sequential
// dispatch the first child waits for a sibling that cannot start until it finishes — a deadlock
// that the barrier's own timeout converts into a loud, deterministic failure.
//
// So this file fails if the feature regresses, rather than merely passing more slowly.
//
// WHAT MUST NEVER BE ASSERTED HERE
//
// Which child finishes first. Two concurrent children interleave their parent-side appends, so
// `child.finished` for A and B may land in either order. Any assertion that depends on the order
// would be a test that fails at random, which is worse than no test at all.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { makeSubagentTool } from '../../src/core/child/tool.mjs';
import { setChildCompletionContract } from '../../src/core/child/executor.mjs';
import { projectLineage } from '../../src/core/projection/lineage.mjs';
import { MAX_LIVE_CHILDREN } from '../../src/core/child/quota.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mk = (t) => fs.mkdtempSync(path.join(os.tmpdir(), `w10p-${t}-`));

const scripted = (responses, name = 'scripted') => {
  let i = 0;
  return { name, provider: 'test', capabilities: new Set(['tools']),
    async invoke() {
      const r = responses[Math.min(i++, responses.length - 1)];
      return { input_tokens: 10, output_tokens: 5, ...(typeof r === 'function' ? r() : r) };
    } };
};
const say = (content) => ({ content, tool_calls: [], finish: true });
const call = (name, args) => ({ content: '', finish: false,
  tool_calls: [{ id: `tc_${Math.random().toString(16).slice(2, 10)}`, name, args }] });
/** One assistant response carrying SEVERAL tool calls — the shape a parallel turn has. */
const calls = (...specs) => ({ content: '', finish: false,
  tool_calls: specs.map(([name, args], n) => ({ id: `tc_${n}_${Math.random().toString(16).slice(2, 8)}`,
                                                name, args })) });

const { defaultCompletionContract } = await import('../../src/cli/index.mjs');
setChildCompletionContract((store, childRunId, childTools) =>
  defaultCompletionContract(store, childRunId, { tools: childTools }));

/** A child that does real work, so the honest-completion contract can judge it completed. */
const workingChild = (answer = 'the child answer') =>
  scripted([call('read', { path: 'note.txt' }), say(answer)]);

/**
 * A rendezvous for N participants.
 *
 * `enter()` counts an arrival; the promise resolves once all N have arrived, and REJECTS on
 * timeout. The rejection is the point: it is what turns "the children were serialised" from a slow
 * test into a failing one with a message that says exactly what went wrong.
 */
function makeBarrier(n, timeoutMs = 2_000) {
  let entered = 0;
  let inside = 0;
  let peak = 0;            // the honest measure: how many were inside AT THE SAME TIME
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const timer = setTimeout(() => reject(new Error(
    `barrier timed out after ${timeoutMs}ms with ${entered}/${n} children — `
    + 'they were dispatched SEQUENTIALLY, not concurrently')), timeoutMs);
  promise.catch(() => {});   // the rejection is observed by the child; do not warn here
  return {
    enter() {
      entered += 1;
      inside += 1;
      if (inside > peak) peak = inside;
      if (inside === n) { clearTimeout(timer); resolve(true); }
    },
    leave() { inside -= 1; },
    get promise() { return promise; },
    // CUMULATIVE arrivals. Deliberately NOT the proof: under sequential dispatch the first child
    // times out and fails, the second then arrives, and this still reaches n. Discovered by
    // disabling the batch and watching this assertion pass anyway — so `peak` is what the test
    // actually asserts on.
    get entered() { return entered; },
    /** Peak SIMULTANEOUS occupancy — 2 only if the two children genuinely overlapped. */
    get peak() { return peak; },
    done() { clearTimeout(timer); },
  };
}

/** A child whose FIRST model call blocks until every sibling has also started. */
function barrierChild(barrier, answer = 'the child answer') {
  let turn = 0;
  return { name: 'barrier-child', provider: 'test', capabilities: new Set(['tools']),
    async invoke() {
      turn += 1;
      if (turn === 1) {
        barrier.enter();
        try { await barrier.promise; }  // rejects if the sibling never arrives
        finally { barrier.leave(); }
        return { input_tokens: 10, output_tokens: 5, ...call('read', { path: 'note.txt' }) };
      }
      return { input_tokens: 10, output_tokens: 5, ...say(answer) };
    } };
}

/** A parent run with a real Worker whose toolset includes a real `subagent`. */
function delegationRig({ parentModel, makeChildModel, quota = {}, maxTurns = 6 } = {}) {
  const ws = mk('ws');
  fs.writeFileSync(path.join(ws, 'note.txt'), 'the thing the children were asked to look at\n');
  const sandbox = new LocalSandbox(ws);
  const store = new Store(path.join(mk('db'), 'runs.db'));
  const runId = store.createRun(uid('run'), { task: 'delegate in parallel' });
  const claim = store.claim('w-parent', { runId, leaseMs: 120_000 });
  const parentTools = makeTools(sandbox);

  const subagent = makeSubagentTool({
    store, parentRunId: runId, parentLeaseToken: claim.leaseToken,
    tools: parentTools,
    authOptions: { denyTools: [], escalateTools: [], denyCommandPatterns: [], protectedPaths: [] },
    posture: 'auto', sandbox, createAuthorizer,
    makeModel: makeChildModel, modelName: 'child-model', provider: 'test',
    quota,
  });

  const worker = new Worker(store, {
    sandbox, model: parentModel,
    tools: { ...parentTools, subagent },
    // `permissive` because `subagent` is Mutating + UNSAFE, so at `auto` it escalates and the run
    // parks waiting for a human — correct policy, and exactly what an isolated (container) backend
    // earns in the product. These tests are about DISPATCH, not about the approval gate, which has
    // its own suites.
    authorize: createAuthorizer({ posture: 'permissive' }),
    leaseMs: 120_000, maxTurns,
  });
  return { ws, sandbox, store, runId, leaseToken: claim.leaseToken, worker };
}

const evs = (store, runId, type) => store.events(runId).filter(e => e.type === type);
const contiguous = (store, runId) =>
  store.events(runId).every((e, i) => Number(e.seq) === i + 1);

// ═══════════════════════════════════════════ 1. the concurrency proof
describe('w10/parallel: two siblings in one turn run CONCURRENTLY (barrier proof)');
{
  const barrier = makeBarrier(2);
  const rig = delegationRig({
    parentModel: scripted([
      calls(['subagent', { task: 'investigate A' }], ['subagent', { task: 'investigate B' }]),
      say('both done'),
    ]),
    makeChildModel: () => barrierChild(barrier),
  });

  const res = await rig.worker.run(rig.runId, rig.leaseToken, { input: 'delegate two' });
  barrier.done();

  // THE proof: PEAK SIMULTANEOUS occupancy. Both children were inside their first model call at
  // the same instant, which under sequential dispatch is impossible — the second cannot start
  // until the first has reached its terminal event.
  //
  // Cumulative arrivals would NOT prove this, and the distinction was found by disabling the batch
  // and watching the naive version pass anyway: sequentially the first child enters, times out and
  // fails, and the second then enters, so a total of 2 is reached without any overlap.
  eq('two children were inside the barrier SIMULTANEOUSLY', barrier.peak, 2);

  eq('the parent completed', res.status, 'completed', res.reason ?? '');
  const spawned = evs(rig.store, rig.runId, 'child.spawned');
  const finished = evs(rig.store, rig.runId, 'child.finished');
  eq('two children were spawned', spawned.length, 2);
  eq('...and both finished', finished.length, 2);
  check('...both completed', finished.every(e => e.payload.status === 'completed'),
    finished.map(e => e.payload.status).join(','));

  const lin = projectLineage(rig.store.events(rig.runId));
  eq('the fold agrees: two spawned', lin.spawned, 2);
  eq('...two finished', lin.finished, 2);
  eq('...none left running', lin.running.length, 0);
  eq('...and none failed', lin.failed, 0);

  // Each child is a real, independent trajectory.
  for (const s of spawned) {
    const childId = s.payload.child_run;
    check(`${childId} has its own contiguous log`, contiguous(rig.store, childId));
    check(`...ending terminal`,
      ['run.completed', 'run.failed'].includes(
        rig.store.events(childId).at(-1)?.type ?? ''),
      rig.store.events(childId).at(-1)?.type);
  }

  // The parent's window never swells with the children's turns — the whole point of delegating.
  // The parent has its OWN model calls, of course; what must not appear is the children's work.
  const childIds = spawned.map(s => s.payload.child_run);
  const parentBody = JSON.stringify(rig.store.events(rig.runId)
    .filter(e => e.type !== 'child.spawned' && e.type !== 'child.finished'
                 && e.type !== 'tool.succeeded'));
  for (const id of childIds)
    check(`the parent log does not carry ${id}'s trajectory`, !parentBody.includes(id));
  eq('the parent made exactly its own two model round-trips',
    evs(rig.store, rig.runId, 'model.responded').length, 2);
  check('...while each child made its own, in its own log',
    childIds.every(id => rig.store.events(id)
      .filter(e => e.type === 'model.responded').length === 2));

  // Concurrency must not corrupt the log: interleaved appends still allocate contiguous seqs,
  // because every append commits in its own immediate transaction.
  check('the parent log is contiguous despite interleaved appends',
    contiguous(rig.store, rig.runId),
    rig.store.events(rig.runId).map(e => e.seq).join(','));

  // Deliberately NOT asserted: which of the two finished first. That is genuinely
  // nondeterministic, and an assertion on it would flake.
  globalThis.__w10_parallel_rig = rig;   // reused by the store-integrity block below
}

// ═══════════════════════════════════════════ 2. the race against the ceiling
describe('w10/parallel: a three-way race can never exceed the live ceiling');
{
  // The reason the spawn gate had to become atomic. Three racers each folding the lineage OUTSIDE
  // a transaction would all read "0 running" before any `child.spawned` committed, and all three
  // would spawn — quietly past MAX_LIVE_CHILDREN, the one bound between delegation and a
  // thundering herd against a single-file store.
  const rig = delegationRig({
    parentModel: scripted([
      calls(['subagent', { task: 'A' }], ['subagent', { task: 'B' }], ['subagent', { task: 'C' }]),
      say('done'),
    ]),
    makeChildModel: () => workingChild(),
  });

  const res = await rig.worker.run(rig.runId, rig.leaseToken, { input: 'delegate three' });

  eq('the parent completed', res.status, 'completed', res.reason ?? '');
  eq('exactly the ceiling was spawned', evs(rig.store, rig.runId, 'child.spawned').length,
    MAX_LIVE_CHILDREN);
  eq('...and each of those finished', evs(rig.store, rig.runId, 'child.finished').length,
    MAX_LIVE_CHILDREN);

  const failedCalls = evs(rig.store, rig.runId, 'tool.failed');
  eq('exactly one delegation was refused', failedCalls.length, 1);
  check('...told the model it cannot delegate',
    /cannot delegate/.test(failedCalls[0].payload.error), failedCalls[0].payload.error);
  check('...naming the live-children wall',
    /already running/.test(failedCalls[0].payload.error), failedCalls[0].payload.error);

  // A refused spawn writes NOTHING — no half-born run row, no orphan event.
  const spawnedIds = new Set(evs(rig.store, rig.runId, 'child.spawned')
    .map(e => e.payload.child_run));
  const childRows = rig.store.events(rig.runId)
    .filter(e => e.type === 'child.spawned').length;
  eq('no run row exists for a refused child', childRows, spawnedIds.size);

  eq('the fold agrees', projectLineage(rig.store.events(rig.runId)).spawned, MAX_LIVE_CHILDREN);
  check('the parent log stayed contiguous', contiguous(rig.store, rig.runId));
  // Deliberately NOT asserted: WHICH two won the race.
  rig.store.close();
}

// ═══════════════════════════════════════════ 3. cancel before the batch
describe('w10/parallel: a cancel before the batch parks with no child spawned');
{
  const ac = new AbortController();
  const rig = delegationRig({
    // The signal aborts as the response is produced, so the `before tool call` checkpoint — which
    // still runs ahead of a batch, exactly as it did ahead of a single call — fires first.
    parentModel: scripted([
      () => { ac.abort(); return calls(['subagent', { task: 'A' }], ['subagent', { task: 'B' }]); },
      say('never reached'),
    ]),
    makeChildModel: () => workingChild(),
  });

  const res = await rig.worker.run(rig.runId, rig.leaseToken,
    { input: 'delegate then cancel', signal: ac.signal });

  eq('the run parked rather than failing', res.status, 'parked', res.reason ?? '');
  eq('...as cancelled', res.reason, 'cancelled');
  eq('NO child was spawned', evs(rig.store, rig.runId, 'child.spawned').length, 0);
  eq('...and no tool started', evs(rig.store, rig.runId, 'tool.started').length, 0);

  // The escalation-suite invariant, restated for the batch path: nothing after the park.
  const types = rig.store.events(rig.runId).map(e => e.type);
  const parkedAt = types.indexOf('run.parked');
  check('run.parked was recorded', parkedAt >= 0, types.join(','));
  eq('...and it is the last event', parkedAt, types.length - 1);
  rig.store.close();
}

// ═══════════════════════════════════════════ 4. the batch detector is exact
describe('w10/parallel: a lone delegate followed by an ordinary tool stays SEQUENTIAL');
{
  // The batch must absorb only CONSECUTIVE delegates. If it swallowed a trailing ordinary tool,
  // every X5 and escalation guarantee that depends on sequential dispatch would be voided for any
  // turn that happened to begin with a subagent.
  const rig = delegationRig({
    parentModel: scripted([
      calls(['subagent', { task: 'A' }], ['read', { path: 'note.txt' }]),
      say('done'),
    ]),
    makeChildModel: () => workingChild(),
  });

  const res = await rig.worker.run(rig.runId, rig.leaseToken, { input: 'one then a read' });
  eq('the parent completed', res.status, 'completed', res.reason ?? '');
  eq('one child was spawned', evs(rig.store, rig.runId, 'child.spawned').length, 1);
  eq('...and finished', evs(rig.store, rig.runId, 'child.finished').length, 1);

  const finishedSeq = Number(evs(rig.store, rig.runId, 'child.finished')[0].seq);
  const readSeq = Number(rig.store.events(rig.runId)
    .find(e => e.type === 'tool.succeeded' && e.payload.name === 'read')?.seq ?? -1);
  check('the read really ran', readSeq > 0, String(readSeq));
  check('...strictly AFTER the child finished — the delegate was not batched with it',
    finishedSeq < readSeq, `child.finished@${finishedSeq} read@${readSeq}`);

  const turnSeq = Number(evs(rig.store, rig.runId, 'turn.finished')[0]?.seq ?? -1);
  check('the turn closed after both', turnSeq > readSeq, `turn.finished@${turnSeq}`);
  rig.store.close();
}

// ═══════════════════════════════════════════ 5. store integrity
describe('w10/parallel: concurrent children do not corrupt the store');
{
  // W10 acceptance #4: "two parallel children do not corrupt or block-write the store".
  const rig = globalThis.__w10_parallel_rig;
  const events = rig.store.events(rig.runId);

  const seqs = events.map(e => Number(e.seq));
  eq('every parent seq is exactly index+1 — no gaps', seqs.filter((s, i) => s !== i + 1).length, 0);
  eq('...and no duplicates', new Set(seqs).size, seqs.length);

  for (const s of events.filter(e => e.type === 'child.spawned')) {
    const id = s.payload.child_run;
    const cs = rig.store.events(id).map(e => Number(e.seq));
    eq(`child ${id} has contiguous seqs`, cs.filter((n, i) => n !== i + 1).length, 0);
  }

  // Nothing was lost to the interleaving: a re-read returns the identical log.
  eq('re-reading the parent log returns the same events',
    rig.store.events(rig.runId).length, events.length);
  eq('...with the same final seq',
    Number(rig.store.events(rig.runId).at(-1).seq), seqs.at(-1));
  rig.store.close();
}

process.exit(summary('w10 parallel', path.join(HERE, '..', 'results-w10-parallel.json')) ? 1 : 0);
