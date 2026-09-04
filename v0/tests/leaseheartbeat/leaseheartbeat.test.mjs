// D1 — a run must not lose its lease while blocked inside its own model call.
//
// Measured against a local model before this fix: a realistic agent request (system prompt +
// task + tool schemas) took 28.4s against a 30s lease that is renewed only at the TOP of each
// turn. The reaper then treats the still-working run as orphaned and the worker dies as
// `lease_lost`. Self-hosted models — a documented use case — became a coin flip on prompt length.
//
// The property under test is not "the heartbeat timer fires". It is that a model call LONGER
// THAN THE LEASE completes normally, and that the heartbeat cannot resurrect a lease that was
// genuinely reclaimed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { Worker, ExitReason } from '../../src/agent/loop/worker.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const allow = () => ({ decision: 'allow' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function rig({ leaseMs, invoke }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-hb-'));
  const sandbox = new LocalSandbox(path.join(dir, 'w'));
  const store = new Store(path.join(dir, 'run.db'));
  const runId = uid('run');
  store.createRun(runId, { task: 'slow model' });
  const claim = store.claim('w', { runId, leaseMs });
  const worker = new Worker(store, {
    sandbox, store, tools: makeTools(sandbox), authorize: allow,
    model: { name: 'slow', invoke }, leaseMs, maxTurns: 3,
  });
  return { dir, store, runId, claim, worker };
}

describe('leaseheartbeat/survives-a-slow-model-call');
{
  // A 900ms lease and a 1.5s model call. Without the heartbeat the lease expires mid-call.
  const LEASE = 900, CALL = 1_500;
  const { store, runId, claim, worker } = rig({
    leaseMs: LEASE,
    invoke: async () => {
      await sleep(CALL);
      return { content: 'done', tool_calls: [], finish: true, input_tokens: 1, output_tokens: 1 };
    },
  });

  const t0 = Date.now();
  const res = await worker.run(runId, claim.leaseToken, { input: 'go' });
  const elapsed = Date.now() - t0;

  check('the model call really did outlast the lease', elapsed > LEASE, `${elapsed}ms call vs ${LEASE}ms lease`);
  check('the run did NOT die as lease_lost', res.reason !== ExitReason.LEASE_LOST, String(res.reason));
  eq('the run completed', res.status, 'completed');

  const types = store.events(runId).map(e => e.type);
  check('the lease was renewed during the call', types.filter(t => t === 'run.lease_renewed').length >= 1,
    `${types.filter(t => t === 'run.lease_renewed').length} renewals`);
  check('no lease_lost event was recorded', !types.includes('run.lease_lost'));
}

describe('leaseheartbeat/does-not-resurrect-a-reclaimed-lease');
{
  // The heartbeat must be FENCED. If another worker legitimately reclaims the run mid-call,
  // the original worker's heartbeat must fail rather than extend a lease it no longer holds —
  // otherwise the heartbeat would defeat execution fencing, which is a far worse bug than D1.
  const LEASE = 800;
  let stolen = false;
  const { store, runId, claim, worker } = rig({
    leaseMs: LEASE,
    invoke: async () => {
      await sleep(1_600);
      return { content: 'done', tool_calls: [], finish: true, input_tokens: 1, output_tokens: 1 };
    },
  });

  // Steal the run while the first worker is blocked in its model call.
  const thief = (async () => {
    await sleep(300);
    // Force expiry, then claim as a different worker.
    const c = store.claim('thief', { runId, leaseMs: 60_000, now: Date.now() + LEASE * 5 });
    stolen = !!c;
    return c;
  })();

  const res = await worker.run(runId, claim.leaseToken, { input: 'go' });
  await thief;

  check('a second worker was able to reclaim the run', stolen);
  check('the original worker did not report success after losing the lease',
    res.status !== 'completed' || res.reason !== ExitReason.MODEL_FINISHED,
    `${res.status}/${res.reason}`);
}

describe('leaseheartbeat/no-timer-leak-when-the-model-throws');
{
  // A model call that throws must still clear the heartbeat. A leaked interval would keep
  // renewing a lease for work that has stopped — the run would look alive forever.
  const { store, runId, claim, worker } = rig({
    leaseMs: 900,
    invoke: async () => { await sleep(200); const e = new Error('boom'); e.retryable = false; throw e; },
  });

  const res = await worker.run(runId, claim.leaseToken, { input: 'go' });
  eq('a thrown model call fails the run', res.status, 'failed');

  const before = store.run(runId).lease_expires_at;
  await sleep(700);   // longer than one heartbeat interval (leaseMs/3 = 300ms)
  const after = store.run(runId).lease_expires_at;
  eq('the lease is no longer being renewed after the run ended', after, before);
}

process.exit(summary('leaseheartbeat', path.join(HERE, '..', 'results-leaseheartbeat.json')) ? 1 : 0);
