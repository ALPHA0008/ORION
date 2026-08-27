// Execution-level fencing regression suite.
// The pre-fix observations are preserved in research/v0-hardening/fencing-race-results.md.
import path from 'node:path';
import fs from 'node:fs';
import { Store, LeaseLostError, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { ExitReason, Worker } from '../../src/agent/loop/worker.mjs';
import { reap } from '../../src/core/lease/reaper.mjs';
import { describe, check, eq, summary, tmpdir, sleep } from '../harness.mjs';

const DIR = tmpdir('fencing-regression');
const random = (n) => Math.floor(Math.random() * n);

describe('database fencing: stale tokens cannot append events');
{
  const s = new Store(path.join(DIR, 'database.db'));
  const r = uid(); s.createRun(r);
  const a = s.claim('A', { runId: r, leaseMs: 20 });
  await sleep(35);
  reap(s);
  const b = s.claim('B', { runId: r, leaseMs: 1_000 });
  check('B reclaimed the run', !!b && b.leaseToken !== a.leaseToken);
  let staleRejected = false;
  try { s.append(r, 'degraded', { subsystem: 'test' }, { leaseToken: a.leaseToken }); }
  catch (e) { staleRejected = e instanceof LeaseLostError; }
  check('stale A event append is rejected by the store', staleRejected);
  check('B can append with its live token', s.append(r, 'degraded', { subsystem: 'B' }, { leaseToken: b.leaseToken }) > 0);
  check('the stale append did not enter the log', !s.events(r).some(e => e.payload?.subsystem === 'test'));
  s.close();
}

describe('terminal fencing: expiry is ownership loss even before reaper');
{
  const s = new Store(path.join(DIR, 'terminal.db'));
  const r = uid(); s.createRun(r);
  const a = s.claim('A', { runId: r, leaseMs: 20 });
  await sleep(35);
  check('expired A cannot update status before reclaim', s.setStatus(r, 'completed', { leaseToken: a.leaseToken, releaseLease: true }) === false);
  check('run remains nonterminal until reaper/reclaimer acts', s.run(r).status === 'running');
  reap(s);
  const b = s.claim('B', { runId: r, leaseMs: 1_000 });
  check('B owns the reclaimed run', !!b && s.holdsLease(r, b.leaseToken));
  check('reclaimed A cannot terminalize', s.setStatus(r, 'completed', { leaseToken: a.leaseToken, releaseLease: true }) === false);
  check('B can terminalize its run', s.setStatus(r, 'completed', { leaseToken: b.leaseToken, releaseLease: true }) === true);
  s.close();
}

describe('stale model resume: no tool, event, or terminal effect after reclaim');
{
  const d = path.join(DIR, 'resume'); fs.mkdirSync(d, { recursive: true });
  const s = new Store(path.join(d, 'run.db'));
  const sandbox = new LocalSandbox(path.join(d, 'work'));
  const tools = makeTools(sandbox);
  const r = uid(); s.createRun(r);
  const a = s.claim('A', { runId: r, leaseMs: 20 });
  let started; const modelStarted = new Promise(resolve => { started = resolve; });
  let release; const modelRelease = new Promise(resolve => { release = resolve; });
  const model = { name: 'slow', capabilities: new Set(['tools']), async invoke() {
    started(); await modelRelease;
    return { content: 'late', finish: false, tool_calls: [{ id: 'late-write', name: 'write',
      args: { path: 'STALE.txt', content: 'stale effect' } }] };
  }};
  const worker = new Worker(s, { sandbox, model, tools, authorize: createAuthorizer(),
    workerId: 'A', leaseMs: 20, maxTurns: 1 });
  const pending = worker.run(r, a.leaseToken);
  await modelStarted;
  await sleep(35);
  reap(s);
  const b = s.claim('B', { runId: r, leaseMs: 1_000 });
  const seqAtBClaim = s.lastSeq(r);
  release();
  const result = await pending;
  const afterB = s.events(r).filter(e => e.seq > seqAtBClaim);
  check('B owns the run before A resumes', !!b && s.holdsLease(r, b.leaseToken));
  eq('A stops with lease_lost', result.reason, ExitReason.LEASE_LOST);
  check('stale A performs no real filesystem effect', !sandbox.exists('STALE.txt'));
  check('stale A appends no post-reclaim events', afterB.length === 0, JSON.stringify(afterB));
  check('run remains owned by B', s.run(r).status === 'running' && s.run(r).lease_token === b.leaseToken);
  check('no stale terminal event exists', !s.events(r).some(e => e.type === 'run.completed' || e.type === 'run.failed'));
  s.close();
}

describe('terminal event and status are one fenced transaction');
{
  const d = path.join(DIR, 'worker-terminal'); fs.mkdirSync(d, { recursive: true });
  const s = new Store(path.join(d, 'run.db'));
  const r = uid(); s.createRun(r); const a = s.claim('A', { runId: r, leaseMs: 20 });
  let b;
  const worker = new Worker(s, { model: { name: 'done', capabilities: new Set(), async invoke() {
    return { content: 'done', finish: true, tool_calls: [] };
  }}, tools: {}, authorize: createAuthorizer(), workerId: 'A', leaseMs: 20,
  hooks: { beforeAppend: (marker) => {
    if (marker === 'before:terminal' && !b) {
      s.db.prepare('UPDATE runs SET lease_expires_at=? WHERE id=?').run(Date.now() - 1, r);
      reap(s); b = s.claim('B', { runId: r, leaseMs: 1_000 });
    }
  }}});
  const result = await worker.run(r, a.leaseToken);
  eq('stale terminalization returns lease_lost', result.reason, ExitReason.LEASE_LOST);
  check('B owns the run after the terminal race', !!b && s.run(r).lease_token === b.leaseToken);
  check('terminal event was not committed by stale A', !s.events(r).some(e => e.type === 'run.completed' || e.type === 'run.failed'));
  s.close();
}

describe('100 randomized reclaim-before-resume races');
{
  const d = path.join(DIR, 'randomized'); fs.mkdirSync(d, { recursive: true });
  const s = new Store(path.join(d, 'runs.db'));
  const workspace = path.join(d, 'work'); const sandbox = new LocalSandbox(workspace);
  const tools = makeTools(sandbox); const counts = { effects: 0, events: 0, terminals: 0, ownership: 0, wrongResult: 0 };
  const iterations = 100;
  for (let i = 0; i < iterations; i++) {
    const r = uid(); s.createRun(r);
    const leaseMs = 7 + random(10); const a = s.claim(`A-${i}`, { runId: r, leaseMs });
    let started; const modelStarted = new Promise(resolve => { started = resolve; });
    let release; const gate = new Promise(resolve => { release = resolve; });
    const model = { name: `slow-${i}`, capabilities: new Set(['tools']), async invoke() {
      started();
      await gate;
      return { content: 'late', finish: false, tool_calls: [{ id: `tc-${i}`, name: 'write',
        args: { path: `STALE-${i}.txt`, content: `stale-${i}` } }] };
    }};
    const w = new Worker(s, { sandbox, model, tools, authorize: createAuthorizer(), workerId: `A-${i}`, leaseMs, maxTurns: 1 });
    const pa = w.run(r, a.leaseToken);
    await modelStarted;
    await sleep(leaseMs + random(5));
    reap(s, { reaperId: `R-${i}` });
    const b = s.claim(`B-${i}`, { runId: r, leaseMs: 1_000 });
    const seqAtBClaim = s.lastSeq(r); release();
    const result = await pa;
    if (sandbox.exists(`STALE-${i}.txt`)) counts.effects++;
    if (s.events(r).some(e => e.seq > seqAtBClaim)) counts.events++;
    if (s.events(r).some(e => e.seq > seqAtBClaim && (e.type === 'run.completed' || e.type === 'run.failed'))) counts.terminals++;
    if (!b || s.run(r).lease_token !== b.leaseToken) counts.ownership++;
    if (result.reason !== ExitReason.LEASE_LOST) counts.wrongResult++;
    // Keep each iteration reclaimable/closed without creating a second terminal event.
    if (b) s.releaseLease(r, b.leaseToken);
  }
  eq('all iterations completed with expected stale result', counts.wrongResult, 0, JSON.stringify(counts));
  eq('duplicate/stale filesystem effects', counts.effects, 0, JSON.stringify(counts));
  eq('stale post-reclaim events', counts.events, 0, JSON.stringify(counts));
  eq('conflicting stale terminal states', counts.terminals, 0, JSON.stringify(counts));
  eq('incorrect B ownership', counts.ownership, 0, JSON.stringify(counts));
  check('exactly 100 iterations executed', iterations === 100, JSON.stringify(counts));
  s.close();
}

describe('100 worst-boundary races: reclaim after final check, before external effect');
{
  const d = path.join(DIR, 'boundary'); fs.mkdirSync(d, { recursive: true });
  const s = new Store(path.join(d, 'runs.db'));
  const sandbox = new LocalSandbox(path.join(d, 'work')); const tools = makeTools(sandbox);
  const counts = { inFlightEffects: 0, postReclaimEvents: 0, staleTerminals: 0, wrongResult: 0 };
  const iterations = 100;
  for (let i = 0; i < iterations; i++) {
    const r = uid(); s.createRun(r); const a = s.claim(`A-boundary-${i}`, { runId: r, leaseMs: 1_000 });
    let b = null;
    const model = { name: `boundary-${i}`, capabilities: new Set(['tools']), async invoke() {
      return { content: 'write now', finish: false, tool_calls: [{ id: `boundary-${i}`, name: 'write',
        args: { path: `IN-FLIGHT-${i}.txt`, content: 'effect entered after reclaim' } }] };
    }};
    const w = new Worker(s, { sandbox, model, tools, authorize: createAuthorizer(), workerId: `A-boundary-${i}`, maxTurns: 1,
      hooks: { beforeAppend: (marker) => {
        if (marker === 'before:tool.effect' && !b) {
          s.db.prepare('UPDATE runs SET lease_expires_at=? WHERE id=?').run(Date.now() - 1, r);
          reap(s, { reaperId: `R-boundary-${i}` });
          b = s.claim(`B-boundary-${i}`, { runId: r, leaseMs: 1_000 });
        }
      }}});
    const result = await w.run(r, a.leaseToken);
    const seqAtBClaim = b ? s.events(r).find(e => e.type === 'run.leased' && e.payload?.worker_id === `B-boundary-${i}`)?.seq : Infinity;
    if (sandbox.exists(`IN-FLIGHT-${i}.txt`)) counts.inFlightEffects++;
    if (s.events(r).some(e => e.seq > seqAtBClaim)) counts.postReclaimEvents++;
    if (s.events(r).some(e => e.seq > seqAtBClaim && (e.type === 'run.completed' || e.type === 'run.failed'))) counts.staleTerminals++;
    if (result.reason !== ExitReason.LEASE_LOST) counts.wrongResult++;
    if (b) s.releaseLease(r, b.leaseToken);
  }
  eq('all boundary workers stop with lease_lost after the effect attempt', counts.wrongResult, 0, JSON.stringify(counts));
  eq('in-flight external effects occur at the documented boundary', counts.inFlightEffects, iterations, JSON.stringify(counts));
  eq('no authoritative event is appended after reclaim', counts.postReclaimEvents, 0, JSON.stringify(counts));
  eq('no stale terminal event is appended after reclaim', counts.staleTerminals, 0, JSON.stringify(counts));
  check('exactly 100 boundary iterations executed', iterations === 100, JSON.stringify(counts));
  s.close();
}

process.exit(summary('fencing regression') ? 1 : 0);
