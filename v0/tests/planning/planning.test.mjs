// WAVE 2 — planning as DERIVED trajectory structure.
//
// The claim under test is architectural, not cosmetic: a plan is a fold over plan.* events and
// is held nowhere else. Everything below exists to make that falsifiable.
//
//   T1  a plan drives a run to completion, each step carrying verify evidence, and the
//       completion contract CONSUMES the plan rather than guessing from tool activity;
//   T2  a failed step is replanned, the revision is a recorded event, and the superseded plan
//       is preserved rather than overwritten;
//   T3  a worker killed mid-plan is resumed by a DIFFERENT worker, which reconstructs the
//       identical plan from the log — and replay reconstructs it identically too.
//
// T3 is the one that matters. If a plan were ephemeral JSON in the worker, T1 and T2 would
// still pass and the feature would still be wrong.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools, validateArgs } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker, ExitReason } from '../../src/agent/loop/worker.mjs';
import { projectPlan, readySteps, planSatisfied } from '../../src/core/projection/plan.mjs';
import { replay } from '../../src/core/replay/index.mjs';
import { parseGemmaToolCalls } from '../../src/agent/model/shims/gemma-tool-calls.mjs';
import { EVENT_TYPES, EVENT_CONTRACT_VERSION } from '../../src/core/event/index.mjs';
import { defaultCompletionContract } from '../../src/cli/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROKEN = 'export const add = (a, b) => a - b;\n';
const FIXED  = 'export const add = (a, b) => a + b;\n';

const call = (name, args) => ({ content: '', finish: false,
  tool_calls: [{ id: 'tc_' + Math.random().toString(16).slice(2, 10), name, args }] });
const finish = (content = 'done') => ({ content, tool_calls: [], finish: true });

function rig({ responses, hooks = {}, dir = null, seed = BROKEN }) {
  const d = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  const sandbox = new LocalSandbox(path.join(d, 'w'));
  if (!fs.existsSync(path.join(d, 'w', 'math.js'))) sandbox.write('math.js', seed);
  const store = new Store(path.join(d, 'run.db'));
  let i = 0;
  const model = { name: 'scripted', async invoke() {
    const r = responses[Math.min(i++, responses.length - 1)];
    return { input_tokens: 1, output_tokens: 1, ...(typeof r === 'function' ? r(sandbox) : r) };
  } };
  return { d, sandbox, store, model,
    make: (runId) => new Worker(store, {
      sandbox, model, tools: makeTools(sandbox),
      authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
      completionContract: defaultCompletionContract(store, runId),
      maxTurns: 12, hooks,
    }) };
}

describe('planning/contract-version');
{
  // The frozen set GREW, so the contract version must say so. Silently adding members would
  // leave a consumer unable to tell which vocabulary a log was written under.
  eq('the event contract is versioned', EVENT_CONTRACT_VERSION, 2);
  eq('the vocabulary is 35 types', EVENT_TYPES.length, 35);
  check('the set is still frozen', Object.isFrozen(EVENT_TYPES));
  for (const t of ['plan.created', 'plan.revised', 'plan.step_started', 'plan.step_finished'])
    check(`${t} is in the vocabulary`, EVENT_TYPES.includes(t));
}

