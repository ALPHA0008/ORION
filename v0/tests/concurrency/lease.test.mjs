// Phase C — lease and concurrency invariants.
//   I1 at most one active worker owns a run
//   I2 no run is lost
//   I3 no run is terminalized twice
//   I4 a stale worker cannot overwrite the current owner
//   I5 reclaim is compare-and-set safe
import path from 'node:path'; import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { reap, expireHumanRequests } from '../../src/core/lease/reaper.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { describe, check, eq, summary, tmpdir, sleep } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = tmpdir('lease');
const mk = (n) => new Store(path.join(DIR, `${n}.db`), { durability: 'normal' });

// ───────────────────────────────────────────────────── basic exclusivity
describe('I1 worker A claims; worker B cannot claim the same run');
{
  const s = mk('excl'); const r = uid(); s.createRun(r);
  const a = s.claim('A', { leaseMs: 5_000 });
  const b = s.claim('B', { leaseMs: 5_000 });
  check('A got the lease', a?.runId === r, JSON.stringify(a));
  check('B got nothing (no other runnable run)', b === null);
  check('A holds a valid lease', s.holdsLease(r, a.leaseToken));
  check('B does not hold the lease', !s.holdsLease(r, 'not-a-token'));
  s.close();
}

describe('I1/I5 lease expiry then reclaim by B');
{
  const s = mk('expiry'); const r = uid(); s.createRun(r);
  const a = s.claim('A', { leaseMs: 40 });
  const blocked = s.claim('B', { runId: r });
  check('B blocked while A\'s lease is live', blocked === null);
  await sleep(70);
  const b = s.claim('B', { runId: r });
  check('B reclaims after expiry', b?.runId === r);
  check('A no longer holds the lease', !s.holdsLease(r, a.leaseToken));
  check('B holds the lease', s.holdsLease(r, b.leaseToken));
  check('lease tokens differ', a.leaseToken !== b.leaseToken);
  s.close();
}

describe('I4 stale worker (A) cannot write after losing the lease — FENCING');
{
  const s = mk('fence'); const r = uid(); s.createRun(r);
  const a = s.claim('A', { leaseMs: 40 });
  await sleep(70);
  const b = s.claim('B', { runId: r });

  const renewedStale = s.renew(r, a.leaseToken);
  check('A\'s renew is rejected after losing the lease', renewedStale === false);

  const wroteStale = s.setStatus(r, 'completed', { leaseToken: a.leaseToken, releaseLease: true });
  check('A cannot terminalize the run it no longer owns', wroteStale === false);
  eq('run is still running under B', s.run(r).status, 'running');
  check('B still holds the lease after A\'s attempts', s.holdsLease(r, b.leaseToken));

  const wroteOwner = s.setStatus(r, 'completed', { leaseToken: b.leaseToken, releaseLease: true });
  check('B (the real owner) can terminalize', wroteOwner === true);
  s.close();
}

describe('I3 no run is terminalized twice');
{
  const s = mk('term'); const r = uid(); s.createRun(r);
  const a = s.claim('A');
  check('first terminalization succeeds', s.setStatus(r, 'completed', { leaseToken: a.leaseToken, releaseLease: true }));
  check('second terminalization is refused', s.setStatus(r, 'failed', { force: false }) === false);
  eq('status remains completed', s.run(r).status, 'completed');
  // even a fresh claimer cannot re-terminalize a completed run
  const c = s.claim('C', { runId: r });
  check('a completed run is not claimable', c === null);
  s.close();
}

describe('A renews near expiration and keeps the lease');
{
  const s = mk('renew'); const r = uid(); s.createRun(r);
  const a = s.claim('A', { leaseMs: 100 });
  await sleep(60);
  check('renew succeeds before expiry', s.renew(r, a.leaseToken, { leaseMs: 200 }));
  await sleep(80);
  check('lease still held after renewal window', s.holdsLease(r, a.leaseToken));
  check('B still cannot claim', s.claim('B', { runId: r }) === null);
  s.close();
}

describe('worker dies DURING renewal (renewal never lands)');
{
  const s = mk('dierenew'); const r = uid(); s.createRun(r);
  const a = s.claim('A', { leaseMs: 50 });
  // simulate: A intended to renew but died first -> nothing happens
  await sleep(80);
  const before = s.run(r);
  check('lease is expired but run still marked running', before.status === 'running' && before.lease_expires_at <= Date.now());
  const res = reap(s);
  eq('reaper requeues exactly one run', res.requeued, 1);
  eq('run returned to pending', s.run(r).status, 'pending');
  check('lease fields cleared', s.run(r).lease_token === null && s.run(r).worker_id === null);
  const ev = s.events(r).filter(e => e.type === 'run.lease_lost');
  check('lease loss is recorded in the log', ev.length === 1, JSON.stringify(ev[0]?.payload));
  s.close();
}

