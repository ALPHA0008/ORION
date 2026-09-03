// Phase J — replay vs fork vs rerun, under a genuinely NONDETERMINISTIC provider.
// The provider appends a random nonce, so identical input produces different output.
// This is what makes the distinction testable rather than asserted.
import path from 'node:path'; import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox, attachCheckpoints } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { replay, fork, rerun, verifyProjectionEquivalence } from '../../src/core/replay/index.mjs';
import { createOpenAICompatModel } from '../../src/agent/model/index.mjs';
import { startFakeProvider, projectScript } from '../_helpers/fake-provider.mjs';
import { describe, check, eq, summary, tmpdir } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = tmpdir('replay');
const mk = (tag) => {
  const d = path.join(DIR, tag); fs.mkdirSync(d, { recursive: true });
  const store = new Store(path.join(d, 'h.db'), { durability: 'normal' });
  const sandbox = attachCheckpoints(new LocalSandbox(path.join(d, 'work')), path.join(d, 'shadow.git'));
  return { store, sandbox, tools: makeTools(sandbox), dir: d };
};

// ── one original run against a NONDETERMINISTIC provider ──
const prov = await startFakeProvider({ script: projectScript(), nondeterministic: true });
const model = createOpenAICompatModel({ baseUrl: prov.url, model: 'fake-1',
  pricing: { in_per_mtok: 1, out_per_mtok: 3 }, maxRetries: 2 });

const { store, sandbox, tools, dir } = mk('original');
const runId = uid(); store.createRun(runId, { task: 'build the mini project' });
const c = store.claim('w1', { runId });
const wsCheckpoints = new Map();   // event seq -> workspace ref
const w = new Worker(store, { sandbox, model, tools, authorize: createAuthorizer(), workerId: 'w1', maxTurns: 15,
  hooks: { beforeAppend: (marker) => {
    if (marker === 'after:tool.authorized') wsCheckpoints.set(store.lastSeq(runId), sandbox.snapshot(`seq${store.lastSeq(runId)}`));
  } } });
const original = await w.run(runId, c.leaseToken, { input: 'build the mini project' });

describe('setup: original run against a nondeterministic provider');
eq('original completed', original.status, 'completed');
check('provider was really called over HTTP', prov.callCount >= 4, `${prov.callCount} HTTP calls`);
const origState = project(store, runId, { useSnapshot: false });
const origContent = origState.recent_messages.filter(m => m.role === 'assistant').map(m => m.content);
check('provider output carries a nonce (is nondeterministic)',
  origContent.some(t => /nonce [0-9a-f]{8}/.test(t)), origContent.slice(-1)[0]?.slice(0, 80));

// ═════════════════════════════════════════════════════ REPLAY
describe('REPLAY — reconstruct history, make NO model calls');
{
  const before = prov.callCount;
  const r1 = replay(store, runId);
  const r2 = replay(store, runId);
  const r3 = replay(store, runId);
  eq('kind is replay', r1.kind, 'replay');
  eq('replay made ZERO model calls', prov.callCount - before, 0);
  eq('replay reports model_calls_made = 0', r1.model_calls_made, 0);
  check('replay is byte-identical across repeats',
    JSON.stringify(r1.state) === JSON.stringify(r2.state) &&
    JSON.stringify(r2.state) === JSON.stringify(r3.state));
  check('replay reproduces the ORIGINAL nondeterministic content exactly',
    JSON.stringify(r1.state.recent_messages) === JSON.stringify(origState.recent_messages));
  check('replay is flagged deterministic', r1.deterministic === true);
  const eqv = verifyProjectionEquivalence(store, runId);
  check('snapshot-assisted projection == full replay', eqv.equal);
}

describe('REPLAY at a point in time');
{
  const last = store.lastSeq(runId);
  const mid = Math.floor(last / 2);
  const r = replay(store, runId, { at: mid });
  eq('replay stops at the requested seq', r.state.seq, mid);
  check('mid-run state is not terminal', r.state.status !== 'completed', r.state.status);
  check('mid-run has fewer messages than the end',
    r.state.message_count < origState.message_count, `${r.state.message_count} < ${origState.message_count}`);
  const again = replay(store, runId, { at: mid });
  check('point-in-time replay is repeatable', JSON.stringify(r.state) === JSON.stringify(again.state));
}

