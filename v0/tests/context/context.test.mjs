// WAVE 3 — context maturity + artifacts.
//
// Two claims, both architectural rather than cosmetic:
//
//   COMPACTION is a projection, not a mutation. It rewrites only the OUTBOUND provider array.
//   A long run that compacts must still replay identically, resume identically, and fold the
//   same plan — because the durable history was never touched. If compaction ever leaked into
//   the log, replay would diverge and every guarantee built on it would go with it.
//
//   ARTIFACTS are references, not copies. An oversized tool result gains identity, a sha256 and
//   a provenance link back to the event holding its bytes. The test that matters is that a
//   compaction placeholder still POINTS at that evidence — an orphaned artifact would mean
//   compaction had quietly destroyed addressability.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { replay } from '../../src/core/replay/index.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { projectPlan, planSatisfied } from '../../src/core/projection/plan.mjs';
import { compactMessages } from '../../src/core/projection/compact.mjs';
import {
  projectArtifacts, resolveArtifact, describeArtifact, artifactId, sha256,
  qualifiesAsArtifact, ARTIFACT_MIN_BYTES,
} from '../../src/core/projection/artifacts.mjs';
import { EVENT_TYPES, EVENT_CONTRACT_VERSION } from '../../src/core/event/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const call = (name, args) => ({ content: '', finish: false,
  tool_calls: [{ id: 'tc_' + Math.random().toString(16).slice(2, 10), name, args }] });

/**
 * A hand-built assistant message in the OPENAI WIRE SHAPE.
 * compactMessages reads `tc.function.name`, because that is what the worker actually sends —
 * building these with the internal {name, args} shape silently yields an empty tool name and
 * makes name-dependent rules (like the verify-verdict rule) look broken when they are not.
 */
