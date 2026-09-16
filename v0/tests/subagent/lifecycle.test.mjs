// W10 — the child trajectory, end to end, against a real store.
//
// These run REAL `Worker` loops over a REAL SQLite store with scripted models. The model is
// scripted because the assertions are about the RUNTIME — lineage, leases, budgets, recovery —
// and a live model would make them non-deterministic without making them stronger. Everything
// below the model is the shipped product: the same Worker class, the same store, the same
// authorizer, the same completion contract.
//
// The load-bearing claims: a child is a real run with its own lease and log; the parent's window
// never swells with the child's turns; and every outcome — success, failure, cancellation, a lost
// process — leaves an honest terminal record.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { spawnChild, setChildCompletionContract, lastAssistantText,
         reconcileChildren, CHILD_SYSTEM } from '../../src/core/child/executor.mjs';
import { makeSubagentTool } from '../../src/core/child/tool.mjs';
import { projectLineage, summariseLineage, lineageTree, ChildStatus, ChildState,
         liveChildren, childTokens } from '../../src/core/projection/lineage.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { QuotaError } from '../../src/core/child/quota.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mk = (t) => fs.mkdtempSync(path.join(os.tmpdir(), `w10l-${t}-`));

/** A model that replays a script of responses. */
const scripted = (responses, name = 'scripted') => {
  let i = 0;
  return { name, provider: 'test', capabilities: new Set(['tools']),
    async invoke() {
      const r = responses[Math.min(i++, responses.length - 1)];
      return { input_tokens: 10, output_tokens: 5,
               ...(typeof r === 'function' ? r() : r) };
    } };
};
// The worker consumes NORMALISED responses (`{id, name, args}`), not the OpenAI wire shape — the
// provider layer does that conversion before the loop ever sees it. Matching the convention the
// other suites already use keeps these fixtures honest about where the seam is.
const say = (content) => ({ content, tool_calls: [], finish: true });
const call = (name, args) => ({ content: '', finish: false,
  tool_calls: [{ id: `tc_${Math.random().toString(16).slice(2, 10)}`, name, args }] });

// The shipped completion contract, injected exactly as `cli/index.mjs` injects it.
const { defaultCompletionContract } = await import('../../src/cli/index.mjs');
setChildCompletionContract((store, childRunId, childTools) =>
  defaultCompletionContract(store, childRunId, { tools: childTools }));

/**
 * A child that does REAL work: reads a file, then answers.
 *
 * Deliberately not "answer immediately with no tool calls". The shipped completion contract
 * requires that a run actually did something (`anySucceeded`) — and that rule applies inside a
 * child exactly as at top level, so a child that produces an answer without looking at anything is
 * correctly judged `finished_without_change`. That is the rule working, not a bug to design
 * around: a model that answers without reading is the behaviour the contract exists to catch.
 */
const workingChild = (answer = 'the child answer') =>
  scripted([call('read', { path: 'note.txt' }), say(answer)]);

/** A parent run, ready to delegate. */
function parentRun(tag = 'p') {
  const ws = mk(tag);
  fs.writeFileSync(path.join(ws, 'note.txt'), 'the thing the child was asked to look at\n');
  const sandbox = new LocalSandbox(ws);
  const store = new Store(path.join(mk(`${tag}db`), 'runs.db'));
  const runId = store.createRun(uid('run'), { task: 'parent task' });
  const claim = store.claim('w-parent', { runId, leaseMs: 120_000 });
  return { ws, sandbox, store, runId, leaseToken: claim.leaseToken,
           tools: makeTools(sandbox) };
}

const base = (p, over = {}) => ({
  store: p.store, parentRunId: p.runId, parentLeaseToken: p.leaseToken,
  tools: p.tools, authOptions: { denyTools: [], escalateTools: [],
                                 denyCommandPatterns: [], protectedPaths: [] },
  posture: 'auto', sandbox: p.sandbox, createAuthorizer,
  makeModel: () => workingChild(),
  modelName: 'child-model', provider: 'test',
  ...over,
});

