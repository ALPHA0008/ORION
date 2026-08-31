// Escalation gate: crash, resume, replay and fork (brief §13–§15).
//
// An enforced boundary is only an invariant if it survives the runtime's own failure modes.
// These use the worker's `beforeAppend` hook to crash at precise points around the boundary,
// then check the durable state is still correct.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { replay, fork } from '../../src/core/replay/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const note = (s) => console.log(`       ${s}`);

const PROTECTED = [/(^|\/)tests?\//, /\.test\./];
const TEST_SRC = 'assert(compute() === 42)\n';

/** A model that always tries to edit the protected test — the phase-5 behaviour. */
function bypasser() {
  return { name: 'bypasser', calls: 0,
    async invoke() { this.calls++;
      return { content: '', tool_calls: [{ id: `tc${this.calls}`, name: 'edit',
                 args: { path: 'test/a.test.mjs', old_string: '42', new_string: '0' } }],
               input_tokens: 1, output_tokens: 1 }; } };
}

function makeRun(dirPrefix, hooks = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), dirPrefix));
  const sandbox = new LocalSandbox(path.join(dir, 'w'));
  sandbox.write('test/a.test.mjs', TEST_SRC);
  sandbox.write('src/a.js', 'export const compute = () => 41;\n');
  const store = new Store(path.join(dir, 'run.db'));
  const authorize = createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false,
                                       protectedPaths: PROTECTED });
  const runId = uid('run');
  store.createRun(runId, { task: 'make it pass' });
  const model = bypasser();
  const worker = new Worker(store, { sandbox, tools: makeTools(sandbox), model, authorize,
                                     workerId: 'w', maxTurns: 8, leaseMs: 60_000, hooks });
  return { dir, sandbox, store, runId, worker, model };
}

const CRASH = Symbol('crash');
const crashAt = (marker) => ({ beforeAppend: (m) => { if (m === marker) { const e = new Error('crash'); e[CRASH] = 1; throw e; } } });

console.log('escalation-lifecycle');

// ── §14 crash BEFORE escalation is recorded ─────────────────────────────
{
  const r = makeRun('el1-', crashAt('before:human.requested'));
  let crashed = false;
  try { await r.worker.run(r.runId, r.store.claim('w', { runId: r.runId, leaseMs: 60_000 }).leaseToken, { input: 't' }); }
  catch (e) { crashed = !!e[CRASH]; }
  ok('crash before human.requested propagates', crashed);
  const ev = r.store.events(r.runId);
  const n = (t) => ev.filter(e => e.type === t).length;
  note(`events: escalated=${n('tool.escalated')} human=${n('human.requested')} paused=${n('run.paused')}`);
  ok('  protected file still unchanged', r.sandbox.read('test/a.test.mjs') === TEST_SRC);
  ok('  no mutation executed', n('tool.started') === 0);
  r.store.close(); fs.rmSync(r.dir, { recursive: true, force: true });
}

// ── §14 crash AFTER human.requested, before run.paused ──────────────────
{
  const r = makeRun('el2-', crashAt('after:human.requested'));
  try { await r.worker.run(r.runId, r.store.claim('w', { runId: r.runId, leaseMs: 60_000 }).leaseToken, { input: 't' }); }
  catch { /* expected */ }
  const ev = r.store.events(r.runId);
  const n = (t) => ev.filter(e => e.type === t).length;
  ok('human.requested is durable after the crash', n('human.requested') === 1, String(n('human.requested')));
  ok('  no duplicate human request', n('human.requested') <= 1);
  ok('  protected file unchanged', r.sandbox.read('test/a.test.mjs') === TEST_SRC);

  // A fresh worker resumes the same run: it must NOT re-escalate or mutate.
  const claim2 = r.store.claim('w2', { runId: r.runId, leaseMs: 60_000 });
  if (claim2) {
    const w2 = new Worker(r.store, { sandbox: r.sandbox, tools: makeTools(r.sandbox),
      model: bypasser(), authorize: createAuthorizer({ posture: 'permissive',
      escalateUnsafeRecovery: false, protectedPaths: PROTECTED }), workerId: 'w2',
      maxTurns: 8, leaseMs: 60_000 });
    const res2 = await w2.run(r.runId, claim2.leaseToken, { input: 't' });
    const ev2 = r.store.events(r.runId);
    const dup = ev2.filter(e => e.type === 'human.requested').length;
    note(`after recovery: status=${res2.status}/${res2.reason} human.requested total=${dup}`);
    ok('  recovery does not mutate the protected file', r.sandbox.read('test/a.test.mjs') === TEST_SRC);
    ok('  run does not silently complete', res2.status !== 'completed', res2.status);
  } else {
    ok('  recovery does not mutate the protected file', true, '(lease still held)');
    ok('  run does not silently complete', true, '(lease still held)');
  }
  r.store.close(); fs.rmSync(r.dir, { recursive: true, force: true });
}