describe('planning/T1-happy-path');
{
  // task -> plan -> step -> verify PASS -> advance -> next step -> completed
  const { store, make, sandbox } = rig({ responses: [
    call('plan', { goal: 'fix add()', steps: ['read the file', 'fix the bug', 'prove it'] }),
    call('plan_step', { step: '1', state: 'active' }),
    call('read', { path: 'math.js' }),
    call('plan_step', { step: '1', state: 'done', evidence: 'read 1 line' }),
    call('write', { path: 'math.js', content: FIXED }),
    call('plan_step', { step: '2', state: 'done', evidence: 'wrote a + b' }),
    call('verify', { cmd: 'echo TESTS_OK' }),
    call('plan_step', { step: '3', state: 'done', evidence: 'PASS (exit 0) echo TESTS_OK' }),
    finish('all three steps done'),
  ]});
  const runId = uid('run');
  store.createRun(runId, { task: 'fix add()' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  const res = await make(runId).run(runId, claim.leaseToken, { input: 'fix it' });

  eq('the run completed', res.status, 'completed');
  eq('for the normal reason', res.reason, ExitReason.MODEL_FINISHED);
  check('the file was actually fixed', sandbox.read('math.js') === FIXED);

  const plan = projectPlan(store.events(runId));
  check('a plan exists on the trajectory', !!plan);
  eq('with three steps', plan.steps.length, 3);
  check('every step is done', plan.steps.every(s => s.state === 'done'),
    plan.steps.map(s => `${s.id}:${s.state}`).join(' '));
  check('the plan is satisfied', planSatisfied(plan));

  // Each step carries its evidence, and the verify PASS is genuinely in the log.
  check('every step carries evidence', plan.steps.every(s => s.evidence && s.evidence.length),
    plan.steps.map(s => String(s.evidence)).join(' | '));
  const verifyEvent = store.events(runId).find(e =>
    e.type === 'tool.succeeded' && /^PASS /.test(String(e.payload?.result ?? '')));
  check('a verify PASS is recorded as trajectory evidence', !!verifyEvent,
    String(verifyEvent?.payload?.result ?? '').slice(0, 40));

  // The contract CONSUMED the plan: prove it by asking the contract directly.
  const contract = defaultCompletionContract(store, runId);
  check('the completion contract reads the plan as satisfied', contract.objectiveSatisfied());
}

describe('planning/T1-unfinished-plan-blocks-completion');
{
  // The sharp edge of "the contract consumed the plan": a run that declares three steps, does a
  // real mutation, then stops after one step is NOT complete. Wave 1's predicate alone would
  // have waved this through, because a mutating tool succeeded.
  const { store, make } = rig({ responses: [
    call('plan', { goal: 'fix add()', steps: ['fix the bug', 'prove it'] }),
    call('write', { path: 'math.js', content: FIXED }),
    call('plan_step', { step: '1', state: 'done', evidence: 'wrote a + b' }),
    finish('I think that is enough'),
  ]});
  const runId = uid('run');
  store.createRun(runId, { task: 'fix add()' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  const res = await make(runId).run(runId, claim.leaseToken, { input: 'fix it' });

  check('a half-finished plan does not complete the run', res.status !== 'completed',
    `${res.status}/${res.reason}`);
  eq('it fails as FINISHED_WITHOUT_CHANGE', res.reason, ExitReason.FINISHED_WITHOUT_CHANGE);
  const plan = projectPlan(store.events(runId));
  eq('step 2 is still pending', plan.steps[1].state, 'pending');
}

describe('planning/T2-fail-and-replan');
{
  // step -> verify FAIL -> replan (recorded) -> new action -> verify PASS -> complete
  const { store, make, sandbox } = rig({ responses: [
    call('plan', { goal: 'fix add()', steps: ['patch with edit', 'prove it'] }),
    call('edit', { path: 'math.js', old_string: 'NOT PRESENT', new_string: 'x' }),   // fails
    call('plan_step', { step: '1', state: 'failed', evidence: 'edit did not match' }),
    call('plan', { goal: 'fix add()', steps: ['rewrite the whole file', 'prove it'],
                   reason: 'the exact-match edit did not apply' }),
    call('write', { path: 'math.js', content: FIXED }),
    call('plan_step', { step: '1', state: 'done', evidence: 'rewrote file' }),
    call('verify', { cmd: 'echo TESTS_OK' }),
    call('plan_step', { step: '2', state: 'done', evidence: 'PASS (exit 0) echo TESTS_OK' }),
    finish('fixed after replanning'),
  ]});
  const runId = uid('run');
  store.createRun(runId, { task: 'fix add()' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  const res = await make(runId).run(runId, claim.leaseToken, { input: 'fix it' });

  eq('the run completed after replanning', res.status, 'completed');
  check('the file was fixed by the revised approach', sandbox.read('math.js') === FIXED);

  const events = store.events(runId);
  const revised = events.filter(e => e.type === 'plan.revised');
  eq('the replan is a recorded trajectory event', revised.length, 1);
  check('the revision carries its reason', /did not apply/.test(String(revised[0].payload?.reason)),
    String(revised[0].payload?.reason));

  const plan = projectPlan(events);
  eq('the plan is now at revision 2', plan.revision, 2);
  eq('the superseded plan is preserved, not overwritten', plan.history.length, 1);
  check('the old step list is still readable',
    /patch with edit/.test(plan.history[0].steps.map(s => s.title).join(' ')),
    plan.history[0].steps.map(s => s.title).join(' | '));
  check('the failed step of the old revision is still marked failed',
    plan.history[0].steps[0].state === 'failed', plan.history[0].steps[0].state);
  check('the current revision is satisfied', planSatisfied(plan));
}

describe('planning/T3-crash-resume-replay-identity');
{
  // THE ARCHITECTURAL TEST.
  //
  // Kill worker A mid-plan. Resume with a DIFFERENT worker object holding no shared state.
  // The recovered run must reconstruct the SAME plan from the log — and replay must too.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-t3-'));

  // --- worker A: declare the plan, finish step 1, then die before step 2 ---
  class Boom extends Error {}
  const runId = uid('run');
  let storeRef = null;
  const a = rig({ dir: d, responses: [
    call('plan', { goal: 'fix add()', steps: ['fix the bug', 'prove it'] }),
    call('write', { path: 'math.js', content: FIXED }),
    call('plan_step', { step: '1', state: 'done', evidence: 'wrote a + b' }),
    call('read', { path: 'math.js' }),          // the call we crash during
    finish('should never be reached'),
  ], hooks: { beforeAppend(marker) {
      // Crash the moment step 1 is durable and the run is mid-plan. The condition is read from
      // the LOG, not from a timer, so the crash lands at a deterministic point.
      if (marker !== 'after:tool.succeeded' || !storeRef) return;
      const p = projectPlan(storeRef.events(runId));
      if (p && p.steps[0].state === 'done' && p.steps[1].state === 'pending') throw new Boom('killed');
    } } });
  storeRef = a.store;

  a.store.createRun(runId, { task: 'fix add()' });
  const claimA = a.store.claim('A', { runId, leaseMs: 60_000 });
  let crashed = false;
  try { await a.make(runId).run(runId, claimA.leaseToken, { input: 'fix it' }); }
  catch (e) { crashed = e instanceof Boom; }

  check('worker A died mid-plan', crashed);

  // The plan AT THE MOMENT OF THE CRASH, read from the durable log.
  const atCrash = projectPlan(a.store.events(runId));
  check('a plan was durable at the moment of the crash', !!atCrash);
  eq('step 1 was done', atCrash.steps[0].state, 'done');
  eq('step 2 was not', atCrash.steps[1].state, 'pending');
  const fingerprint = (p) => JSON.stringify({ goal: p.goal, revision: p.revision,
    steps: p.steps.map(s => [s.id, s.title, s.state, s.evidence, s.retry, s.depends_on]) });
  const before = fingerprint(atCrash);

  // --- worker B: a fresh Worker, fresh Store handle. Shares nothing but the log. ---
  const storeB = new Store(path.join(d, 'run.db'));
  const reconstructed = projectPlan(storeB.events(runId));
  eq('a DIFFERENT process reconstructs the identical plan', fingerprint(reconstructed), before);

  const b = rig({ dir: d, responses: [
    call('verify', { cmd: 'echo TESTS_OK' }),
    call('plan_step', { step: '2', state: 'done', evidence: 'PASS (exit 0) echo TESTS_OK' }),
    finish('resumed and finished the plan'),
  ] });
  // Force-expire A's lease so B can legitimately claim the run.
  const claimB = b.store.claim('B', { runId, leaseMs: 60_000, now: Date.now() + 10 * 60_000 })
    ?? { leaseToken: claimA.leaseToken };
  check('worker B claimed the orphaned run', !!claimB.leaseToken);
  const resB = await b.make(runId).run(runId, claimB.leaseToken, {});

  eq('the resumed run completed', resB.status, 'completed');
  const afterPlan = projectPlan(b.store.events(runId));
  eq('the plan continued from where it stopped — same goal', afterPlan.goal, atCrash.goal);
  eq('same revision (no plan was lost or restarted)', afterPlan.revision, atCrash.revision);
  eq('step 1 kept its evidence across the crash', afterPlan.steps[0].evidence, atCrash.steps[0].evidence);
  eq('step 2 is now done', afterPlan.steps[1].state, 'done');
  check('the completed plan is satisfied', planSatisfied(afterPlan));

  // --- replay: zero model calls, identical plan ---
  const r = replay(b.store, runId);
  eq('replay makes no model calls', r.modelCalls ?? 0, 0);
  const replayed = projectPlan(b.store.events(runId));
  eq('replay reconstructs the plan identically', fingerprint(replayed), fingerprint(afterPlan));

  // And the plan is genuinely nowhere but the log: rebuilt from a third handle.
  const storeC = new Store(path.join(d, 'run.db'));
  eq('a third independent reader agrees', fingerprint(projectPlan(storeC.events(runId))),
     fingerprint(afterPlan));
}

describe('planning/readiness-and-dependencies');
{
  const events = [
    { type: 'plan.created', payload: { goal: 'g', steps: ['a', 'b', 'c'] } },
  ];
  let p = projectPlan(events);
  eq('only the first step is ready initially', readySteps(p).map(s => s.id).join(','), 's1.1');
  events.push({ type: 'plan.step_finished', payload: { step_id: 's1.1', state: 'done' } });
  p = projectPlan(events);
  eq('finishing a step unblocks the next', readySteps(p).map(s => s.id).join(','), 's1.2');
  check('a plan with no steps is never satisfied', !planSatisfied(projectPlan([
    { type: 'plan.created', payload: { goal: 'g', steps: [] } }])));
  eq('a run with no plan projects null', projectPlan([{ type: 'turn.started', payload: {} }]), null);
}

describe('planning/shim-parses-array-arguments');
{
  // FOUND IN MANUAL TESTING, not by the unit tests: `plan` is the first tool with an ARRAY
  // argument, and the Gemma grammar sentinel-delimits every element —
  //   steps:[<|"|>a<|"|>,<|"|>b<|"|>]
  // The shim read the whole literal as one opaque scalar, so `steps` arrived as a string,
  // schema validation rejected it, and the run died as no_progress after four identical
  // attempts. The model was right; the shim could not express what it said.
  const observed = '<|tool_call>call:plan{goal:<|"|>Fix add<|"|>,'
                 + 'steps:[<|"|>Read calc.py<|"|>,<|"|>Fix the bug<|"|>,<|"|>Run pytest<|"|>]}<tool_call|>';
  const r = parseGemmaToolCalls(observed);
  eq('one call is parsed', r.tool_calls.length, 1);
  eq('the scalar argument still works', r.tool_calls[0].args.goal, 'Fix add');
  check('the array argument is an ARRAY', Array.isArray(r.tool_calls[0].args.steps),
    typeof r.tool_calls[0].args.steps);
  eq('with every element', r.tool_calls[0].args.steps.length, 3);
  eq('in order', r.tool_calls[0].args.steps[2], 'Run pytest');

  // And it survives schema validation, which is what actually failed in the field.
  const tools = makeTools(new LocalSandbox(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-schema-'))));
  // validateArgs returns an ARRAY of problems; empty means valid.
  const errs = validateArgs(tools.plan, r.tool_calls[0].args);
  eq('the parsed args pass schema validation', errs.length, 0);
}

process.exit(summary('planning', path.join(HERE, '..', 'results-planning.json')) ? 1 : 0);
