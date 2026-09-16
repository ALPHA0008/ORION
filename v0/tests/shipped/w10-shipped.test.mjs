// W10 — SHIPPED CONFIGURATION. Delegation at the wiring a developer actually runs.
//
// The failure class this project has repeated across seven waves is a mechanism that works in a
// unit test and is never reached at the composition root. `tests/subagent` proves the mechanism.
// This suite proves the PRODUCT composes it: the `subagent` tool is in the toolset the Worker is
// handed, its policy is the real authorizer's, and the real binary surfaces it.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { prepareRun } from '../../src/cli/index.mjs';
import { mutatingTools, toolDefinitions } from '../../src/agent/tools/index.mjs';
import { projectLineage } from '../../src/core/projection/lineage.mjs';
import { DEFAULT_CHILD_TOOLS } from '../../src/core/child/scope.mjs';
import { MAX_LIVE_CHILDREN, MAX_CHILD_DEPTH } from '../../src/core/child/quota.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'src', 'cli', 'index.mjs');
const mk = (t) => fs.mkdtempSync(path.join(os.tmpdir(), `w10sh-${t}-`));
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// HOME is a module constant captured at import; project config is read from the WORKSPACE, so the
// in-process checks are honest. Anything HOME-dependent uses a subprocess (the trap W8 hit once).
const EMPTY_HOME = mk('home');
process.env.HOME = EMPTY_HOME;
process.env.USERPROFILE = EMPTY_HOME;
process.env.ORION_BASE_URL ??= 'http://127.0.0.1:9/v1';
process.env.ORION_MODEL ??= 'test-model';

function cli(args, { cwd, home = mk('h'), env = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
           HOME: home, USERPROFILE: home, ORION_HOME: path.join(home, '.orion'), ...env },
  });
  return { code: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? ''),
           all: String(r.stdout ?? '') + String(r.stderr ?? '') };
}

const prepared = async (ws) => {
  const store = new Store(path.join(mk('db'), 'runs.db'));
  const runId = store.createRun(uid('run'), { task: 'w10 shipped' });
  const claim = store.claim('w', { runId, leaseMs: 120_000 });
  const p = await prepareRun(store, runId, claim.leaseToken, ws);
  return { ...p, store, runId, leaseToken: claim.leaseToken };
};

// ═══════════════════════════════════════════ the composition root
describe('w10/shipped: the subagent tool is in the toolset the model is offered');
{
  const ws = mk('ws');
  const p = await prepared(ws);

  // THE assertion of this suite. Not "makeSubagentTool returns a tool" — that is the mechanism
  // suite. This is "the toolset the Worker is constructed with contains it".
  check('`subagent` is composed', !!p.tools.subagent, Object.keys(p.tools).join(','));
  eq('...and reaches the model schema',
    toolDefinitions(p.tools).filter(d => d.function.name === 'subagent').length, 1);

  const def = toolDefinitions(p.tools).find(d => d.function.name === 'subagent');
  check('...requiring a task', def.function.parameters.required.includes('task'));
  check('...offering an explicit tool grant', !!def.function.parameters.properties.tools);
  check('...and a posture request', !!def.function.parameters.properties.posture);
  check('the description says it is read-only by default',
    /read-only by default/.test(def.function.description), def.function.description);
  check('...and names the default tools',
    DEFAULT_CHILD_TOOLS.every(t => def.function.description.includes(t)));

  // W5-T1/T2: capability is declared on the tool and derived everywhere. Delegation can do
  // anything the child's toolset allows, so it must be inside the approval gate, not outside it.
  check('`subagent` is Mutating', mutatingTools(p.tools).has('subagent'),
    [...mutatingTools(p.tools)].join(','));
  eq('...and UNSAFE to re-issue after a crash', p.tools.subagent.recovery({}).class, 'UNSAFE');
  eq('...declaring itself a delegation', p.tools.subagent.delegates, true);

  // The built-in toolset is otherwise untouched.
  for (const t of ['read', 'grep', 'glob', 'git', 'write', 'edit', 'bash', 'verify'])
    check(`the built-in \`${t}\` survives`, !!p.tools[t]);
  p.store.close();
}

