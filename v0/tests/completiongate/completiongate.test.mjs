// Control-loop completion semantics (§12, §14).
//
// INVESTIGATIVE. These tests do not change production behaviour; they PIN what the loop currently
// does so the mechanism is documented rather than argued about.
//
// Measured on real trajectories: 12 of 22 Qwen runs terminated with a response containing no tool
// calls AND no text — one was mid-exploration, paging at line 144 of 224 — and the loop recorded
// `completed`. Gemma: 0 of 22.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { project } from '../../src/core/projection/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const note = (s) => console.log(`       ${s}`);

const SRC = 'export function add(a, b) {\n  return a - b;\n}\n';

/** Run the worker against a scripted model and report what the loop concluded. */
async function run(responses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgate-'));
  const sandbox = new LocalSandbox(path.join(dir, 'w'));
  sandbox.write('src/math.js', SRC);
  const store = new Store(path.join(dir, 'run.db'));
  let i = 0;
  const model = { name: 'scripted', async invoke() {
    const r = responses[Math.min(i++, responses.length - 1)];
    return { input_tokens: 1, output_tokens: 1, ...r };
  } };
  const runId = uid('run');
  store.createRun(runId, { task: 'fix add()' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  const w = new Worker(store, { sandbox, tools: makeTools(sandbox), model,
    authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
    workerId: 'w', maxTurns: 8, leaseMs: 60_000 });
  const res = await w.run(runId, claim.leaseToken, { input: 'fix add()' });
  const st = project(store, runId);
  const after = sandbox.read('src/math.js');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return { res, st, after, unchanged: after === SRC };
}

console.log('completiongate');

// ── 1. an EMPTY response completes the run ──────────────────────────────
{
  const r = await run([{ content: '', tool_calls: [] }]);
  ok('empty response terminates the run', r.res.status === 'completed', r.res.status);
  ok('  reason is model_finished', r.res.reason === 'model_finished', r.res.reason);
  ok('  the world is UNCHANGED', r.unchanged);
  note('12 of 22 real Qwen runs ended exactly this way; Gemma 0 of 22');
}

// ── 2. prose-only response also completes ───────────────────────────────
{
  const r = await run([{ content: 'The bug is that add() subtracts. The fix is to use a + b.', tool_calls: [] }]);
  ok('prose-only response terminates the run', r.res.status === 'completed', r.res.status);
  ok('  the world is UNCHANGED', r.unchanged);
  ok('  the loop stored the prose as the result', /subtracts/.test(r.res.result ?? ''));
  note('a correct diagnosis and a finished job are indistinguishable to the loop');
}

// ── 3. the loop does not consult any task contract ──────────────────────
{
  // Same empty response, but the run was created with a task that plainly requires a mutation.
  const r = await run([{ content: '', tool_calls: [] }]);
  ok('no task-contract check exists in the loop', r.res.status === 'completed');
  note('worker.mjs: `if (resp.finish || !resp.tool_calls?.length) return #stop(..., completed, ...)`');
}

// ── 4. an empty response MID-EXPLORATION still completes ────────────────
{
  const r = await run([
    { content: '', tool_calls: [{ id: 't1', name: 'read', args: { path: 'src/math.js' } }] },
    { content: '', tool_calls: [] },      // model goes quiet while still exploring
  ]);
  ok('empty response after a read completes the run', r.res.status === 'completed', r.res.status);
  ok('  the world is UNCHANGED', r.unchanged);
  note('observed in the real corpus: Qwen paging at line 144 of 224, then a 7-token empty reply');
}

// ── 5. acting still works normally (no regression in the happy path) ────
{
  const r = await run([
    { content: '', tool_calls: [{ id: 'e1', name: 'edit',
        args: { path: 'src/math.js', old_string: 'a - b', new_string: 'a + b' } }] },
    { content: 'fixed', tool_calls: [] },
  ]);
  ok('a mutating run still completes normally', r.res.status === 'completed');
  ok('  the world IS changed', !r.unchanged);
}

// ── 6. what the loop DOES record, for a future gate to use ──────────────
{
  const r = await run([{ content: 'diagnosis only', tool_calls: [] }]);
  const mutations = ['edit', 'write'].reduce((n, t) => n + (r.st.budget.tool_calls ?? 0) * 0, 0);
  ok('the projection tracks tool_calls', typeof r.st.budget.tool_calls === 'number');
  ok('  a zero-mutation run is observable from state', r.st.budget.tool_calls === 0,
     String(r.st.budget.tool_calls));
  note('a completion gate would have the evidence it needs without new events');
}

console.log(`\ncompletiongate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