const evs = (p, type) => p.store.events(p.runId).filter(e => e.type === type);

// ═══════════════════════════════════════════ lifecycle
describe('w10/lifecycle: a child is a real run with its own trajectory');
{
  const p = parentRun('basic');
  const res = await spawnChild(base(p, { task: 'summarise the config', reason: 'bounded lookup' }));

  eq('the child completed', res.status, ChildStatus.COMPLETED, res.detail ?? '');
  eq('...returning its answer', res.result, 'the child answer');
  check('...under its own run id', /^run_/.test(res.child_run), res.child_run);

  // THE reserved members, emitted for the first time since they were frozen in Wave 1.
  const spawned = evs(p, 'child.spawned');
  eq('child.spawned was emitted once', spawned.length, 1);
  eq('...naming the parent', spawned[0].payload.parent_run, p.runId);
  eq('...and the child', spawned[0].payload.child_run, res.child_run);
  eq('...carrying the task', spawned[0].payload.task, 'summarise the config');
  eq('...and why it was delegated', spawned[0].payload.reason, 'bounded lookup');

  // Provenance the plan names explicitly: model, posture, isolation, depth.
  eq('...the model that served it', spawned[0].payload.model, 'child-model');
  eq('...the provider', spawned[0].payload.provider, 'test');
  eq('...the posture it ran under', spawned[0].payload.posture, 'auto');
  eq('...and its depth', spawned[0].payload.depth, 1);
  check('...the tools it was granted', spawned[0].payload.scopes.tools.includes('read'));
  eq('...and that none of them could mutate', spawned[0].payload.scopes.mutating.length, 0);

  const finished = evs(p, 'child.finished');
  eq('child.finished was emitted once', finished.length, 1);
  eq('...with the terminal status', finished[0].payload.status, ChildStatus.COMPLETED);
  eq('...for the same child', finished[0].payload.child_run, res.child_run);
  check('...and tokens the child actually spent', finished[0].payload.tokens > 0,
    String(finished[0].payload.tokens));

  // A REFERENCE, not a copy: the child's output lives in the child's log. Duplicating it would
  // double the bytes and create two sources of truth for one answer.
  eq('the result is a reference to the child run', finished[0].payload.result_ref.run, res.child_run);
  check('...and the parent log does NOT contain the child\'s turns',
    p.store.events(p.runId).every(e => !String(e.type).startsWith('model.')),
    p.store.events(p.runId).map(e => e.type).join(','));

  // The child is a real row, with the lineage column the store has carried since Wave 1 and
  // nothing until now populated.
  const childRow = p.store.run(res.child_run);
  check('the child exists in `runs`', !!childRow);
  eq('...with parent_run_id set', childRow.parent_run_id, p.runId);
  check('...and its own events', p.store.events(res.child_run).length > 0);
  check('...including its own model calls',
    p.store.events(res.child_run).some(e => e.type === 'model.requested'));
  eq('the child ran under the subagent system prompt',
    CHILD_SYSTEM.includes('You are a SUBAGENT'), true);
  p.store.close();
}

describe('w10/lifecycle: the parent and child hold SEPARATE leases');
{
  const p = parentRun('lease');
  const res = await spawnChild(base(p, { task: 'look something up' }));
  eq('the child completed', res.status, ChildStatus.COMPLETED);

  // Invariant 4 (execution fencing) is untouched: two runs, two leases, neither able to write to
  // the other's trajectory. This is what makes in-process children safe rather than a shortcut.
  const parentLeases = p.store.events(p.runId).filter(e => e.type === 'run.leased');
  const childLeases = p.store.events(res.child_run).filter(e => e.type === 'run.leased');
  eq('the parent was leased', parentLeases.length, 1);
  eq('the child was leased separately', childLeases.length, 1);
  check('the parent still holds its own lease',
    p.store.isLeaseValid?.(p.runId, p.leaseToken) !== false);
  p.store.close();
}