describe('w10/shipped: delegation goes through the REAL authorizer');
{
  const ws = mk('deny');
  // A deployer forbids delegation with the vocabulary that already exists. No new policy syntax
  // was invented for this wave — `subagent` is just a tool name.
  write(path.join(ws, '.orion-rules.json'), JSON.stringify({ denyTools: ['subagent'] }));
  const p = await prepared(ws);
  const ctx = { run_id: p.runId, project: ws };

  eq('a denied subagent tool is denied by the shipped authorizer',
    p.authorize({ kind: 'tool', name: 'subagent', args_digest: 'x',
                  effects: 'Mutating' }, ctx).decision, 'deny');
  eq('...while ordinary tools are unaffected',
    p.authorize({ kind: 'tool', name: 'read', args_digest: 'x',
                  effects: 'ReadOnly', path: 'a.txt' }, ctx).decision, 'allow');
  eq('...and built-in policy still holds',
    p.authorize({ kind: 'tool', name: 'verify', args_digest: 'x', effects: 'ReadOnly',
                  command: 'rm -rf /' }, ctx).decision, 'deny');
  p.store.close();
}

describe('w10/shipped: a child really runs through the composed tool');
{
  const ws = mk('run');
  fs.writeFileSync(path.join(ws, 'target.txt'), 'the answer is 42\n');
  const p = await prepared(ws);

  // The model endpoint is unreachable by design here, so the CHILD's model call fails — which is
  // itself the point: the delegation machinery runs end to end through the composed tool and
  // reports an honest failure rather than throwing out of the parent's turn.
  const out = await p.tools.subagent.run({ task: 'read target.txt and report the number' });

  check('the tool returned a rendered result rather than throwing', typeof out === 'string');
  check('...naming the child run', /subagent run_[0-9a-f]+/.test(out), out.slice(0, 200));
  check('...stating a terminal status', /completed|failed/.test(out), out.slice(0, 200));
  check('...listing the tools the child held', /tools: /.test(out), out.slice(0, 300));
  check('...and pointing at the full trajectory when it failed',
    !/failed/.test(out) || /orionctl explain run_/.test(out), out.slice(-200));

  // The lifecycle landed in the PARENT's log, under the parent's lease.
  const lin = projectLineage(p.store.events(p.runId));
  eq('child.spawned was recorded', lin.spawned, 1);
  eq('...and child.finished', lin.finished, 1);
  eq('...leaving nothing running', lin.running.length, 0);
  const c = lin.children[0];
  eq('...naming the parent', c.parent_run, p.runId);
  check('...recording the posture the child ran under', !!c.posture, String(c.posture));
  check('...and the tools it was granted', Array.isArray(c.scopes?.tools));
  eq('...with no mutating grant by default', c.scopes.mutating.length, 0);

  // The child is a real run with the lineage column populated.
  const row = p.store.run(c.child_run);
  check('the child exists in `runs`', !!row);
  eq('...with parent_run_id set', row.parent_run_id, p.runId);
  p.store.close();
}

describe('w10/shipped: two delegates in ONE turn run as a batch through the composed toolset');
{
  // W10-A through the COMPOSITION ROOT. `tests/subagent/parallel` proves the dispatch mechanism
  // with a hand-built Worker; this proves the product's own composed toolset takes the same path —
  // the failure class this project has repeated across seven waves is a mechanism that works in a
  // unit test and is never reached by the real wiring.
  //
  // The model endpoint is unreachable by design, so both children fail fast. That is exactly what
  // makes this a cheap, deterministic wiring check: what is asserted is that BOTH were spawned and
  // BOTH reached a terminal record from a single turn.
  const ws = mk('batch');
  const p = await prepared(ws);
  const { Worker } = await import('../../src/agent/loop/worker.mjs');

  const twoDelegates = {
    content: '', finish: false,
    tool_calls: [
      { id: 'tc_a', name: 'subagent', args: { task: 'investigate A' } },
      { id: 'tc_b', name: 'subagent', args: { task: 'investigate B' } },
    ],
  };
  let turn = 0;
  const parentModel = { name: 'scripted', provider: 'test', capabilities: new Set(['tools']),
    async invoke() {
      turn += 1;
      return { input_tokens: 10, output_tokens: 5,
               ...(turn === 1 ? twoDelegates
                              : { content: 'both attempted', tool_calls: [], finish: true }) };
    } };

  const worker = new Worker(p.store, {
    sandbox: p.sandbox, model: parentModel, tools: p.tools,
    // `permissive` is what an isolated backend earns; at `auto` the Mutating+UNSAFE `subagent`
    // escalates and the run parks for a human, which is correct policy but not what is under test.
    authorize: createAuthorizer({ posture: 'permissive' }),
    leaseMs: 120_000, maxTurns: 4,
  });
  await worker.run(p.runId, p.leaseToken, { input: 'delegate two at once' });

  const lin = projectLineage(p.store.events(p.runId));
  eq('BOTH children were spawned from one turn', lin.spawned, 2);
  eq('...and both reached a terminal record', lin.finished, 2);
  eq('...leaving nothing running', lin.running.length, 0);
  eq('...both failed, the endpoint being dead by design', lin.failed, 2);

  const ids = lin.children.map(c => c.child_run);
  eq('...with two distinct child ids', new Set(ids).size, 2);
  check('...each a real run row with parent_run_id set',
    ids.every(id => p.store.run(id)?.parent_run_id === p.runId));
  check('...and both named in child.spawned',
    p.store.events(p.runId).filter(e => e.type === 'child.spawned')
      .every(e => ids.includes(e.payload.child_run)));
  p.store.close();
}

