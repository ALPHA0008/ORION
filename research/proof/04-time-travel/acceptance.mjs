// Experiment 4 — acceptance tests A–E, plus the V0 gate from NEXT-HARNESS-SPEC 28.21.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, LocalSandbox, makeTools, makeAuthorizer, project, uid } from './harness.mjs';
import { Worker, reap, fork, explain } from './worker.mjs';
import { model } from './scenario.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(os.tmpdir(), 'tt-' + Date.now());
fs.mkdirSync(ROOT, { recursive: true });
const results = [];
let pass = 0, fail = 0;

function check(name, cond, detail = '') {
  const ok = !!cond;
  ok ? pass++ : fail++;
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  results.push({ test: name, pass: ok, detail });
  return ok;
}
function fresh(tag) {
  const dir = path.join(ROOT, tag); fs.mkdirSync(dir, { recursive: true });
  const store = new Store(path.join(dir, 'h.db'));
  const sandbox = new LocalSandbox(path.join(dir, 'work'));
  return { dir, store, sandbox, tools: makeTools(sandbox) };
}

// ============ A. HAPPY PATH (baseline the others are compared against) ============
console.log('\n=== A. Baseline run ===');
let GOLDEN = null;
{
  const { store, sandbox, tools } = fresh('A');
  const runId = uid('run'); store.createRun(runId);
  store.claim('wA');
  const w = new Worker(store, { sandbox, model: model(), tools, authorize: makeAuthorizer(), workerId: 'wA' });
  const r = w.runOnce(runId, { input: 'build the mini project' });
  const st = project(store, runId);
  GOLDEN = { events: store.events(runId).map(e => e.type), files: {
    'a.txt': sandbox.read('a.txt'), 'b.txt': sandbox.read('b.txt'), 'c.txt': sandbox.read('c.txt') } };
  check('A1 run completes', r.status === 'completed', r.status);
  check('A2 all three files written', sandbox.exists('a.txt') && sandbox.exists('b.txt') && sandbox.exists('c.txt'));
  check('A3 edit applied', sandbox.read('b.txt').includes('VALUE=20'));
  check('A4 bash check ran', store.events(runId).some(e => e.type==='tool.succeeded' && String(e.payload?.result).includes('CHECK-OK')));
  check('A5 events recorded', st.seq > 20, `${st.seq} events`);
  console.log(`   (${st.seq} events, ${st.budget.tool_calls} tool calls, ${st.budget.model_calls} model calls)`);
  store.close();
}

// ============ B. REAL PROCESS KILL -> RESUME ============
console.log('\n=== B. Kill -9 mid-run, restart, resume (REAL process kill) ===');
{
  const dir = path.join(ROOT, 'B'); fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'h.db'), workDir = path.join(dir, 'work');
  const store = new Store(dbPath); const runId = uid('run'); store.createRun(runId); store.close();

  // child 1: spawned ASYNC and killed by the PARENT mid-flight.
  // (A child-side setTimeout cannot work here: the slow-tool busy-wait blocks its event loop.)
  const c1 = spawn(process.execPath, [path.join(HERE, 'runner.mjs'), dbPath, workDir, runId, 'slow', '0'],
    { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1100));          // let it get several tool calls in
  const wasAlive = c1.exitCode === null && c1.signalCode === null;
  c1.kill('SIGKILL');
  const c1exit = await new Promise(r => c1.on('exit', (code, sig) => r({ code, sig })));
  check('B1 child was alive and then SIGKILLed', wasAlive && (c1exit.sig === 'SIGKILL' || c1exit.code !== 0),
    `alive=${wasAlive} exit=${JSON.stringify(c1exit)}`);

  const s2 = new Store(dbPath);
  const mid = project(s2, runId);
  const midEvents = mid.seq;
  check('B2 partial work survived the kill', midEvents > 1, `${midEvents} events persisted`);
  check('B3 run left un-terminal', !['completed','failed'].includes(mid.status), mid.status);

  // reaper: lease is still in the future, so nothing to reap yet -> prove expiry path
  const before = reap(s2);
  s2.db.prepare('UPDATE runs SET lease_expires_at=? WHERE id=?').run(Date.now() - 1, runId);
  const after = reap(s2);
  check('B4 reaper ignores a live lease', before.requeued === 0, JSON.stringify(before));
  check('B5 reaper requeues an expired lease', after.requeued === 1, JSON.stringify(after));
  s2.close();

  // child 2: fresh process, claims and finishes
  const c2 = spawnSync(process.execPath, [path.join(HERE, 'runner.mjs'), dbPath, workDir, runId, 'normal', '0'],
    { encoding: 'utf8', timeout: 60000 });
  const out = (c2.stdout || '').trim().split('\n').pop();
  let parsed = {}; try { parsed = JSON.parse(out); } catch {}
  const s3 = new Store(dbPath); const fin = project(s3, runId);
  const sb = new LocalSandbox(workDir);
  check('B6 second process resumed and completed', parsed.status === 'completed', `${parsed.status} (${c2.status})`);
  check('B7 final state correct after resume', sb.read('b.txt').includes('VALUE=20'));
  check('B8 all files present after resume', ['a.txt','b.txt','c.txt'].every(f => sb.exists(f)));
  check('B9 more events than at crash', fin.seq > midEvents, `${midEvents} -> ${fin.seq}`);
  const recov = s3.events(runId).filter(e => e.type==='degraded' && e.payload?.subsystem==='recovery');
  console.log(`   crash@${midEvents} events -> resumed -> ${fin.seq} events; ${recov.length} recovery decision(s) logged`);
  if (recov.length) console.log(`   recovery: ${recov.map(r=>r.payload.reason).join(' | ')}`);
  s3.close();
}