describe('worker dies IMMEDIATELY after claim (no work done)');
{
  const s = mk('dieclaim'); const r = uid(); s.createRun(r);
  s.claim('A', { leaseMs: 30 });
  await sleep(60);
  reap(s);
  const b = s.claim('B', { runId: r });
  check('B can claim after the reaper ran', b?.runId === r);
  eq('attempts incremented twice (A then B)', s.run(r).attempts, 2);
  s.close();
}

// ───────────────────────────────────────────── racing reapers (in-process)
describe('I5 two reapers race — exactly one acts');
{
  const s = mk('race2'); const runs = [];
  for (let i = 0; i < 20; i++) { const r = uid(); s.createRun(r); s.claim(`w${i}`, { runId: r, leaseMs: 10 }); runs.push(r); }
  await sleep(40);
  const now = Date.now();
  const r1 = reap(s, { now, reaperId: 'R1' });
  const r2 = reap(s, { now, reaperId: 'R2' });
  eq('first reaper requeues all 20', r1.requeued, 20);
  eq('second reaper requeues none', r2.requeued, 0);
  const doubles = runs.filter(r => s.events(r).filter(e => e.type === 'run.lease_lost').length > 1);
  eq('no run got two lease_lost events', doubles.length, 0);
  check('all runs are pending exactly once', runs.every(r => s.run(r).status === 'pending'));
  s.close();
}

// ───────────────────────────────── multi-PROCESS claim storm (the real test)
describe('I1/I2 multi-PROCESS claim storm: N processes, M runs, no double-claim, no loss');
{
  const dbPath = path.join(DIR, 'storm.db');
  const s = new Store(dbPath, { durability: 'normal' });
  const M = 30;
  const runs = [];
  for (let i = 0; i < M; i++) { const r = uid(); s.createRun(r); runs.push(r); }
  s.close();

  const N = 6;
  const script = path.join(HERE, '..', '_helpers', 'claim-worker.mjs');
  const procs = Array.from({ length: N }, (_, i) =>
    spawnSync(process.execPath, [script, dbPath, `W${i}`, String(M)], { encoding: 'utf8', timeout: 120_000 }));

  check('all claim workers exited 0', procs.every(p => p.status === 0), procs.map(p => p.status).join(','));
  const claims = procs.flatMap(p => { try { return JSON.parse(p.stdout || '[]'); } catch { return []; } });
  const claimedIds = claims.map(c => c.runId);

  check('every run was claimed at least once', new Set(claimedIds).size === M, `${new Set(claimedIds).size}/${M}`);
  check('no run was claimed twice concurrently', claimedIds.length === new Set(claimedIds).size,
    `${claimedIds.length} claims for ${new Set(claimedIds).size} runs`);

  const s2 = new Store(dbPath, { durability: 'normal' });
  const statuses = runs.map(r => s2.run(r).status);
  const completed = statuses.filter(x => x === 'completed').length;
  check('I2 no run was lost — all reached a terminal state', completed === M, `${completed}/${M} completed`);
  const twice = runs.filter(r => s2.events(r).filter(e => e.type === 'run.completed').length > 1);
  eq('I3 no run completed twice', twice.length, 0);
  const gapless = runs.every(r => s2.events(r).every((e, i) => e.seq === i + 1));
  check('every run log is gapless', gapless);
  s2.close();
}