describe('w10/shipped: a project that never delegates is unchanged');
{
  const ws = mk('plain');
  const p = await prepared(ws);
  eq('no child events are written when nothing delegates',
    projectLineage(p.store.events(p.runId)).spawned, 0);
  // `subagent` is offered (the capability exists) but costs nothing until used — the same
  // discipline W7 applied to the `skill` tool.
  check('the tool is present but inert', !!p.tools.subagent);
  p.store.close();
}

// ═══════════════════════════════════════════ config + docs
describe('w10/shipped: quotas are configurable DOWNWARD through the real config layer');
{
  const ws = mk('cfg');
  write(path.join(ws, '.orion.json'), JSON.stringify({
    model: 'm', subagents: { maxLiveChildren: 1, maxDepth: 1 }, childModel: 'small-model',
  }));
  const r = cli(['config'], { cwd: ws });
  eq('the config command succeeds', r.code, 0);
  check('the subagent quota is visible', /subagents/.test(r.all), r.all.slice(0, 700));
  check('...and the child model', /childModel|small-model/.test(r.all), r.all.slice(0, 700));

  const bad = mk('badcfg');
  write(path.join(bad, '.orion.json'), JSON.stringify({ subagents: { maxLiveChildren: 'lots' } }));
  const b = cli(['config'], { cwd: bad });
  check('a wrongly-typed quota exits non-zero', b.code !== 0, `exit ${b.code}`);
  check('...naming the field', /subagents\.maxLiveChildren/.test(b.all), b.all.slice(0, 400));
}

describe('w10/shipped: the CLI documents delegation where an operator will look');
{
  const h = cli(['--help']);
  eq('help still works', h.code, 0);
  check('help mentions subagents', /subagent/i.test(h.all), h.all.slice(-1200));
  check('...and that a child is read-only by default',
    /read-only/i.test(h.all), h.all.slice(-1200));
  check('...and names the live-children limit',
    new RegExp(String(MAX_LIVE_CHILDREN)).test(h.all) || /maxLiveChildren/.test(h.all),
    h.all.slice(-1200));
}

describe('w10/shipped: the contract is still v6/49 — the reserved members were waiting');
{
  const { EVENT_TYPES } = await import('../../src/core/event/index.mjs');
  eq('the vocabulary is unchanged', EVENT_TYPES.length, 49);
  check('child.spawned was already a member', EVENT_TYPES.includes('child.spawned'));
  check('child.finished was already a member', EVENT_TYPES.includes('child.finished'));
  // W10 emits two types that have been frozen since the Wave-1 audit and never written. That is
  // the whole reason no contract change was needed: the vocabulary anticipated this wave.
  eq('no new type was needed', EVENT_TYPES.filter(t => t.startsWith('child.')).length, 2);
  eq('delegation depth is bounded', MAX_CHILD_DEPTH, 2);
}

process.exit(summary('w10 shipped', path.join(HERE, '..', 'results-shipped-w10.json')) ? 1 : 0);
