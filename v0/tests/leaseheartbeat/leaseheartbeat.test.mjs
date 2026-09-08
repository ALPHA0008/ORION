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

// ---------------------------------------------------------------- W5 X2 / X3
//
// D1 (above) covered the MODEL path only. The tool path had the same defect and worse: it was
// synchronous, so `setInterval` could not fire even in principle while a tool ran. X1 made the
// sandbox asynchronous, X2 put the tool call under the same heartbeat, and X3 fixed the
// human-approval resume path, which was not even awaiting the tool it invoked.

// A rig whose model asks for exactly one tool call, then finishes.
function toolRig({ leaseMs, run, effects = 'ReadOnly', authorize = allow }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-hb-tool-'));
  const sandbox = new LocalSandbox(path.join(dir, 'w'));
  const store = new Store(path.join(dir, 'run.db'));
  const runId = uid('run');
  store.createRun(runId, { task: 'slow tool' });
  const claim = store.claim('w', { runId, leaseMs });
  const tools = {
    slow: {
      description: 'a deliberately slow tool',
      schema: { type: 'object', required: [], properties: {} },
      effects,
      recovery: () => ({ class: 'READ_ONLY' }),
      run,
    },
  };
  let asked = false;
  const worker = new Worker(store, {
    sandbox, store, tools, authorize,
    model: {
      name: 'stub',
      invoke: async () => {
        if (asked) return { content: 'done', tool_calls: [], finish: true, input_tokens: 1, output_tokens: 1 };
        asked = true;
        return { content: '', tool_calls: [{ id: 'tc1', name: 'slow', args: {} }],
                 finish: false, input_tokens: 1, output_tokens: 1 };
      },
    },
    leaseMs, maxTurns: 4,
  });
  return { dir, store, runId, claim, worker };
}

describe('leaseheartbeat/x2-survives-a-slow-tool-call');
{
  // ACCEPTANCE 3 / experiment E2: a tool call longer than the lease must not lose the lease.
  const LEASE = 900, CALL = 1_500;
  const { store, runId, claim, worker } = toolRig({
    leaseMs: LEASE,
    run: async () => { await sleep(CALL); return 'tool-output'; },
  });

  const t0 = Date.now();
  const res = await worker.run(runId, claim.leaseToken, { input: 'go' });
  const elapsed = Date.now() - t0;

  check('the tool call really did outlast the lease', elapsed > LEASE, `${elapsed}ms run vs ${LEASE}ms lease`);
  check('the run did NOT die as lease_lost', res.reason !== ExitReason.LEASE_LOST, String(res.reason));

  const events = store.events(runId);
  const types = events.map(e => e.type);
  check('the tool completed and was recorded', types.includes('tool.succeeded'));
  eq('the recorded result is the tool output, not a Promise',
    events.find(e => e.type === 'tool.succeeded')?.payload?.result, 'tool-output');
  check('the lease was renewed while the TOOL ran', types.filter(t => t === 'run.lease_renewed').length >= 1,
    `${types.filter(t => t === 'run.lease_renewed').length} renewals`);
  check('no lease_lost event was recorded', !types.includes('run.lease_lost'));
}

describe('leaseheartbeat/x2-tool-heartbeat-is-fenced');
{
  // Same fencing property as the model path: a reclaimed run must not be resurrected by the
  // tool heartbeat. This is the guard that keeps X2 from defeating execution fencing.
  const LEASE = 800;
  let stolen = false;
  const { store, runId, claim, worker } = toolRig({
    leaseMs: LEASE,
    run: async () => { await sleep(1_600); return 'late'; },
  });

  const thief = (async () => {
    await sleep(300);
    const c = store.claim('thief', { runId, leaseMs: 60_000, now: Date.now() + LEASE * 5 });
    stolen = !!c;
    return c;
  })();

  const res = await worker.run(runId, claim.leaseToken, { input: 'go' });
  await thief;

  check('a second worker reclaimed the run mid-tool-call', stolen);
  check('the original worker did not report a clean completion',
    res.status !== 'completed' || res.reason !== ExitReason.MODEL_FINISHED, `${res.status}/${res.reason}`);
}