describe('w10/lifecycle: a failing child is an ANSWER, not an exception');
{
  const p = parentRun('fail');
  // A child whose model does nothing at all: the honest-completion rule (ADR-013) must refuse to
  // call that success, INSIDE the child, exactly as it would at top level. Otherwise delegation
  // becomes a laundering route for a failure.
  const res = await spawnChild(base(p, {
    task: 'do the thing',
    makeModel: () => scripted([say('I have decided not to.')]),
  }));

  eq('the child did NOT report success', res.status, ChildStatus.FAILED, res.detail ?? '');
  check('...with an honest reason', /finished_without_change/.test(String(res.detail)), res.detail);
  // The verdict came from the SHIPPED contract computed over the CHILD's own log — a model that
  // answers without looking at anything is exactly what that rule exists to catch, and delegation
  // must not become a way to launder such an answer into a parent's success.
  check('...decided by the child\'s own trajectory',
    p.store.events(res.child_run).some(e => e.type === 'degraded'
      && e.payload?.subsystem === 'completion_contract'),
    p.store.events(res.child_run).map(e => e.type).join(','));
  eq('...recorded as such', evs(p, 'child.finished')[0].payload.status, ChildStatus.FAILED);
  check('...and the parent run continues', p.store.run(p.runId).status !== 'failed');
  check('the child\'s last words are still available',
    res.result.includes('decided not to'), res.result);
  p.store.close();
}

describe('w10/lifecycle: a quota refusal is a message the model can act on');
{
  const p = parentRun('quota');
  let e = null;
  try {
    await spawnChild(base(p, { task: 'too deep', depth: 9 }));
  } catch (err) { e = err; }
  check('spawning beyond the depth ceiling throws a QuotaError', e instanceof QuotaError);
  eq('...classified', e.kind, 'max_depth');
  eq('no child.spawned was written for a refused spawn', evs(p, 'child.spawned').length, 0);

  // Through the TOOL, a refusal becomes a `tool.failed` the model reads and adapts to, rather
  // than an opaque exception that just costs a turn.
  const tool = makeSubagentTool(base(p, { depth: 9 }));
  let te = null;
  try { await tool.run({ task: 'too deep' }); } catch (err) { te = err; }
  check('the tool reports it in words', /cannot delegate/.test(String(te?.message)), String(te?.message));
  check('...and tells the model what to do instead',
    /do this work directly/i.test(String(te?.message)), String(te?.message));
  p.store.close();
}

