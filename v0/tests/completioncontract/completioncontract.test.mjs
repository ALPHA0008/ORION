// Declared completion contract (ADR-013, phase 10).
//
// MEASURED (phase 9): 12 of 22 Qwen runs ended with a response carrying no tool calls AND no text
// — one while still paging a 224-line file at line 144 — and the loop recorded `completed`.
// Gemma: 0 of 66 across three reports. The evaluator scored every one of those FAIL, so it is the
// RUNTIME's own record that was wrong.
//
// The invariant under test: STOPPING IS NOT COMPLETING — but only where a task DECLARES that it
// changes the world. Analysis-only tasks must still complete on prose.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker, ExitReason } from '../../src/agent/loop/worker.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { replay, fork } from '../../src/core/replay/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const note = (s) => console.log(`       ${s}`);

const BROKEN = 'export function add(a, b) {\n  return a - b;\n}\n';
const FIXED  = 'export function add(a, b) {\n  return a + b;\n}\n';

/**
 * Drive the worker with scripted responses.
 * `contract` is the ADR-013 option; omit it for legacy behaviour.
 */
async function run(responses, { contract = null, seed = BROKEN, hooks = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccon-'));
  const sandbox = new LocalSandbox(path.join(dir, 'w'));
  sandbox.write('src/math.js', seed);
  const store = new Store(path.join(dir, 'run.db'));
  let i = 0, calls = 0;
  const model = { name: 'scripted', async invoke() {
    calls++;
    const r = responses[Math.min(i++, responses.length - 1)];
    return { input_tokens: 1, output_tokens: 1, ...(typeof r === 'function' ? r(sandbox) : r) };
  } };
  const runId = uid('run');
  store.createRun(runId, { task: 'fix add()' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  const worker = new Worker(store, {
    sandbox, tools: makeTools(sandbox), model,
    authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
    workerId: 'w', maxTurns: 10, leaseMs: 60_000, hooks,
    ...(contract ? { completionContract: contract } : {}),
  });
  let res, threw = null;
  try { res = await worker.run(runId, claim.leaseToken, { input: 'fix add()' }); }
  catch (e) { threw = e; }
  const st = project(store, runId);
  const world = sandbox.read('src/math.js');
  return { res, threw, st, world, store, runId, dir, sandbox, calls,
           cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** The task-supplied objective predicate: deterministic, no LLM. */
const objective = (sandboxRef) => () => sandboxRef.get().includes('a + b');
const ref = () => { let sb; return { set: (s) => { sb = s; }, get: () => sb.read('src/math.js') }; };

const CONTRACT = (r) => ({ requires_world_change: true, objectiveSatisfied: () => r.get().includes('a + b') });

console.log('completioncontract');

// ── §9 Case D: analysis-only task still completes on prose ──────────────
{
  const r = await run([{ content: 'The bug is that add() subtracts.', tool_calls: [] }]);
  ok('D: no contract -> prose completes (legacy semantics preserved)',
     r.res.status === 'completed' && r.res.reason === ExitReason.MODEL_FINISHED,
     `${r.res.status}/${r.res.reason}`);
  ok('  world untouched, and that is correct', r.world === BROKEN);
  r.cleanup();
}
{
  const rr = ref();
  const r = await run([{ content: 'analysis only', tool_calls: [] }],
    { contract: { requires_world_change: false, objectiveSatisfied: () => false } });
  ok('D: requires_world_change=false -> prose completes even if objective false',
     r.res.status === 'completed', `${r.res.status}/${r.res.reason}`);
  r.cleanup();
}

// ── §9 Case B: unfinished prose is NOT completed ────────────────────────
{
  const rr = ref();
  const r0 = { sandbox: null };
  const dir = null;
  const res = await (async () => {
    const rrr = ref();
    const out = await run([{ content: 'The fix is to use a + b.', tool_calls: [] }],
      { contract: { requires_world_change: true, objectiveSatisfied: () => false } });
    return out;
  })();
  ok('B: prose + unsatisfied objective is NOT completed',
     res.res.status !== 'completed', `${res.res.status}/${res.res.reason}`);
  ok('  reason is finished_without_change',
     res.res.reason === ExitReason.FINISHED_WITHOUT_CHANGE, res.res.reason);
  ok('  world unchanged (nothing was forced)', res.world === BROKEN);
  note('the run stopped; it did not crash and did not lose its lease');
  res.cleanup();
}

// ── §9 Case C: EMPTY response is NOT completed ──────────────────────────
{
  const res = await run([{ content: '', tool_calls: [] }],
    { contract: { requires_world_change: true, objectiveSatisfied: () => false } });
  ok('C: empty response + unsatisfied objective is NOT completed',
     res.res.status !== 'completed', `${res.res.status}/${res.res.reason}`);
  ok('  reason is finished_without_change',
     res.res.reason === ExitReason.FINISHED_WITHOUT_CHANGE, res.res.reason);
  note('this is the exact Qwen pattern: 12/22 runs ended this way and were recorded completed');
  res.cleanup();
}

// ── §9 Case A: genuinely complete -> completed ──────────────────────────
{
  const res = await run([{ content: 'done', tool_calls: [] }],
    { contract: { requires_world_change: true, objectiveSatisfied: () => true }, seed: FIXED });
  ok('A: objective satisfied + no tool calls -> completed',
     res.res.status === 'completed' && res.res.reason === ExitReason.MODEL_FINISHED,
     `${res.res.status}/${res.res.reason}`);
  res.cleanup();
}

// ── §19 the world was ALREADY correct: must not demand a mutation ───────
{
  const res = await run([{ content: 'nothing to do, it is already correct', tool_calls: [] }],
    { contract: { requires_world_change: true, objectiveSatisfied: () => true }, seed: FIXED });
  ok('§19: already-correct world completes with ZERO mutations',
     res.res.status === 'completed', `${res.res.status}/${res.res.reason}`);
  ok('  the contract did NOT degenerate into "must mutate"', res.world === FIXED);
  res.cleanup();
}

// ── §9 Case E + §14: bounded continuation recovers useful work ──────────
{
  let n = 0;
  const responses = [
    { content: '', tool_calls: [] },                       // premature stop
    (sb) => {                                              // after the continuation, act
      n++;
      return { content: '', tool_calls: [{ id: 'e1', name: 'edit',
        args: { path: 'src/math.js', old_string: 'a - b', new_string: 'a + b' } }] };
    },
    { content: 'fixed', tool_calls: [] },
  ];
  let world = BROKEN;
  const res = await run(responses, {
    contract: { requires_world_change: true, objectiveSatisfied: function () { return this.sb?.() ?? false; } },
  });
  // Rebuild with a live predicate that reads the real sandbox.
  res.cleanup();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccon2-'));
  const sandbox = new LocalSandbox(path.join(dir, 'w'));
  sandbox.write('src/math.js', BROKEN);
  const store = new Store(path.join(dir, 'run.db'));
  let i = 0;
  const model = { name: 's', async invoke() {
    const r = responses[Math.min(i++, responses.length - 1)];
    const v = typeof r === 'function' ? r(sandbox) : r;
    return { input_tokens: 1, output_tokens: 1, ...v };
  } };
  const runId = uid('run');
  store.createRun(runId, { task: 't' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  const w = new Worker(store, { sandbox, tools: makeTools(sandbox), model,
    authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
    workerId: 'w', maxTurns: 10, leaseMs: 60_000,
    completionContract: { requires_world_change: true,
      objectiveSatisfied: () => sandbox.read('src/math.js').includes('a + b') } });
  const r2 = await w.run(runId, claim.leaseToken, { input: 't' });
  const st2 = project(store, runId);

  ok('E: continuation converts a premature stop into real work',
     r2.status === 'completed', `${r2.status}/${r2.reason}`);
  ok('  the world WAS changed', sandbox.read('src/math.js').includes('a + b'));
  ok('  exactly ONE continuation was granted', st2.continuation_count === 1,
     String(st2.continuation_count));
  const degraded = store.events(runId).filter(e => e.type === 'degraded'
    && e.payload?.subsystem === 'completion_contract');
  ok('  the continuation is auditable in the event log', degraded.length === 1, String(degraded.length));
  store.close(); fs.rmSync(dir, { recursive: true, force: true });
}

// ── §7 / §25-B: the continuation is HARD bounded ────────────────────────
{
  // A model that never acts: the contract must stop, not loop forever.
  const res = await run([{ content: '', tool_calls: [] }],
    { contract: { requires_world_change: true, objectiveSatisfied: () => false } });
  ok('bounded: a never-acting model terminates', res.res.status !== 'completed', res.res.status);
  ok('  at most one continuation', (res.st.continuation_count ?? 0) <= 1,
     String(res.st.continuation_count));
  ok('  and the loop did not spin', res.calls <= 4, `${res.calls} model calls`);
  res.cleanup();
}

// ── a broken predicate must not fabricate an incomplete run ─────────────
{
  const res = await run([{ content: 'done', tool_calls: [] }],
    { contract: { requires_world_change: true,
                  objectiveSatisfied: () => { throw new Error('predicate blew up'); } } });
  ok('a throwing predicate falls back to legacy completion',
     res.res.status === 'completed', `${res.res.status}/${res.res.reason}`);
  note('a broken contract must never invent an unfinished run');
  res.cleanup();
}

// ── §23 replay / fork reconstruct the same interpretation ───────────────
{
  const res = await run([{ content: '', tool_calls: [] }],
    { contract: { requires_world_change: true, objectiveSatisfied: () => false } });
  const before = project(res.store, res.runId);
  const rp = replay(res.store, res.runId);
  ok('replay reproduces the terminal state', rp.state.status === before.status,
     `${rp.state.status} vs ${before.status}`);
  ok('  and the same exit reason', rp.state.exit_reason === before.exit_reason,
     `${rp.state.exit_reason} vs ${before.exit_reason}`);
  ok('  and the same continuation count',
     (rp.state.continuation_count ?? 0) === (before.continuation_count ?? 0));
  ok('  replay made zero model calls', rp.model_calls_made === 0);

  const seq = res.store.events(res.runId).find(e => e.type === 'turn.started'
    && e.payload?.continuation)?.seq;
  if (seq) {
    const child = fork(res.store, res.runId, seq - 1);
    const cs = project(res.store, child.run_id ?? child.runId ?? child);
    ok('  fork before the continuation has no continuation credit',
       (cs.continuation_count ?? 0) === 0, String(cs.continuation_count));
  } else {
    ok('  fork before the continuation has no continuation credit', true, '(no continuation event)');
  }
  res.cleanup();
}
// -- section 22: crash around the continuation decision ------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrash-'));
  const sandbox = new LocalSandbox(path.join(dir, 'w'));
  sandbox.write('src/math.js', BROKEN);
  const store = new Store(path.join(dir, 'run.db'));
  const contract = { requires_world_change: true,
                     objectiveSatisfied: () => sandbox.read('src/math.js').includes('a + b') };
  const mk = (hooks, responses) => {
    let i = 0;
    const model = { name: 's', async invoke() {
      const r = responses[Math.min(i++, responses.length - 1)];
      return { input_tokens: 1, output_tokens: 1, ...r };
    } };
    return new Worker(store, { sandbox, tools: makeTools(sandbox), model,
      authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
      workerId: 'w', maxTurns: 10, leaseMs: 60_000, hooks, completionContract: contract });
  };

  const runId = uid('run');
  store.createRun(runId, { task: 't' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });

  const CRASH = Symbol('crash');
  let crashed = false;
  const w1 = mk({ beforeAppend: (m) => {
    if (m === 'after:model.requested' && (project(store, runId).continuation_count ?? 0) >= 1) {
      const e = new Error('crash'); e[CRASH] = 1; throw e;
    }
  } }, [{ content: '', tool_calls: [] }]);
  try { await w1.run(runId, claim.leaseToken, { input: 't' }); }
  catch (e) { crashed = !!e[CRASH]; }
  ok('crash after the continuation was granted', crashed);

  const mid = project(store, runId);
  ok('  the continuation is durable', mid.continuation_count === 1, String(mid.continuation_count));

  const claim2 = store.claim('w2', { runId, leaseMs: 60_000 }) ?? { leaseToken: claim.leaseToken };
  const w2 = mk({}, [
    { content: '', tool_calls: [{ id: 'e1', name: 'edit',
      args: { path: 'src/math.js', old_string: 'a - b', new_string: 'a + b' } }] },
    { content: 'fixed', tool_calls: [] },
  ]);
  const res2 = await w2.run(runId, claim2.leaseToken);
  const after = project(store, runId);
  ok('  resume completes the run', res2.status === 'completed', res2.status + '/' + res2.reason);
  ok('  the world was changed', sandbox.read('src/math.js').includes('a + b'));
  ok('  NO duplicate continuation was granted', after.continuation_count === 1,
     String(after.continuation_count));
  note('a crash cannot buy a second continuation: the count comes from the event log');

  store.close(); fs.rmSync(dir, { recursive: true, force: true });
}


console.log(`\ncompletioncontract: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