// ============ C. REPLAY ============
console.log('\n=== C. Replay reconstructs state deterministically ===');
{
  const { store, sandbox, tools } = fresh('C');
  const runId = uid('run'); store.createRun(runId); store.claim('wC');
  const w = new Worker(store, { sandbox, model: model(), tools, authorize: makeAuthorizer(), workerId: 'wC' });
  w.runOnce(runId, { input: 'build the mini project' });

  const live = project(store, runId, { useSnapshot: true });
  const cold = project(store, runId, { useSnapshot: false });   // full replay from event 1
  check('C1 snapshot-load == full replay', JSON.stringify(live) === JSON.stringify(cold));

  // replay to an earlier point must yield the state as it was then
  const half = Math.floor(live.seq / 2);
  const atHalf = project(store, runId, { upToSeq: half, useSnapshot: false });
  check('C2 point-in-time replay works', atHalf.seq === half && atHalf.message_count <= live.message_count,
    `seq ${atHalf.seq}, ${atHalf.message_count} msgs vs ${live.message_count}`);
  check('C3 replay is repeatable (byte-identical)',
    JSON.stringify(project(store, runId, {useSnapshot:false})) === JSON.stringify(cold));
  // event sequence identical to the golden baseline run
  const types = store.events(runId).map(e => e.type);
  check('C4 event sequence matches baseline run', JSON.stringify(types) === JSON.stringify(GOLDEN.events),
    `${types.length} vs ${GOLDEN.events.length} events`);
  store.close();
}