const wireCall = (id, name, args) => ({ role: 'assistant',
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const finish = (content = 'done') => ({ content, tool_calls: [], finish: true });
const BIG = (tag) => (tag + ' ').repeat(4_000);          // comfortably over ARTIFACT_MIN_BYTES

function rig({ responses, dir = null, extra = {} }) {
  const d = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
  const sandbox = new LocalSandbox(path.join(d, 'w'));
  const store = new Store(path.join(d, 'run.db'));
  let i = 0;
  const model = { name: 'scripted', async invoke() {
    const r = responses[Math.min(i++, responses.length - 1)];
    return { input_tokens: 1, output_tokens: 1, ...(typeof r === 'function' ? r(sandbox) : r) };
  } };
  return { d, sandbox, store,
    make: () => new Worker(store, {
      sandbox, model, tools: makeTools(sandbox),
      authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
      maxTurns: 40, ...extra,
    }) };
}

describe('context/contract-version');
{
  check('the contract is at or beyond v3', EVENT_CONTRACT_VERSION >= 3, `v${EVENT_CONTRACT_VERSION}`);
  check('artifact.created is in the frozen vocabulary', EVENT_TYPES.includes('artifact.created'));
  check('the set is still frozen', Object.isFrozen(EVENT_TYPES));
}

describe('context/artifact-identity-and-provenance');
{
  const content = BIG('alpha');
  const a = describeArtifact({ content, tool: 'read', target: 'big.txt', sourceSeq: 37 });

  check('an oversized result qualifies', qualifiesAsArtifact(content));
  check('a small result does not', !qualifiesAsArtifact('tiny'));
  eq('the id is content-addressed', a.artifact_id, artifactId(content));
  eq('the same bytes yield the same id anywhere', artifactId(content), artifactId(String(content)));
  check('different bytes yield a different id', artifactId(content) !== artifactId(content + 'x'));
  eq('the sha256 is the content hash', a.sha256, sha256(content));
  eq('provenance points at the source event', a.source_seq, 37);
  eq('the byte count is recorded', a.bytes, Buffer.byteLength(content));
  check('a preview is carried inline', a.preview.length > 0 && a.preview.length <= 240);
  check('the preview is a PREFIX of the content', content.startsWith(a.preview));
}

describe('context/artifacts-are-created-for-oversized-output');
{
  const { store, sandbox, make } = rig({ responses: [
    call('write', { path: 'big.txt', content: BIG('beta') }),
    call('read', { path: 'big.txt' }),
    finish('read it'),
  ]});
  const runId = uid('run');
  store.createRun(runId, { task: 'make a big file' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  await make().run(runId, claim.leaseToken, { input: 'go' });

  const events = store.events(runId);
  const arts = projectArtifacts(events);
  check('at least one artifact was created', arts.size >= 1, `${arts.size}`);

  const [id, rec] = [...arts.entries()][0];
  check('the artifact names its tool', !!rec.tool, String(rec.tool));
  check('the artifact records a source_seq', Number.isInteger(rec.source_seq), String(rec.source_seq));

  // THE PROVENANCE TEST: follow the link back and get the real bytes.
  const r = resolveArtifact(events, id);
  check('the artifact resolves through its provenance link', r.ok, String(r.reason));
  check('the resolved content is the full, unclamped text',
    Buffer.byteLength(r.content) >= ARTIFACT_MIN_BYTES, `${Buffer.byteLength(r.content)}B`);
  check('the sha256 verifies against the resolved bytes', r.verified);

  // An unknown id must be an explicit miss, never a silent empty string.
  const miss = resolveArtifact(events, 'a_deadbeef00');
  check('an unknown artifact id is an explicit miss', !miss.ok && miss.content === null, String(miss.reason));
}

describe('context/compaction-is-budget-aware');
{
  // Below budget: nothing is transformed at all, so a short run pays nothing.
  const small = rig({ responses: [call('write', { path: 'a.txt', content: 'x' }), finish()],
                      extra: { contextBudgetBytes: 10_000_000 } });
  const r1 = uid('run'); small.store.createRun(r1, { task: 't' });
  const c1 = small.store.claim('w', { runId: r1, leaseMs: 60_000 });
  await small.make().run(r1, c1.leaseToken, { input: 'go' });
  check('no compaction under budget',
    !small.store.events(r1).some(e => e.type === 'context.compacted'));

  // Over budget, with genuinely superseded content: compaction fires and is RECORDED.
  const big = rig({ extra: { contextBudgetBytes: 1_000 }, responses: [
    call('write', { path: 'f.txt', content: BIG('one') }),
    call('read', { path: 'f.txt' }),
    call('read', { path: 'f.txt' }),      // supersedes the previous read of the same path
    call('read', { path: 'f.txt' }),
    finish('done'),
  ]});
  const r2 = uid('run'); big.store.createRun(r2, { task: 't' });
  const c2 = big.store.claim('w', { runId: r2, leaseMs: 60_000 });
  await big.make().run(r2, c2.leaseToken, { input: 'go' });

  const comp = big.store.events(r2).filter(e => e.type === 'context.compacted');
  check('compaction fired over budget', comp.length >= 1, `${comp.length} events`);
  const p = comp[0]?.payload ?? {};
  check('the record carries PROVENANCE — which calls were elided, not just how many',
    Array.isArray(p.elided_tool_call_ids) && p.elided_tool_call_ids.length === p.elided,
    `${p.elided} elided / ${p.elided_tool_call_ids?.length} ids`);
  check('the record states the budget it exceeded', p.budget_bytes === 1_000, String(p.budget_bytes));
  check('the record states the size that triggered it',
    Number.isInteger(p.outbound_bytes_before) && p.outbound_bytes_before > p.budget_bytes,
    `${p.outbound_bytes_before}B > ${p.budget_bytes}B`);
}

describe('context/compaction-never-touches-the-durable-log');
{
  // The safety property the whole design rests on. Compaction rewrites the OUTBOUND array only.
  const { store, make } = rig({ extra: { contextBudgetBytes: 1_000 }, responses: [
    call('write', { path: 'f.txt', content: BIG('two') }),
    call('read', { path: 'f.txt' }),
    call('read', { path: 'f.txt' }),
    finish('done'),
  ]});
  const runId = uid('run');
  store.createRun(runId, { task: 't' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  await make().run(runId, claim.leaseToken, { input: 'go' });

  const events = store.events(runId);
  check('compaction did happen', events.some(e => e.type === 'context.compacted'));

  // Every tool.succeeded still holds its FULL original bytes — nothing was rewritten in place.
  const results = events.filter(e => e.type === 'tool.succeeded').map(e => String(e.payload?.result ?? ''));
  check('the log still holds full, unelided tool results',
    results.some(t => Buffer.byteLength(t) >= ARTIFACT_MIN_BYTES),
    `largest ${Math.max(...results.map(t => Buffer.byteLength(t)))}B`);
  check('no placeholder text ever entered the log',
    !results.some(t => /\[superseded /.test(t)));
}

describe('context/verify-verdicts-survive-compaction');
{
  // Evidence integrity. A verify result's first line is its VERDICT; eliding it would keep the
  // claim and discard the proof, which is exactly the failure Wave 1 exists to prevent.
  const msgs = [
    wireCall('v1', 'verify', { cmd: 'npm test' }),
    { role: 'tool', tool_call_id: 'v1', content: 'PASS (exit 0) npm test\n' + BIG('log') },
    wireCall('v2', 'verify', { cmd: 'npm test' }),
    { role: 'tool', tool_call_id: 'v2', content: 'PASS (exit 0) npm test\n' + BIG('log2') },
  ];
  const c = compactMessages(msgs);
  check('the earlier verify was elided', c.elided >= 1, `${c.elided}`);
  const elidedMsg = c.messages.find(m => m.tool_call_id === 'v1');
  check('its VERDICT survived in the placeholder', /verdict retained: PASS \(exit 0\)/.test(elidedMsg.content),
    String(elidedMsg.content).slice(0, 80));
  check('its body did not', Buffer.byteLength(elidedMsg.content) < 400,
    `${Buffer.byteLength(elidedMsg.content)}B`);
  check('the latest verify is untouched', c.messages[3].content === msgs[3].content);
}

describe('context/elided-content-still-points-at-its-artifact');
{
  // Evidence must not be ORPHANED by compaction: the placeholder names the artifact, so the
  // full bytes remain addressable after the transformation.
  const body = BIG('three');
  const rec = describeArtifact({ content: body, tool: 'read', target: 'f.txt', sourceSeq: 9 });
  const msgs = [
    wireCall('r1', 'read', { path: 'f.txt' }),
    { role: 'tool', tool_call_id: 'r1', content: body },
    wireCall('r2', 'read', { path: 'f.txt' }),
    { role: 'tool', tool_call_id: 'r2', content: 'fresh' },
  ];
  const byHash = new Map([[rec.sha256, rec]]);
  const c = compactMessages(msgs, { artifacts: { byContent: (t) => byHash.get(sha256(t)) ?? null } });
  const elided = c.messages.find(m => m.tool_call_id === 'r1');
  check('the placeholder references the artifact id',
    elided.content.includes(rec.artifact_id), String(elided.content).slice(0, 120));
  check('and states how many bytes were withheld', /\d+B\]/.test(elided.content));
  eq('provenance ids are returned for the compaction record', c.elidedIds, ['r1']);
}

describe('context/THE-BIG-ONE-compaction-preserves-replay-plan-and-resume');
{
  // The acceptance test the wave turns on. A long run that ACTUALLY triggers compaction must:
  //   1. replay identically, at zero model calls;
  //   2. fold the SAME plan;
  //   3. resume from a different Store handle to the same state.
  // If compaction had leaked into the log, all three would diverge.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-big-'));
  const responses = [
    call('plan', { goal: 'churn context', steps: ['make it big', 'read it back', 'prove it'] }),
    call('write', { path: 'f.txt', content: BIG('four') }),
    call('plan_step', { step: '1', state: 'done', evidence: 'wrote a big file' }),
  ];
  // Repeated reads of the SAME path guarantee supersession, but a run of identical calls with
  // nothing between them trips the no-progress detector (ADR-006) — correctly. Interleaving a
  // write keeps the run genuinely progressing, which is also what a real run looks like.
  for (let i = 0; i < 5; i++) {
    responses.push(call('read', { path: 'f.txt' }));
    responses.push(call('write', { path: 'f.txt', content: BIG('four') + i }));
  }
  responses.push(call('plan_step', { step: '2', state: 'done', evidence: 'read it back' }));
  responses.push(call('verify', { cmd: 'echo TESTS_OK' }));
  responses.push(call('plan_step', { step: '3', state: 'done', evidence: 'PASS (exit 0) echo TESTS_OK' }));
  responses.push(finish('all steps done'));

  const { store, make } = rig({ dir: d, responses, extra: { contextBudgetBytes: 2_000 } });
  const runId = uid('run');
  store.createRun(runId, { task: 'churn context' });
  const claim = store.claim('w', { runId, leaseMs: 120_000 });
  const res = await make().run(runId, claim.leaseToken, { input: 'go' });

  const events = store.events(runId);
  const compactions = events.filter(e => e.type === 'context.compacted');
  check('compaction ACTUALLY fired during this run', compactions.length >= 1,
    `${compactions.length} compaction events over ${events.length} events`);
  check('artifacts were created', projectArtifacts(events).size >= 1);
  eq('the run completed', res.status, 'completed');

  // 1. REPLAY — zero model calls, and the state matches the live projection.
  const live = project(store, runId);
  const r = replay(store, runId);
  eq('replay makes no model calls', r.modelCalls ?? 0, 0);
  eq('replay reconstructs the same event count', r.state?.seq ?? live.seq, live.seq);

  // 2. PLAN — folds identically through compaction.
  const planLive = projectPlan(events);
  check('the plan survived a compacting run', !!planLive);
  check('every plan step is still done', planSatisfied(planLive),
    planLive.steps.map(s => `${s.id}:${s.state}`).join(' '));
  check('step evidence survived', planLive.steps.every(s => s.evidence));

  // 3. A DIFFERENT reader reconstructs everything identically.
  const storeB = new Store(path.join(d, 'run.db'));
  const evB = storeB.events(runId);
  const fp = (p) => JSON.stringify({ goal: p.goal, revision: p.revision,
    steps: p.steps.map(s => [s.id, s.title, s.state, s.evidence]) });
  eq('an independent reader folds the identical plan', fp(projectPlan(evB)), fp(planLive));
  eq('and sees the identical artifact set',
    [...projectArtifacts(evB).keys()].sort().join(','),
    [...projectArtifacts(events).keys()].sort().join(','));

  // And the artifacts still resolve to their full bytes AFTER all that compaction.
  for (const id of projectArtifacts(evB).keys()) {
    const got = resolveArtifact(evB, id);
    check(`artifact ${id} still resolves and verifies after compaction`, got.ok && got.verified,
      String(got.reason));
  }
}

process.exit(summary('context', path.join(HERE, '..', 'results-context.json')) ? 1 : 0);