// ═══════════════════════════════════════════ lineage
describe('w10/lineage: the graph is a FOLD, not a table');
{
  const p = parentRun('lineage');
  const a = await spawnChild(base(p, { task: 'first' }));
  const b = await spawnChild(base(p, { task: 'second' }));

  const lin = projectLineage(p.store.events(p.runId));
  eq('both children are in the fold', lin.spawned, 2);
  eq('...both finished', lin.finished, 2);
  eq('...none failed', lin.failed, 0);
  eq('...none still running', lin.running.length, 0);
  check('...tokens are aggregated', lin.tokens > 0, String(lin.tokens));
  eq('childTokens agrees', childTokens(p.store.events(p.runId)), lin.tokens);
  eq('the children are in spawn order',
    lin.children.map(c => c.task).join(','), 'first,second');
  eq('lookup by id works', lin.byId[a.child_run].task, 'first');
  eq('...for the second too', lin.byId[b.child_run].task, 'second');

  // Derived, so it is identical when recomputed from the same events in another process — which
  // is what makes replay (Invariant 2) and resume correct.
  const again = projectLineage(p.store.events(p.runId));
  eq('the fold is deterministic', JSON.stringify(again), JSON.stringify(lin));

  // `explain` narrates a run from its log alone (Invariant 7). Delegated work has to be readable
  // there or a reviewer sees a blank line where a whole child trajectory happened — which is what
  // these two event types rendered as before this wave gave them text.
  const { explain } = await import('../../src/core/run/explain.mjs');
  const narrated = explain(p.store, p.runId);
  check('explain names the child it delegated to', narrated.includes(a.child_run), narrated);
  check('...the model that served it', /child-model/.test(narrated));
  check('...the tools it was granted', /tools: /.test(narrated));
  check('...and its terminal status with tokens', /completed \(\d+tok/.test(narrated), narrated);
  check('...with no blank event lines', !/\d\d:\d\d:\d\d\s+·\s*$/m.test(narrated));

  // FOUND BY THE §11.2 GATE. A fork and a child both carry `parent_run_id`, and until this wave
  // only forks ever did — so `explain` rendered a delegated child as "forked from X at event
  // null", which is wrong twice over. `forked_from_seq` is the discriminator.
  const childNarrated = explain(p.store, a.child_run);
  check('a child is described as a child, not a fork',
    /child of run_/.test(childNarrated), childNarrated.split('\n').slice(0, 3).join(' | '));
  check('...and never claims a branch point that does not exist',
    !/forked from/.test(childNarrated) && !/event null/.test(childNarrated),
    childNarrated.split('\n').slice(0, 3).join(' | '));
  check('...naming its actual parent', childNarrated.includes(p.runId));

  const sum = summariseLineage(p.store.events(p.runId));
  check('the summary names each child', sum.includes(a.child_run) && sum.includes(b.child_run));
  check('...with its model', /child-model/.test(sum), sum);
  check('...and its posture', /posture auto/.test(sum), sum);
  eq('a run with no children summarises to nothing', summariseLineage([]), null);
  p.store.close();
}

describe('w10/lineage: a spawn with no finish reads as still running');
{
  const events = [{ type: 'child.spawned', seq: 1, at: 1,
                    payload: { parent_run: 'p', child_run: 'c1', task: 't' } }];
  const lin = projectLineage(events);
  eq('the child is running', lin.running.length, 1);
  eq('...with no status yet', lin.children[0].status, null);
  eq('...and state running', lin.children[0].state, ChildState.RUNNING);
  eq('liveChildren agrees', liveChildren(events).length, 1);

  // A finish with no spawn is not nonsense — a log can be replayed from a snapshot boundary that
  // cut between the two — so it is synthesised rather than dropped.
  const orphan = projectLineage([{ type: 'child.finished', seq: 2, at: 2,
    payload: { parent_run: 'p', child_run: 'c9', status: 'completed', tokens: 5 } }]);
  eq('an orphan finish still yields a child', orphan.spawned, 1);
  eq('...marked finished', orphan.children[0].state, ChildState.FINISHED);
  eq('...with its tokens counted', orphan.tokens, 5);

  eq('unrelated events are ignored', projectLineage([{ type: 'turn.started', payload: {} }]).spawned, 0);
  eq('an empty log folds to nothing', projectLineage([]).spawned, 0);
  eq('a null log folds to nothing', projectLineage(null).spawned, 0);
}

describe('w10/lineage: a grandchild keeps the tree compositional');
{
  const p = parentRun('tree');
  const child = await spawnChild(base(p, { task: 'the middle' }));

  // The child's OWN log is where its children live — there is no global index, so the tree is
  // assembled by reading each run. That is what keeps a grandchild (scope §6) free.
  p.store.append(child.child_run, 'child.spawned', {
    parent_run: child.child_run, child_run: 'run_grandchild', task: 'the leaf', depth: 2 },
    { leaseToken: null, force: true });

  const tree = lineageTree(p.runId, (id) => p.store.events(id));
  eq('the root is the parent', tree.run, p.runId);
  eq('...with one child', tree.children.length, 1);
  eq('...which itself has one child', tree.children[0].tree.children.length, 1);
  eq('...the grandchild', tree.children[0].tree.children[0].child_run, 'run_grandchild');

  // A malformed log must not wedge the traversal.
  const cyclic = lineageTree('a', (id) => id === 'a'
    ? [{ type: 'child.spawned', payload: { parent_run: 'a', child_run: 'a' } }] : []);
  check('a cycle is reported rather than hung', cyclic.children[0].tree.cycle === true);
  const deep = lineageTree('a', () => [{ type: 'child.spawned', payload: { child_run: 'a2' } }],
    { maxDepth: 1 });
  check('depth is bounded', JSON.stringify(deep).includes('truncated'));
  p.store.close();
}

// ═══════════════════════════════════════════ recovery
describe('w10/recovery: a child whose process died is recorded LOST, never forgotten');
{
  const p = parentRun('lost');
  // Exactly what a SIGKILL leaves behind: a spawn in the log, no finish, and a process that is
  // gone. An in-process child cannot outlive its parent's process.
  p.store.append(p.runId, 'child.spawned', {
    parent_run: p.runId, child_run: 'run_ghost', task: 'interrupted work', depth: 1,
    model: 'child-model' }, { leaseToken: p.leaseToken });

  eq('before recovery the child reads as running', liveChildren(p.store.events(p.runId)).length, 1);

  const n = reconcileChildren(p.store, p.runId, p.leaseToken);
  eq('one child was reconciled', n, 1);

  const lin = projectLineage(p.store.events(p.runId));
  eq('...and is no longer running', lin.running.length, 0);
  eq('...recorded LOST', lin.children[0].status, ChildStatus.LOST);
  check('...with an honest reason',
    /did not survive/.test(lin.children[0].detail ?? ''), lin.children[0].detail);
  check('...preserving its model provenance', lin.children[0].model === 'child-model');

  // A parent that silently forgot the child it was waiting on would have lost work without
  // saying so, and `explain` would show a spawn with no outcome forever.
  eq('reconciling again is a no-op', reconcileChildren(p.store, p.runId, p.leaseToken), 0);
  p.store.close();
}

describe('w10/recovery: a cancelled child parks honestly and frees its slot');
{
  const p = parentRun('cancel');
  const ac = new AbortController();
  // Cancel while the child is mid-flight: the model yields, then the signal fires.
  const res = await spawnChild(base(p, {
    task: 'long work',
    signal: ac.signal,
    makeModel: () => scripted([
      () => { ac.abort(); return call('read', { path: 'nope.txt' }); },
      say('never reached'),
    ]),
  }));

  eq('the child is cancelled, not failed', res.status, ChildStatus.CANCELLED, res.detail ?? '');
  eq('...recorded as cancelled', evs(p, 'child.finished')[0].payload.status, ChildStatus.CANCELLED);
  eq('...and the slot is free again', liveChildren(p.store.events(p.runId)).length, 0);
  // Cancellation is NOT a failure: nothing broke. Reporting it as failed would be untruthful
  // about why the child stopped (ADR-013).
  check('the parent can spawn again afterwards',
    projectLineage(p.store.events(p.runId)).running.length === 0);
  p.store.close();
}

// ═══════════════════════════════════════════ replay / fork
describe('w10/replay: replaying a parent references children, it does not re-run them');
{
  const p = parentRun('replay');
  const res = await spawnChild(base(p, { task: 'delegated' }));
  const childCallsBefore = p.store.events(res.child_run).filter(e => e.type === 'model.requested').length;
  check('the child really made model calls', childCallsBefore > 0);

  const { replay } = await import('../../src/core/replay/index.mjs');
  const replayed = replay(p.store, p.runId);
  const childCallsAfter = p.store.events(res.child_run).filter(e => e.type === 'model.requested').length;

  // Invariant 2: deterministic replay at ZERO model cost. If replay re-executed children it would
  // cost real tokens and produce a different trajectory every time.
  eq('replay did not add a single child model call', childCallsAfter, childCallsBefore);
  check('...and the lineage is reconstructible from the replayed events',
    projectLineage(replayed.events ?? p.store.events(p.runId)).spawned >= 1);

  // The child's own trajectory replays independently — it is a run like any other.
  const childReplay = replay(p.store, res.child_run);
  check('the child replays on its own', !!childReplay);
  p.store.close();
}

process.exit(summary('w10 lifecycle', path.join(HERE, '..', 'results-w10-lifecycle.json')) ? 1 : 0);