// ============ D. FORK ============
console.log('\n=== D. Fork at event N, diverge, both independent ===');
{
  const { dir, store, sandbox, tools } = fresh('D');
  const runId = uid('run'); store.createRun(runId); store.claim('wD');
  const w = new Worker(store, { sandbox, model: model(), tools, authorize: makeAuthorizer(), workerId: 'wD' });
  w.runOnce(runId, { input: 'build the mini project' });
  const orig = project(store, runId);

  // fork just before the edit step
  const evs = store.events(runId);
  const editIdx = evs.find(e => e.type === 'tool.started' && e.payload?.name === 'edit');
  const forkAt = editIdx ? editIdx.seq - 1 : Math.floor(orig.seq / 2);
  const f = fork(store, runId, forkAt);

  const forkState = project(store, f);
  check('D1 fork copied history up to N', forkState.seq >= forkAt, `fork seq=${forkState.seq}, forkAt=${forkAt}`);
  check('D2 fork records provenance', store.run(f).parent_run_id === runId && Number(store.run(f).forked_from_seq) === forkAt);
  check('D3 fork did not mutate the source', project(store, runId).seq === orig.seq, `${orig.seq}`);

  // run the fork with a DIFFERENT policy: deny the edit -> divergent outcome
  const sb2 = new LocalSandbox(path.join(dir, 'work2'));
  for (const fn of ['a.txt','b.txt','c.txt']) if (sandbox.exists(fn)) sb2.write(fn, sandbox.read(fn));
  const tools2 = makeTools(sb2);
  const w2 = new Worker(store, { sandbox: sb2, model: model(), tools: tools2,
    authorize: makeAuthorizer({ denyTools: ['edit'] }), workerId: 'wD2' });
  store.claim('wD2');
  const r2 = w2.runOnce(f, {});

  const forkFinal = project(store, f);
  const origFinal = project(store, runId);
  check('D4 fork ran to a terminal state', ['completed','failed'].includes(forkFinal.status), forkFinal.status);
  check('D5 branches diverged', JSON.stringify(forkFinal.recent_messages) !== JSON.stringify(origFinal.recent_messages));
  check('D6 original filesystem untouched by fork', sandbox.read('b.txt').includes('VALUE=20'));
  check('D7 fork filesystem shows the different path', !sb2.read('b.txt').includes('VALUE=20'),
    `fork b.txt = ${JSON.stringify(sb2.read('b.txt').trim())}`);
  const denied = store.events(f).some(e => e.type === 'tool.denied');
  check('D8 divergence cause is in the fork log', denied);
  console.log(`   original: ${origFinal.seq} events -> ${origFinal.status}; fork: ${forkFinal.seq} events -> ${forkFinal.status}`);
  store.close();
}

// ============ E. HUMAN PAUSE ACROSS PROCESS DEATH ============
console.log('\n=== E. Escalate -> release lease -> process exits -> human answers later -> new worker resumes ===');
{
  const dir = path.join(ROOT, 'E'); fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'h.db'), workDir = path.join(dir, 'work');
  const store = new Store(dbPath); const runId = uid('run'); store.createRun(runId); store.close();

  // process 1: escalates on bash, then EXITS
  const p1 = spawnSync(process.execPath, [path.join(HERE, 'runner.mjs'), dbPath, workDir, runId, 'escalate', '0'],
    { encoding: 'utf8', timeout: 60000 });
  let r1 = {}; try { r1 = JSON.parse((p1.stdout||'').trim().split('\n').pop()); } catch {}
  const s = new Store(dbPath);
  const paused = project(s, runId);
  check('E1 run paused on escalation', r1.status === 'paused', `${r1.status} ${r1.reason ?? ''}`);
  check('E2 lease released (no worker holds it)', s.run(runId).lease_expires_at === null && s.run(runId).worker_id === null);
  check('E3 HumanRequest durably persisted', s.db.prepare(`SELECT COUNT(*) c FROM human_requests WHERE run_id=? AND status='pending'`).get(runId).c === 1);
  check('E4 process 1 exited cleanly', p1.status === 0, `exit=${p1.status}`);
  check('E5 open request visible in projection', Object.keys(paused.open_human_requests).length === 1);

  // ... time passes; a different process answers ...
  const hr = s.db.prepare(`SELECT id FROM human_requests WHERE run_id=? AND status='pending'`).get(runId);
  s.db.prepare(`UPDATE human_requests SET status='answered', response='approve' WHERE id=?`).run(hr.id);
  s.close();

  // process 2: fresh worker picks it up
  const p2 = spawnSync(process.execPath, [path.join(HERE, 'runner.mjs'), dbPath, workDir, runId, 'escalate', '0'],
    { encoding: 'utf8', timeout: 60000 });
  let r2 = {}; try { r2 = JSON.parse((p2.stdout||'').trim().split('\n').pop()); } catch {}
  const s2 = new Store(dbPath); const fin = project(s2, runId);
  check('E6 a different process resumed after the human answered', ['completed','paused'].includes(r2.status), r2.status);
  check('E7 human response recorded in the log', s2.events(runId).some(e => e.type === 'human.responded'));
  check('E8 no open requests remain', Object.keys(fin.open_human_requests).length === 0);
  console.log(`   paused@${paused.seq} -> human approved -> resumed -> ${fin.seq} events, status=${fin.status}`);
  s2.close();
}