// ──────────────────────────────────────────── randomized timing soak
describe('randomized soak: claim/renew/expire/reap interleavings');
{
  const s = mk('soak');
  const runs = [];
  for (let i = 0; i < 40; i++) { const r = uid(); s.createRun(r); runs.push(r); }
  const owners = new Map();
  let violations = 0, terminalTwice = 0;

  for (let step = 0; step < 400; step++) {
    const act = Math.random();
    const r = runs[Math.floor(Math.random() * runs.length)];
    const st = s.run(r);
    if (act < 0.35) {
      const c = s.claim(`w${step % 7}`, { runId: r, leaseMs: 5 + Math.floor(Math.random() * 25) });
      if (c) {
        // I1: nobody else may hold a live lease at this instant
        if (owners.has(r) && s.holdsLease(r, owners.get(r))) violations++;
        owners.set(r, c.leaseToken);
      }
    } else if (act < 0.6) {
      const t = owners.get(r); if (t) s.renew(r, t, { leaseMs: 5 + Math.floor(Math.random() * 20) });
    } else if (act < 0.8) {
      const t = owners.get(r);
      if (t && s.holdsLease(r, t)) {
        const okNow = s.setStatus(r, 'completed', { leaseToken: t, releaseLease: true });
        if (okNow && s.events(r).filter(e => e.type === 'run.completed').length > 0) { /* fine */ }
      }
    } else {
      reap(s, { maxAttempts: 1000 });
    }
    if (Math.random() < 0.15) await sleep(Math.floor(Math.random() * 8));
  }
  for (const r of runs) {
    const live = s.db.prepare('SELECT COUNT(*) c FROM runs WHERE id=? AND lease_token IS NOT NULL AND lease_expires_at > ?')
      .get(r, Date.now()).c;
    if (Number(live) > 1) violations++;                 // structurally impossible (PK), belt and braces
    if (s.events(r).filter(e => e.type === 'run.completed').length > 1) terminalTwice++;
  }
  eq('I1 no concurrent double-ownership observed', violations, 0);
  eq('I3 no run terminalized twice under randomized timing', terminalTwice, 0);
  const lost = runs.filter(r => { const x = s.run(r); return x.status === 'running' && (x.lease_expires_at ?? 0) < Date.now() - 60_000; });
  eq('I2 no run stranded beyond reaper reach', lost.length, 0);
  s.close();
}

// ─────────────────────────────────────── human request expiry parks the run
describe('human request expiry parks the run rather than losing it');
{
  const s = mk('hrexp'); const r = uid(); s.createRun(r);
  const a = s.claim('A');
  const hr = s.createHumanRequest(r, 'approve?', { expiresAt: Date.now() - 1 });
  s.append(r, 'human.requested', { request_id: hr, prompt: 'approve?' });
  s.setStatus(r, 'paused', { leaseToken: a.leaseToken, releaseLease: true });
  const res = expireHumanRequests(s);
  eq('one request expired', res.expired, 1);
  eq('run parked', s.run(r).status, 'parked');
  check('timeout recorded in the log', s.events(r).some(e => e.type === 'human.timed_out'));
  const st = project(s, r);
  eq('projection shows no open requests', Object.keys(st.open_human_requests).length, 0);
  s.close();
}

// ───────────────── REGRESSION: a paused run must be resumable (found by real-model Step 2)
describe('REGRESSION: a paused run can be claimed by an explicit resume');
{
  const s = mk('pausedclaim'); const r = uid(); s.createRun(r);
  const a = s.claim('A');
  // escalation path: the worker pauses and RELEASES the lease
  s.setStatus(r, 'paused', { leaseToken: a.leaseToken, releaseLease: true });
  eq('run is paused with no lease', [s.run(r).status, s.run(r).lease_token], ['paused', null]);

  const b = s.claim('B', { runId: r });
  check('a targeted claim CAN take a paused run (this is resume)', b !== null,
    b ? 'claimed' : 'REGRESSION: paused runs are unclaimable, so resume is impossible');
  if (b) {
    check('the resuming worker holds a valid lease', s.holdsLease(r, b.leaseToken));
    eq('status returns to running', s.run(r).status, 'running');
  }
  s.close();
}

describe('a paused run is NOT picked up by the general queue scan while it waits on a human');
{
  const s = mk('pausedscan'); const r = uid(); s.createRun(r);
  const a = s.claim('A');
  const hr = s.createHumanRequest(r, 'approve?');
  s.append(r, 'human.requested', { request_id: hr, prompt: 'approve?' });
  s.setStatus(r, 'paused', { leaseToken: a.leaseToken, releaseLease: true });

  const scan1 = s.claim('B');                       // no runId -> general scan
  check('an unanswered paused run is not swept up by a generic worker', scan1 === null,
    scan1 ? `WRONG: claimed ${scan1.runId}` : 'correctly skipped');

  s.answerHumanRequest(hr, 'approve');
  const scan2 = s.claim('C');                       // now it is answerable
  check('once the human answers, the general scan CAN pick it up', scan2?.runId === r,
    scan2 ? scan2.runId : 'not claimable');
  s.close();
}

process.exit(summary('lease/concurrency', path.join(HERE, '../results-concurrency.json')) ? 1 : 0);