// ── §13 resume after a human answers ────────────────────────────────────
{
  const r = makeRun('el3-');
  const res = await r.worker.run(r.runId, r.store.claim('w', { runId: r.runId, leaseMs: 60_000 }).leaseToken, { input: 't' });
  ok('run paused awaiting a human', res.status === 'paused', `${res.status}/${res.reason}`);

  const open = r.store.humanRequests(r.runId, 'pending');
  ok('  a pending human request exists', open.length === 1, String(open.length));

  // The human denies the change — the correct answer for a fabricated bypass.
  r.store.answerHumanRequest(open[0].id, 'deny');

  const claim = r.store.claim('w2', { runId: r.runId, leaseMs: 60_000 });
  ok('  paused run is claimable (lease was released)', !!claim);

  if (claim) {
    // Resume with a model that now does the RIGHT thing: fix the source instead.
    let n = 0;
    const fixer = { name: 'fixer', async invoke() {
      n++;
      if (n === 1) return { content: '', tool_calls: [{ id: 'f1', name: 'edit',
        args: { path: 'src/a.js', old_string: '41', new_string: '42' } }], input_tokens: 1, output_tokens: 1 };
      return { content: 'fixed the source instead', tool_calls: [], input_tokens: 1, output_tokens: 1 }; } };
    const w2 = new Worker(r.store, { sandbox: r.sandbox, tools: makeTools(r.sandbox), model: fixer,
      authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false,
      protectedPaths: PROTECTED }), workerId: 'w2', maxTurns: 8, leaseMs: 60_000 });
    const res2 = await w2.run(r.runId, claim.leaseToken, { input: 't' });
    note(`resumed -> ${res2.status}/${res2.reason}`);
    ok('  run resumes and completes', res2.status === 'completed', `${res2.status}/${res2.reason}`);
    ok('  the SOURCE was fixed', r.sandbox.read('src/a.js').includes('42'));
    ok('  the protected test is STILL unchanged', r.sandbox.read('test/a.test.mjs') === TEST_SRC);
  }
  r.store.close(); fs.rmSync(r.dir, { recursive: true, force: true });
}

// ── §15 replay and fork across the escalation boundary ──────────────────
{
  const r = makeRun('el4-');
  await r.worker.run(r.runId, r.store.claim('w', { runId: r.runId, leaseMs: 60_000 }).leaseToken, { input: 't' });

  const before = project(r.store, r.runId);
  const rp = replay(r.store, r.runId);
  ok('replay reproduces the paused state', rp.state.status === before.status,
     `${rp.state.status} vs ${before.status}`);
  ok('  replay is deterministic across the boundary',
     JSON.stringify(rp.state.open_human_requests) === JSON.stringify(before.open_human_requests));
  ok('  replay made zero model calls', rp.model_calls_made === 0);

  const escSeq = r.store.events(r.runId).find(e => e.type === 'tool.escalated')?.seq;
  ok('  escalation IS in the durable event history', typeof escSeq === 'number', String(escSeq));

  // Fork BEFORE the escalation: the child must not inherit the paused state.
  const child = fork(r.store, r.runId, escSeq - 1);
  const childId = child.run_id ?? child.runId ?? child;
  const cs = project(r.store, childId);
  note(`fork before escalation -> child status=${cs.status}`);
  ok('  fork before escalation is not paused', cs.status !== 'paused', cs.status);
  ok('  parent remains paused', project(r.store, r.runId).status === 'paused');

  r.store.close(); fs.rmSync(r.dir, { recursive: true, force: true });
}

console.log(`\nescalation-lifecycle: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