// ═════════════════════════════════════════════════════ FORK
describe('FORK — new run seeded with history, NEW future');
{
  const forkAt = store.events(runId).find(e => e.type === 'tool.started' && e.payload?.name === 'edit')?.seq;
  check('found a fork point (before the edit)', typeof forkAt === 'number', String(forkAt));
  const before = prov.callCount;
  const f = fork(store, runId, forkAt - 1);
  eq('kind is fork', f.kind, 'fork');
  eq('fork itself makes no model calls', prov.callCount - before, 0);

  const frun = store.run(f.run_id);
  eq('provenance: parent recorded', frun.parent_run_id, runId);
  eq('provenance: fork point recorded', frun.forked_from_seq, forkAt - 1);
  const fstate = project(store, f.run_id, { useSnapshot: false });
  check('inherited history matches the source up to the fork point',
    JSON.stringify(replay(store, runId, { at: forkAt - 1 }).state.recent_messages) ===
    JSON.stringify(project(store, f.run_id, { upToSeq: forkAt - 1, useSnapshot: false }).recent_messages));
  check('fork has a visible seam event',
    store.events(f.run_id).some(e => e.type === 'run.resumed' && e.payload?.seam === true));
  eq('source run is unchanged', project(store, runId, { useSnapshot: false }).seq, origState.seq);

  // continue the fork with a DIFFERENT policy -> genuine divergence
  // FINDING (Phase J): forking a RUN forks the log, not the world. To fork coherently we
  // must rewind the workspace to the fork point using a workspace checkpoint.
  const fdir = path.join(DIR, 'forkwork'); fs.mkdirSync(fdir, { recursive: true });
  const fsb = attachCheckpoints(new LocalSandbox(fdir), path.join(DIR, 'forkshadow.git'));
  for (const fn of ['a.txt', 'b.txt']) if (sandbox.exists(fn)) fsb.write(fn, sandbox.read(fn));
  // pick the newest workspace checkpoint at or before the fork point and restore into the fork
  const wsRef = [...wsCheckpoints.entries()].filter(([seq]) => seq <= forkAt - 1).sort((a, b) => b[0] - a[0])[0];
  check('a workspace checkpoint exists at/before the fork point', !!wsRef, wsRef ? `seq ${wsRef[0]}` : 'none');
  if (wsRef) {
    // materialise the original workspace at that checkpoint, then copy it into the fork
    const cur = sandbox.snapshot('pre-restore');
    sandbox.restore(wsRef[1]);
    for (const fn of ['a.txt', 'b.txt']) if (sandbox.exists(fn)) fsb.write(fn, sandbox.read(fn));
    sandbox.restore(cur);                       // put the original back exactly as it was
  }
  const fw = new Worker(store, { sandbox: fsb, model, tools: makeTools(fsb),
    authorize: createAuthorizer({ denyTools: ['edit'] }), workerId: 'w2', maxTurns: 12 });
  const fc = store.claim('w2', { runId: f.run_id });
  const fres = await fw.run(f.run_id, fc.leaseToken, {});

  check('fork DID make new model calls', prov.callCount > before, `${prov.callCount - before} new calls`);
  check('fork reached a terminal state', ['completed', 'failed'].includes(fres.status), fres.status);
  check('fork diverged from the original',
    JSON.stringify(project(store, f.run_id).recent_messages) !==
    JSON.stringify(project(store, runId).recent_messages));
  check('divergence is visible in the fork log', store.events(f.run_id).some(e => e.type === 'tool.denied'));
  check('original filesystem untouched by the fork', sandbox.read('b.txt').includes('VALUE=20'));
  check('fork filesystem took the other path', !fsb.read('b.txt').includes('VALUE=20'),
    JSON.stringify(fsb.read('b.txt').trim()));
  check('original run STILL replays identically after being forked',
    JSON.stringify(replay(store, runId).state) === JSON.stringify(origState));
}

// ═════════════════════════════════════════════════════ RERUN
describe('RERUN — fresh execution, shares nothing but the task');
{
  const before = prov.callCount;
  const rr = rerun(store, runId);
  eq('kind is rerun', rr.kind, 'rerun');
  eq('rerun inherits the task text', rr.task, 'build the mini project');
  const rstate = project(store, rr.run_id, { useSnapshot: false });
  eq('rerun starts with no inherited history', rstate.message_count, 0);
  eq('rerun has no parent link', store.run(rr.run_id).parent_run_id, null);

  const rdir = path.join(DIR, 'rerunwork'); fs.mkdirSync(rdir, { recursive: true });
  const rsb = new LocalSandbox(rdir);
  const rw = new Worker(store, { sandbox: rsb, model, tools: makeTools(rsb),
    authorize: createAuthorizer(), workerId: 'w3', maxTurns: 15 });
  const rc = store.claim('w3', { runId: rr.run_id });
  const rres = await rw.run(rr.run_id, rc.leaseToken, { input: store.run(rr.run_id).task });

  check('rerun made new model calls', prov.callCount > before, `${prov.callCount - before}`);
  eq('rerun completed', rres.status, 'completed');
  const rfinal = project(store, rr.run_id);
  check('rerun content DIFFERS from the original (nondeterminism is real)',
    JSON.stringify(rfinal.recent_messages) !== JSON.stringify(origState.recent_messages));
  check('but rerun reached the same WORLD state', rsb.read('b.txt') === sandbox.read('b.txt'),
    `${JSON.stringify(rsb.read('b.txt'))} vs ${JSON.stringify(sandbox.read('b.txt'))}`);
}

// ═══════════════════════════════ the distinction, stated as a test
describe('the three operations are genuinely different');
{
  const callsBefore = prov.callCount;
  const rep = replay(store, runId);
  const afterReplay = prov.callCount;
  eq('replay: 0 model calls', afterReplay - callsBefore, 0);
  check('replay: reproduces historical output exactly',
    JSON.stringify(rep.state.recent_messages) === JSON.stringify(origState.recent_messages));

  // A "replay" that called the model would NOT reproduce this content — proven by rerun above.
  check('a fresh execution does NOT reproduce it — so replay ≠ rerun is a real distinction', true,
    'verified by the RERUN block: same task, same tools, different content');
}

describe('guard rails');
{
  check('fork out of range is rejected', (() => {
    try { fork(store, runId, 99999); return false; } catch (e) { return /out of range/.test(e.message); }
  })());
  check('fork at 0 is rejected', (() => {
    try { fork(store, runId, 0); return false; } catch { return true; }
  })());
  check('replay of an unknown run yields empty state', replay(store, 'nope').state.seq === 0);
}

await prov.close();
store.close();
process.exit(summary('replay semantics', path.join(HERE, '../results-replay.json')) ? 1 : 0);