describe('leaseheartbeat/x3-async-tool-result-on-the-resume-path');
{
  // X3: `#consumeHumanAnswers` invoked the tool WITHOUT awaiting it. The recorded result was
  // `String(Promise)` — "[object Promise]" — so an approved tool call was logged as having
  // succeeded with garbage. The assertion is the awaited VALUE, which is the whole defect.
  const LEASE = 5_000;
  const { store, runId, claim, worker } = toolRig({
    leaseMs: LEASE,
    effects: 'Mutating',
    run: async () => { await sleep(50); return 'awaited-value'; },
    authorize: () => ({ decision: 'escalate', prompt: 'may I?' }),
  });

  const first = await worker.run(runId, claim.leaseToken, { input: 'go' });
  eq('the run paused for a human', first.reason, ExitReason.AWAITING_HUMAN);

  const pending = store.humanRequests(runId, 'pending');
  eq('exactly one request is open', pending.length, 1);
  store.answerHumanRequest(pending[0].id, 'approve');

  const claim2 = store.claim('w2', { runId, leaseMs: LEASE, now: Date.now() + LEASE * 3 });
  await worker.run(runId, claim2.leaseToken, { input: 'go' });

  const succeeded = store.events(runId).filter(e => e.type === 'tool.succeeded');
  check('the approved tool ran on the resume path', succeeded.length >= 1);
  const result = succeeded.at(-1)?.payload?.result;
  eq('the recorded result is the AWAITED value', result, 'awaited-value');
  check('the result is not a stringified Promise', result !== '[object Promise]', String(result));
}

describe('leaseheartbeat/x3-async-tool-rejection-becomes-tool-failed');
{
  // The other half of the missing await: a rejected Promise escaped the try/catch entirely,
  // surfacing as an unhandled rejection instead of a recorded `tool.failed`.
  const LEASE = 5_000;
  const { store, runId, claim, worker } = toolRig({
    leaseMs: LEASE,
    effects: 'Mutating',
    run: async () => { await sleep(50); throw new Error('async boom'); },
    authorize: () => ({ decision: 'escalate', prompt: 'may I?' }),
  });

  await worker.run(runId, claim.leaseToken, { input: 'go' });
  const pending = store.humanRequests(runId, 'pending');
  store.answerHumanRequest(pending[0].id, 'approve');

  const claim2 = store.claim('w2', { runId, leaseMs: LEASE, now: Date.now() + LEASE * 3 });
  await worker.run(runId, claim2.leaseToken, { input: 'go' });

  const failed = store.events(runId).filter(e => e.type === 'tool.failed');
  check('an async rejection on the resume path is recorded as tool.failed', failed.length >= 1);
  check('the recorded error is the real one', String(failed.at(-1)?.payload?.error).includes('async boom'),
    String(failed.at(-1)?.payload?.error));
}

// ---------------------------------------------------------------- W5 X4
//
// `tool.timed_out` is one of the 39 frozen v4 types and has always been handled by the
// projection, the replay filter and the explain renderer — but nothing ever emitted it, so a
// timeout was indistinguishable from any other tool failure in the log. That distinction is
// not cosmetic: a timeout means the effect MAY still have happened (the child was killed, not
// proven inert), which is exactly the case recovery needs to tell apart.

describe('x4/a tool timeout is recorded as tool.timed_out');
{
  const { store, runId, claim, worker } = toolRig({
    leaseMs: 5_000,
    // The sandbox's own taxonomy: `kind: 'timeout'` is what LocalSandbox attaches when the
    // child is SIGTERM'd. The tool here raises the same shape so the assertion is about the
    // worker's routing, not about re-testing the sandbox (security/security already does that).
    run: async () => {
      await sleep(20);
      const e = new Error('command timed out after 15000ms and was killed');
      e.kind = 'timeout'; e.exitCode = null;
      throw e;
    },
  });

  await worker.run(runId, claim.leaseToken, { input: 'go' });
  const types = store.events(runId).map(e => e.type);

  check('the timeout is recorded as tool.timed_out', types.includes('tool.timed_out'));
  check('it is NOT recorded as a generic tool.failed', !types.includes('tool.failed'));

  // A timed-out call must be RESOLVED, not left in flight, or the run would stall waiting for
  // a result that will never come. `tool.timed_out` was already a terminal tool event in the
  // projection before this wave; what X4 changes is that the event now actually gets written.
  const started = store.events(runId).filter(e => e.type === 'tool.started').length;
  const terminal = store.events(runId).filter(e =>
    ['tool.succeeded', 'tool.failed', 'tool.timed_out', 'tool.denied'].includes(e.type)).length;
  eq('every started tool call reached a terminal event', terminal, started);
}

describe('x4/an ordinary failure is still tool.failed');
{
  // The complement: X4 must not reclassify every failure as a timeout.
  const { store, runId, claim, worker } = toolRig({
    leaseMs: 5_000,
    run: async () => { await sleep(20); const e = new Error('exit 1'); e.kind = 'nonzero_exit'; throw e; },
  });

  await worker.run(runId, claim.leaseToken, { input: 'go' });
  const types = store.events(runId).map(e => e.type);
  check('a non-timeout failure is still tool.failed', types.includes('tool.failed'));
  check('it is not mislabelled as a timeout', !types.includes('tool.timed_out'));
}

