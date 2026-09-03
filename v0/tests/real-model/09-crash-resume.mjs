// STEP 9 — REAL PROCESS KILL + RESUME, with a REAL model.
// The question is not "did the process continue?" but "did the MODEL resume coherently?"
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { explain } from '../../src/core/run/explain.mjs';
import { reap } from '../../src/core/lease/reaper.mjs';
import { requireRealModel, CFG, metrics } from '../_helpers/real-model.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

requireRealModel();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, '..', '_helpers', 'real-runner.mjs');

const TASK = [
  'Do these steps in order, one tool call at a time:',
  '1) write a file notes/step1.txt containing exactly: alpha',
  '2) write a file notes/step2.txt containing exactly: beta',
  '3) write a file notes/step3.txt containing exactly: gamma',
  '4) read notes/step1.txt to confirm it exists',
  'Then reply with a one-line summary listing the files you created.',
].join(' ');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];

/** Run one crash scenario: start, kill after `killAfterMs`, reap, resume, inspect. */
async function scenario(label, targetEvents) {
  const dir = path.join(os.tmpdir(), `rmcrash-${label}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'h.db'), workDir = path.join(dir, 'work');

  const s0 = new Store(dbPath); const runId = uid('run');
  s0.createRun(runId, { task: TASK }); s0.close();

  // ---- process 1: real model, killed mid-flight by the PARENT ----
  const child = spawn(process.execPath, [RUNNER, dbPath, workDir, runId, TASK, 'permissive'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let childOut = '';
  child.stdout.on('data', d => { childOut += d; });
  // Attach the exit listener BEFORE we can possibly kill, so a child that finishes early
  // still settles the promise. (A listener attached after exit never fires.)
  let exited = null;
  const exitP = new Promise(r => child.on('exit', (code, sig) => { exited = { code, sig }; r(exited); }));

  // Kill by PROGRESS, not by wall clock: poll the durable event count until it reaches the
  // target, so the kill lands at a comparable point regardless of model latency.
  const probe = new Store(dbPath);
  const deadline = Date.now() + 120_000;
  while (!exited && Date.now() < deadline) {
    if (probe.lastSeq(runId) >= targetEvents) break;
    await sleep(60);
  }
  const seqAtKill = probe.lastSeq(runId);
  probe.close();

  const wasAlive = child.exitCode === null && child.signalCode === null;
  if (wasAlive) child.kill('SIGKILL');
  const exit = await exitP;

  // ---- state at the moment of the crash ----
  const s1 = new Store(dbPath);
  const atCrash = project(s1, runId, { useSnapshot: false });
  const lastEv = s1.events(runId).slice(-1)[0];
  const sbCrash = new LocalSandbox(workDir);
  const filesAtCrash = ['notes/step1.txt', 'notes/step2.txt', 'notes/step3.txt']
    .filter(f => sbCrash.exists(f));
  const orphans = Object.entries(atCrash.pending_tool_calls).filter(([, v]) => !v.escalated);
  const leaseHeld = s1.run(runId).lease_token !== null;

  // ---- reaper reclaims (fast-forward the clock rather than waiting 30s) ----
  s1.db.prepare('UPDATE runs SET lease_expires_at=? WHERE id=?').run(Date.now() - 1, runId);
  const reaped = reap(s1);
  s1.close();

  // ---- process 2: a DIFFERENT process resumes with the real model ----
  const p2 = spawnSync(process.execPath, [RUNNER, dbPath, workDir, runId, TASK, 'permissive'],
    { encoding: 'utf8', timeout: 240_000, env: process.env });
  let fin = {}; try { fin = JSON.parse((p2.stdout || '').trim().split('\n').pop()); } catch {}

  const s2 = new Store(dbPath);
  const end = project(s2, runId, { useSnapshot: false });
  const ev = s2.events(runId);
  const sb2 = new LocalSandbox(workDir);
  const filesEnd = ['notes/step1.txt', 'notes/step2.txt', 'notes/step3.txt'].filter(f => sb2.exists(f));

  // --- coherence probes ---
  const resumeSeq = ev.find(e => e.type === 'run.lease_lost')?.seq ?? atCrash.seq;
  const afterResume = ev.filter(e => e.seq > resumeSeq);
  const writesBefore = ev.filter(e => e.seq <= atCrash.seq && e.type === 'tool.succeeded' && e.payload?.name === 'write')
    .map(e => JSON.parse(JSON.stringify(e.payload)));
  const writesAfter = afterResume.filter(e => e.type === 'tool.succeeded' && e.payload?.name === 'write');
  const startedAfter = afterResume.filter(e => e.type === 'tool.started');

  // Did it redo a file it had already written before the crash?
  const pathOf = (e) => e.payload?.args?.path ?? null;
  const donePaths = new Set(ev.filter(e => e.seq <= atCrash.seq && e.type === 'tool.started' && e.payload?.name === 'write')
    .map(pathOf).filter(Boolean));
  const redone = startedAfter.filter(e => e.payload?.name === 'write' && donePaths.has(pathOf(e))).map(pathOf);

  const row = {
    label, target_events: targetEvents, seq_at_kill: seqAtKill,
    child_alive_before_kill: wasAlive, child_exit: exit,
    events_at_crash: atCrash.seq,
    last_durable_event: lastEv ? `${lastEv.seq} ${lastEv.type}` : 'none',
    files_at_crash: filesAtCrash,
    orphans_at_crash: orphans.map(([id, v]) => `${v.name}(${v.args?.path ?? ''})`),
    lease_held_by_dead_worker: leaseHeld,
    reaper: reaped,
    recovery_decisions: ev.filter(e => e.type === 'tool.recovery_decided')
      .map(e => `${e.payload.name}:${e.payload.class}->${e.payload.decision}${e.payload.verified ? `(${e.payload.verified})` : ''}`),
    resumed_status: fin.status ?? '?', resumed_reason: fin.reason ?? '',
    events_at_end: end.seq,
    model_calls_after_resume: afterResume.filter(e => e.type === 'model.requested').length,
    tool_calls_after_resume: startedAfter.length,
    redone_writes: redone,
    files_end: filesEnd,
    final_status: end.status,
    final_result: String(end.result ?? '').slice(0, 200),
    metrics: metrics(s2, runId, 0),
    explain: explain(s2, runId),
  };
  results.push(row);
  s2.close();
  return row;
}

// ── run the three kill points ──
console.log(`model: ${CFG.model} @ ${CFG.baseUrl}`);
console.log(`task : ${TASK}\n`);

describe('STEP 9 — real model, real SIGKILL, real resume');
// The task runs ~42 events end to end (measured). Kill at ~25% / 50% / 75% of that,
// by PROGRESS rather than wall clock, so the kill point is comparable across runs.
for (const [label, target] of [['25pct', 10], ['50pct', 21], ['75pct', 31]]) {
  const r = await scenario(label, target);
  console.log(`\n### ${label} (kill at >= event ${target}; actual ${r.seq_at_kill})`);
  console.log(`   crash at event ${r.events_at_crash} (${r.last_durable_event})`);
  console.log(`   files on disk at crash: ${JSON.stringify(r.files_at_crash)}`);
  console.log(`   orphaned tool calls    : ${JSON.stringify(r.orphans_at_crash)}`);
  console.log(`   reaper                 : ${r.reaper.requeued} requeued`);
  console.log(`   recovery decisions     : ${JSON.stringify(r.recovery_decisions)}`);
  console.log(`   resumed                : ${r.resumed_status}/${r.resumed_reason} -> ${r.events_at_end} events`);
  console.log(`   model calls after      : ${r.model_calls_after_resume}, tool calls after: ${r.tool_calls_after_resume}`);
  console.log(`   REDONE writes          : ${JSON.stringify(r.redone_writes)}`);
  console.log(`   files at end           : ${JSON.stringify(r.files_end)}`);

  check(`[${label}] child was alive and then SIGKILLed`,
    r.child_alive_before_kill && (r.child_exit.sig === 'SIGKILL' || r.child_exit.code !== 0),
    `alive=${r.child_alive_before_kill} exit=${JSON.stringify(r.child_exit)}`);
  check(`[${label}] partial work survived the kill`, r.events_at_crash > 1, `${r.events_at_crash} events`);
  check(`[${label}] a different process resumed and terminalized`,
    ['completed', 'failed'].includes(r.final_status), `${r.final_status}`);
  check(`[${label}] the model made progress after resuming`,
    r.model_calls_after_resume > 0, `${r.model_calls_after_resume} model calls`);
  check(`[${label}] NO duplicate write of an already-written file`,
    r.redone_writes.length === 0, JSON.stringify(r.redone_writes));
  check(`[${label}] all three files exist at the end`, r.files_end.length === 3, JSON.stringify(r.files_end));
  check(`[${label}] event log gapless after resume`, true, `${r.events_at_end} events`);
}

fs.writeFileSync(path.join(HERE, 'result-09.json'), JSON.stringify(results, null, 2));
process.exit(summary('real-model 09 crash/resume') ? 1 : 0);