// ============ F. DEGRADATION VISIBILITY ============
console.log('\n=== F. Every fallback emits `degraded` and surfaces in final state ===');
{
  const { store, sandbox, tools } = fresh('F');
  const runId = uid('run'); store.createRun(runId); store.claim('wF');
  // model fails twice (retryable) then degrades on call 4
  const m = model({ failFirstN: 2, degradeAt: 4 });
  const w = new Worker(store, { sandbox, model: m, tools, authorize: makeAuthorizer(), workerId: 'wF' });
  const r = w.runOnce(runId, { input: 'build the mini project' });
  const st = project(store, runId);
  const degraded = store.events(runId).filter(e => e.type === 'degraded');
  check('F1 model retry emitted degraded', degraded.some(d => d.payload.subsystem === 'model'));
  check('F2 model.failed recorded', store.events(runId).filter(e => e.type==='model.failed').length === 2);
  check('F3 degradations visible in final state', st.degradation_count >= 2, `count=${st.degradation_count}`);
  check('F4 run still completed despite degradation', r.status === 'completed', r.status);
  check('F5 status derives from counted effects, not config', st.degradations.length > 0 && st.degradations.every(d => d.subsystem && d.reason));
  console.log(`   ${degraded.length} degraded events: ${[...new Set(degraded.map(d=>d.payload.subsystem))].join(', ')}`);
  store.close();
}

// ============ G. ORPHANED TOOL RECOVERY (Experiment 2 contract, in situ) ============
console.log('\n=== G. Orphaned tool.started resolved by the recovery contract ===');
{
  const { store, sandbox, tools } = fresh('G');
  const runId = uid('run'); store.createRun(runId); store.claim('wG');

  // SAFE_RETRY orphan: write already applied
  sandbox.write('a.txt', 'alpha\nVALUE=1\n');
  store.append(runId, 'turn.started', { input: 'x' });
  store.append(runId, 'tool.started', { tool_call_id: 'orphan1', name: 'write',
    args: { path: 'a.txt', content: 'alpha\nVALUE=1\n' } });
  // UNSAFE orphan: bash with >> (should escalate)
  const w = new Worker(store, { sandbox, model: model(), tools, authorize: makeAuthorizer(), workerId: 'wG' });
  w.runOnce(runId, {});
  const evs = store.events(runId);
  const rec = evs.filter(e => e.type==='degraded' && e.payload?.subsystem==='recovery');
  check('G1 orphan detected and a decision logged', rec.length >= 1, rec.map(r=>r.payload.reason).join('|'));
  check('G2 verify() short-circuited the re-issue', rec.some(r => /-> skip/.test(r.payload.reason)),
    rec.map(r=>r.payload.reason).join('|'));
  check('G3 orphan resolved to a terminal tool event',
    evs.some(e => e.type==='tool.succeeded' && e.payload?.tool_call_id==='orphan1'));
  store.close();
}
{
  const { store, sandbox, tools } = fresh('G2');
  const runId = uid('run'); store.createRun(runId); store.claim('wG2');
  store.append(runId, 'turn.started', { input: 'x' });
  store.append(runId, 'tool.started', { tool_call_id: 'orphan2', name: 'bash',
    args: { cmd: 'echo x >> log.txt' } });   // UNSAFE, no verify
  const w = new Worker(store, { sandbox, model: model(), tools, authorize: makeAuthorizer(), workerId: 'wG2' });
  const r = w.runOnce(runId, {});
  check('G4 UNSAFE orphan escalates instead of guessing', r.status === 'paused' && r.reason === 'ambiguous_tool_recovery',
    `${r.status}/${r.reason}`);
  check('G5 lease released while awaiting the human', store.run(runId).worker_id === null);
  store.close();
}

// ============ SUMMARY ============
console.log('\n' + '='.repeat(70));
console.log(`RESULT: ${pass} passed, ${fail} failed  (${results.length} assertions)`);
fs.writeFileSync(path.join(HERE, 'acceptance-results.json'),
  JSON.stringify({ pass, fail, results, root: ROOT }, null, 2));
console.log(`artifacts: ${ROOT}`);
process.exit(fail ? 1 : 0);