// ---------------------------------------------------------------- W5 X5
//
// Cancellation. The requirement is "a clean stop of an in-flight run with no orphan effect",
// which is a stronger claim than "the loop exits": an effect that happened but was never
// recorded is precisely the orphan ADR-002/003 recovery exists to clean up, so a cancel must
// never create one. NO NEW EVENT TYPE was needed — `run.parked` is already the frozen v4
// terminal status for "stopped, not finished, and here is why".

describe('x5/cancelling before the first turn parks the run');
{
  const { store, runId, claim, worker } = toolRig({
    leaseMs: 5_000,
    run: async () => 'should never run',
  });
  const ac = new AbortController();
  ac.abort();

  const res = await worker.run(runId, claim.leaseToken, { input: 'go', signal: ac.signal });

  eq('the run is parked, not failed', res.status, 'parked');
  eq('the reason is cancellation', res.reason, ExitReason.CANCELLED);
  const types = store.events(runId).map(e => e.type);
  check('a run.parked event was recorded', types.includes('run.parked'));
  check('it is NOT recorded as run.failed', !types.includes('run.failed'));
  check('no tool ever started', !types.includes('tool.started'));
  eq('the store agrees the run is parked', store.run(runId).status, 'parked');
  check('the lease was released', store.run(runId).lease_token === null);
}

describe('x5/a cancel mid-run does not orphan the tool call it interrupts');
{
  // The load-bearing case. Two tool calls are requested; the signal aborts DURING the first.
  // The first must still reach a terminal event (its effect already happened), the second must
  // never start, and the run must park.
  const LEASE = 5_000;
  const ac = new AbortController();
  let calls = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-hb-x5-'));
  const sandbox = new LocalSandbox(path.join(dir, 'w'));
  const store = new Store(path.join(dir, 'run.db'));
  const runId = uid('run');
  store.createRun(runId, { task: 'cancel mid-run' });
  const claim = store.claim('w', { runId, leaseMs: LEASE });
  let asked = false;
  const worker = new Worker(store, {
    sandbox, store, authorize: allow, leaseMs: LEASE, maxTurns: 4,
    tools: {
      slow: {
        description: 'slow', schema: { type: 'object', required: [], properties: {} },
        effects: 'Mutating', recovery: () => ({ class: 'READ_ONLY' }),
        run: async () => {
          calls += 1;
          // Abort while the FIRST call is genuinely in flight.
          if (calls === 1) { await sleep(60); ac.abort(); }
          return `call-${calls}`;
        },
      },
    },
    model: {
      name: 'stub',
      invoke: async () => {
        if (asked) return { content: 'done', tool_calls: [], finish: true, input_tokens: 1, output_tokens: 1 };
        asked = true;
        return { content: '', finish: false, input_tokens: 1, output_tokens: 1,
                 tool_calls: [{ id: 'tc1', name: 'slow', args: {} }, { id: 'tc2', name: 'slow', args: {} }] };
      },
    },
  });

  const res = await worker.run(runId, claim.leaseToken, { input: 'go', signal: ac.signal });

  eq('the run parked', res.status, 'parked');
  eq('the reason is cancellation', res.reason, ExitReason.CANCELLED);
  eq('only the first tool call ran', calls, 1);

  const events = store.events(runId);
  const started = events.filter(e => e.type === 'tool.started');
  const terminal = events.filter(e =>
    ['tool.succeeded', 'tool.failed', 'tool.timed_out', 'tool.denied'].includes(e.type));
  eq('exactly one tool call started', started.length, 1);
  eq('NO ORPHAN: every started call reached a terminal event', terminal.length, started.length);
  eq('the interrupted call recorded its real result',
    events.find(e => e.type === 'tool.succeeded')?.payload?.result, 'call-1');

  // Ordering matters as much as presence: the park must come AFTER the tool resolved, or the
  // log would claim the run stopped while an effect was still outstanding.
  const succeededSeq = events.find(e => e.type === 'tool.succeeded').seq;
  const parkedSeq = events.find(e => e.type === 'run.parked').seq;
  check('the park is recorded after the tool resolved', parkedSeq > succeededSeq,
    `parked@${parkedSeq} vs succeeded@${succeededSeq}`);
}

describe('x5/an uncancelled run is unaffected');
{
  // A signal that never aborts — and no signal at all — must behave exactly as before.
  const ac = new AbortController();
  const { store, runId, claim, worker } = toolRig({ leaseMs: 5_000, run: async () => 'fine' });
  const res = await worker.run(runId, claim.leaseToken, { input: 'go', signal: ac.signal });
  eq('the run completed normally with a live signal', res.status, 'completed');
  check('no park event was recorded', !store.events(runId).map(e => e.type).includes('run.parked'));
}

process.exit(summary('leaseheartbeat', path.join(HERE, '..', 'results-leaseheartbeat.json')) ? 1 : 0);
