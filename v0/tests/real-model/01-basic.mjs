// STEP 2 — real-model basic task.
// Inspect a repo, make a change, run a verification command, summarize.
import { requireRealModel, mkEnv, mkWorker, metrics, fmtMetrics, CFG, uid } from '../_helpers/real-model.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { explain } from '../../src/core/run/explain.mjs';
import { describe, check, eq, summary } from '../harness.mjs';
import path from 'node:path'; import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

requireRealModel();
const HERE = path.dirname(fileURLToPath(import.meta.url));

const { store, sandbox, tools, dir } = mkEnv('basic');

// A tiny repo for the agent to work in.
sandbox.write('README.md', '# demo\n\nA tiny project.\n');
sandbox.write('src/calc.js', 'export function add(a, b) {\n  return a - b;   // BUG: should be +\n}\n');
sandbox.write('test.sh', '#!/bin/sh\nnode -e "import(\'./src/calc.js\').then(m=>{if(m.add(2,3)!==5){console.log(\'FAIL\');process.exit(1)}console.log(\'PASS\')})"\n');
sandbox.write('package.json', '{"type":"module"}\n');

const TASK = [
  'The repository has a bug in src/calc.js: add() subtracts instead of adding.',
  'Fix it, then run "sh test.sh" to verify, then summarise what you changed.',
].join(' ');

const runId = uid('run');
store.createRun(runId, { task: TASK });
const c = store.claim('w1', { runId });
const w = mkWorker(store, sandbox, tools, { workerId: 'w1', maxTurns: 14 });

console.log(`model: ${CFG.model} @ ${CFG.baseUrl}`);
console.log(`task : ${TASK}\n`);

const t0 = Date.now();
let res = await w.run(runId, c.leaseToken, { input: TASK });

// The runtime correctly escalates `bash` (UNSAFE-to-retry, ADR-002). A human answers, and a
// NEW worker session resumes — which is also a mini durability test.
let approvals = 0;
while (res.status === 'paused' && res.reason === 'awaiting_human' && approvals < 4) {
  const pending = store.humanRequests(runId, 'pending');
  if (!pending.length) break;
  console.log(`  [human] approving: ${String(pending[0].prompt).slice(0, 70)}`);
  store.answerHumanRequest(pending[0].id, 'approve');
  approvals++;
  const c2 = store.claim(`w1r${approvals}`, { runId });
  if (!c2) break;
  res = await mkWorker(store, sandbox, tools, { workerId: `w1r${approvals}`, maxTurns: 14 })
    .run(runId, c2.leaseToken, {});
}
const wall = Date.now() - t0;
const st = project(store, runId);
const m = metrics(store, runId, wall);

describe('STEP 2 — real model, real task');
eq('run reached a terminal state', ['completed', 'failed'].includes(res.status), true, `${res.status}/${res.reason}`);
check('escalation + human approval + resume worked', approvals > 0, `${approvals} approval(s)`);
check('model was actually called', m.model_calls > 0, `${m.model_calls} calls`);
check('tokens were recorded', m.input_tokens > 0 && m.output_tokens > 0, `in ${m.input_tokens} / out ${m.output_tokens}`);
check('model.requested events exist', store.events(runId).some(e => e.type === 'model.requested'));
check('model.responded events exist', store.events(runId).some(e => e.type === 'model.responded'));
check('the model issued at least one tool call', m.tool_calls > 0, `${m.tool_calls}`);
// Every tool call must pass the seam. A human-approved call is authorized by the HUMAN
// (tool.escalated -> human.responded), not by a second tool.authorized event.
{
  const e2 = store.events(runId);
  const gated = e2.filter(x => ['tool.authorized', 'tool.denied', 'tool.escalated'].includes(x.type)).length;
  check('every tool call passed the authorization seam', gated >= m.tool_calls,
    `${gated} gate events for ${m.tool_calls} tool calls`);
  check('no tool.started without a preceding gate decision', (() => {
    const seen = new Set(); let ok = true;
    for (const x of e2) {
      if (['tool.authorized', 'tool.escalated'].includes(x.type)) seen.add(x.payload.tool_call_id);
      if (x.type === 'tool.started' && !seen.has(x.payload.tool_call_id)) ok = false;
    }
    return ok;
  })());
}
check('tool results were recorded', m.tool_succeeded + m.tool_failed > 0);

// event-log integrity, not just exit code
const ev = store.events(runId);
check('event log is gapless', ev.every((e, i) => e.seq === i + 1), `${ev.length} events`);
check('no dangling in-flight tool calls', Object.keys(st.pending_tool_calls).length === 0,
  JSON.stringify(Object.keys(st.pending_tool_calls)));
check('every tool.started has a terminal event', (() => {
  const started = ev.filter(e => e.type === 'tool.started').map(e => e.payload.tool_call_id);
  const done = new Set(ev.filter(e => ['tool.succeeded','tool.failed'].includes(e.type)).map(e => e.payload.tool_call_id));
  return started.every(id => done.has(id));
})());
check('projection is consistent with a cold replay',
  JSON.stringify(project(store, runId, { useSnapshot: false })) === JSON.stringify(project(store, runId, { useSnapshot: true })));

// did the model actually do the work?
const fixed = sandbox.read('src/calc.js').includes('a + b');
check('THE BUG WAS ACTUALLY FIXED in the filesystem', fixed, JSON.stringify(sandbox.read('src/calc.js').trim()));
const ranTest = ev.some(e => e.type === 'tool.succeeded' && e.payload.name === 'bash');
check('the model ran a verification command', ranTest);
const testPassed = ev.some(e => e.type === 'tool.succeeded' && String(e.payload.result).includes('PASS'));
check('the verification command reported PASS', testPassed,
  ev.filter(e => e.type==='tool.succeeded' && e.payload.name==='bash').map(e=>String(e.payload.result).trim().slice(0,40)).join(' | '));

// explain must be readable
const ex = explain(store, runId);
check('explain renders without raw JSON dumps', !/"payload"/.test(ex) && ex.split('\n').length > 5, `${ex.split('\n').length} lines`);

console.log('\n' + fmtMetrics(m));
console.log('\n--- explain ---\n' + ex);
console.log('\n--- final src/calc.js ---\n' + sandbox.read('src/calc.js'));

fs.writeFileSync(path.join(HERE, 'result-01.json'), JSON.stringify({
  model: CFG.model, task: TASK, status: res.status, reason: res.reason,
  metrics: m, fixed, explain: ex, final_file: sandbox.read('src/calc.js'),
  events: ev.map(e => ({ seq: e.seq, type: e.type, payload: e.payload })),
}, null, 2));
store.close();
process.exit(summary('real-model 01 basic') ? 1 : 0);
