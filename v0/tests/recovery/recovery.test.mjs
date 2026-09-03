// Phase E + F + G — tool recovery classification, the three recovery outcomes, no-progress.
import path from 'node:path'; import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker, ExitReason } from '../../src/agent/loop/worker.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { decideRecovery, RecoveryClass, classifyShell, Decision } from '../../src/core/recovery/index.mjs';
import { describe, check, eq, summary, tmpdir } from '../harness.mjs';
import { makeScriptModel } from '../_helpers/script-model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = tmpdir('recovery');
const mk = (tag) => {
  const d = path.join(DIR, tag);
  fs.mkdirSync(d, { recursive: true });
  const store = new Store(path.join(d, 'h.db'), { durability: 'normal' });
  const sandbox = new LocalSandbox(path.join(d, 'work'));
  return { store, sandbox, tools: makeTools(sandbox), dir: d };
};

// ══════════════════════════════════ Phase E — classify every V0 tool
describe('Phase E — recovery class of every V0 tool');
{
  const { tools, sandbox } = mk('classify');
  sandbox.write('f.txt', 'hello OLD world');

  eq('read      -> READ_ONLY',       tools.read.recovery({ path: 'f.txt' }).class, RecoveryClass.READ_ONLY);
  eq('grep      -> READ_ONLY',       tools.grep.recovery({ pattern: 'x' }).class, RecoveryClass.READ_ONLY);
  eq('write     -> SAFE_RETRY',      tools.write.recovery({ path: 'f.txt', content: 'x' }).class, RecoveryClass.SAFE_RETRY);
  eq('edit      -> SELF_VERIFYING',  tools.edit.recovery({ path: 'f.txt', old_string: 'OLD', new_string: 'NEW' }).class, RecoveryClass.SELF_VERIFYING);
  eq('ask_user  -> READ_ONLY',       tools.ask_user.recovery({ prompt: 'p' }).class, RecoveryClass.READ_ONLY);
  check('ask_user is flagged alwaysEscalate', tools.ask_user.alwaysEscalate === true);

  // bash is ARGUMENT-DEPENDENT (ADR-002) — the whole point
  eq('bash "mkdir -p a/b"   -> SAFE_RETRY', tools.bash.recovery({ cmd: 'mkdir -p a/b' }).class, RecoveryClass.SAFE_RETRY);
  eq('bash "echo hi"        -> SAFE_RETRY', tools.bash.recovery({ cmd: 'echo hi' }).class, RecoveryClass.SAFE_RETRY);
  eq('bash "echo x >> f"    -> UNSAFE',     tools.bash.recovery({ cmd: 'echo x >> f' }).class, RecoveryClass.UNSAFE);
  eq('bash "git push"       -> UNSAFE',     tools.bash.recovery({ cmd: 'git push origin main' }).class, RecoveryClass.UNSAFE);
  eq('bash "curl -X POST"   -> UNSAFE',     tools.bash.recovery({ cmd: 'curl -X POST http://x' }).class, RecoveryClass.UNSAFE);
  eq('bash unknown command  -> UNSAFE (default deny)', classifyShell('frobnicate --wibble'), RecoveryClass.UNSAFE);
  check('SAME TOOL, opposite class — the ADR-002 result',
    tools.bash.recovery({ cmd: 'mkdir -p q' }).class !== tools.bash.recovery({ cmd: 'echo x >> q' }).class);
}

// ══════════════════════════════════ Phase F — the three outcomes, under real effects
describe('Phase F — Case 1: effect has NOT happened -> reissue');
{
  const { tools, sandbox } = mk('case1');
  const args = { path: 'new.txt', content: 'fresh' };
  const d = decideRecovery(tools.write.recovery(args));
  eq('decision', d.decision, Decision.REISSUE);
  eq('verify() reported not-applied', d.verified, 'not-applied');
  check('file genuinely absent beforehand', !sandbox.exists('new.txt'));
}

describe('Phase F — Case 2: effect HAS happened and is verifiable -> skip');
{
  const { tools, sandbox } = mk('case2');
  const args = { path: 'done.txt', content: 'already here' };
  sandbox.write(args.path, args.content);                  // the effect landed pre-crash
  const d = decideRecovery(tools.write.recovery(args));
  eq('decision', d.decision, Decision.SKIP);
  eq('verify() reported applied', d.verified, 'applied');
}

describe('Phase F — Case 2b: edit is SELF_VERIFYING in both directions');
{
  const { tools, sandbox } = mk('case2b');
  sandbox.write('e.txt', 'a OLD b');
  const args = { path: 'e.txt', old_string: 'OLD', new_string: 'NEW' };
  eq('before the edit -> reissue', decideRecovery(tools.edit.recovery(args)).decision, Decision.REISSUE);
  tools.edit.run(args);
  eq('after the edit  -> skip',    decideRecovery(tools.edit.recovery(args)).decision, Decision.SKIP);
  check('replaying edit by hand would throw (self-rejecting)', (() => {
    try { tools.edit.run(args); return false; } catch { return true; }
  })());
}

describe('Phase F — Case 3: cannot be verified -> ESCALATE (never guess)');
{
  const { tools } = mk('case3');
  const d = decideRecovery(tools.bash.recovery({ cmd: 'echo x >> log.txt' }));
  eq('decision', d.decision, Decision.ESCALATE);
  eq('class', d.class, RecoveryClass.UNSAFE);
  check('reason explains why', /cannot determine|not safe/i.test(d.reason), d.reason);
}

describe('Phase F — decideRecovery edge cases');
{
  eq('READ_ONLY reissues',        decideRecovery({ class: RecoveryClass.READ_ONLY }).decision, Decision.REISSUE);
  eq('TRANSACTIONAL reissues',    decideRecovery({ class: RecoveryClass.TRANSACTIONAL }).decision, Decision.REISSUE);
  eq('EXTERNALLY_DEDUPED w/ key reissues',
     decideRecovery({ class: RecoveryClass.EXTERNALLY_DEDUPED, dedup_key: 'k' }).decision, Decision.REISSUE);
  eq('EXTERNALLY_DEDUPED w/o key escalates',
     decideRecovery({ class: RecoveryClass.EXTERNALLY_DEDUPED }).decision, Decision.ESCALATE);
  eq('verify() throwing escalates',
     decideRecovery({ class: RecoveryClass.SAFE_RETRY, verify: () => { throw new Error('boom'); } }).decision, Decision.ESCALATE);
  eq('verify() unknown + UNSAFE escalates',
     decideRecovery({ class: RecoveryClass.UNSAFE, verify: () => 'unknown' }).decision, Decision.ESCALATE);
  eq('verify() unknown + SAFE_RETRY still reissues',
     decideRecovery({ class: RecoveryClass.SAFE_RETRY, verify: () => 'unknown' }).decision, Decision.REISSUE);
  eq('missing recovery contract escalates', decideRecovery(undefined).decision, Decision.ESCALATE);
}

// ═════════════════ Phase F in situ — an UNSAFE orphan must pause the run
describe('Phase F in situ — UNSAFE orphan pauses the run for a human');
{
  const { store, sandbox, tools } = mk('unsafe-orphan');
  const r = uid(); store.createRun(r);
  const c = store.claim('w1', { runId: r });
  store.append(r, 'turn.started', { input: 'x' });
  // fabricate the orphan: tool.started with no terminal event
  store.append(r, 'tool.started', { tool_call_id: 'orph', name: 'bash', args: { cmd: 'echo x >> log.txt' } });

  const w = new Worker(store, { sandbox, model: makeScriptModel(), tools,
    authorize: createAuthorizer(), workerId: 'w1' });
  const res = await w.run(r, c.leaseToken, {});

  eq('run paused', res.status, 'paused');
  eq('reason is ambiguous recovery', res.reason, ExitReason.AMBIGUOUS_RECOVERY);
  check('lease released so no worker is pinned', store.run(r).lease_token === null);
  check('a HumanRequest was persisted', store.humanRequests(r, 'pending').length === 1);
  const dec = store.events(r).find(e => e.type === 'tool.recovery_decided');
  eq('decision recorded as escalate', dec?.payload?.decision, 'escalate');
  check('decision is an explicit state transition, not a silent guess',
    store.events(r).some(e => e.type === 'human.requested'));
  store.close();
}

describe('Phase F in situ — SAFE_RETRY orphan is skipped when verify() says applied');
{
  const { store, sandbox, tools } = mk('safe-orphan');
  const r = uid(); store.createRun(r);
  const c = store.claim('w1', { runId: r });
  store.append(r, 'turn.started', { input: 'x' });
  sandbox.write('a.txt', 'alpha\nVALUE=1\n');          // effect already landed
  store.append(r, 'tool.started', { tool_call_id: 'orph2', name: 'write',
    args: { path: 'a.txt', content: 'alpha\nVALUE=1\n' } });

  const w = new Worker(store, { sandbox, model: makeScriptModel(), tools,
    authorize: createAuthorizer(), workerId: 'w1', maxTurns: 12 });
  await w.run(r, c.leaseToken, {});
  const dec = store.events(r).find(e => e.type === 'tool.recovery_decided');
  eq('decision recorded as skip', dec?.payload?.decision, 'skip');
  eq('verify said applied', dec?.payload?.verified, 'applied');
  check('orphan got a terminal tool event',
    store.events(r).some(e => e.type === 'tool.succeeded' && e.payload.tool_call_id === 'orph2'));
  store.close();
}

// ══════════════════════════════════════════ Phase G — no-progress
describe('Phase G — repeated identical tool request terminates with no_progress');
{
  const { store, sandbox, tools } = mk('repeat');
  const r = uid(); store.createRun(r);
  const c = store.claim('w1', { runId: r });
  // model that always asks for the SAME denied tool
  const stubborn = { name: 'stubborn', capabilities: new Set(),
    async invoke() { return { content: 'again', finish: false, input_tokens: 5, output_tokens: 5,
      tool_calls: [{ id: 'x', name: 'edit', args: { path: 'a.txt', old_string: 'A', new_string: 'B' } }] }; } };
  const w = new Worker(store, { sandbox, model: stubborn, tools,
    authorize: createAuthorizer({ denyTools: ['edit'] }), workerId: 'w1',
    maxTurns: 40, maxRepeatedCalls: 3 });
  const res = await w.run(r, c.leaseToken, { input: 'go' });

  eq('terminated as no_progress', res.reason, ExitReason.NO_PROGRESS);
  check('NOT max_turns', res.reason !== ExitReason.MAX_TURNS);
  const st = project(store, r);
  check('stopped well before the turn ceiling', st.budget.turns < 40, `${st.budget.turns} turns`);
  check('failure reason is in the log', store.events(r).some(e =>
    e.type === 'run.failed' && e.payload.reason === 'no_progress'));
  check('the explanation names the cause', /repeated/.test(
    store.events(r).find(e => e.type === 'run.failed')?.payload?.detail ?? ''),
    store.events(r).find(e => e.type === 'run.failed')?.payload?.detail);
  store.close();
}

describe('Phase G — N turns with no successful tool call terminates with no_progress');
{
  const { store, sandbox, tools } = mk('noprog');
  const r = uid(); store.createRun(r);
  const c = store.claim('w1', { runId: r });
  let i = 0;
  // asks for a DIFFERENT nonexistent tool each turn -> never repeats, never succeeds
  const wanderer = { name: 'wanderer', capabilities: new Set(),
    async invoke() { i++; return { content: `try ${i}`, finish: false, input_tokens: 5, output_tokens: 5,
      tool_calls: [{ id: `x${i}`, name: `nosuch_${i}`, args: {} }] }; } };
  const w = new Worker(store, { sandbox, model: wanderer, tools,
    authorize: createAuthorizer(), workerId: 'w1', maxTurns: 40, maxTurnsWithoutProgress: 4 });
  const res = await w.run(r, c.leaseToken, { input: 'go' });
  eq('terminated as no_progress', res.reason, ExitReason.NO_PROGRESS);
  check('detail mentions turns without a successful tool call',
    /no successful tool call/.test(res.detail ?? ''), res.detail);
  store.close();
}

describe('Phase G — a healthy run is NOT falsely flagged');
{
  const { store, sandbox, tools } = mk('healthy');
  const r = uid(); store.createRun(r);
  const c = store.claim('w1', { runId: r });
  const w = new Worker(store, { sandbox, model: makeScriptModel(), tools,
    authorize: createAuthorizer(), workerId: 'w1', maxTurns: 20 });
  const res = await w.run(r, c.leaseToken, { input: 'build the mini project' });
  eq('completed normally', res.status, 'completed');
  eq('reason is model_finished', res.reason, ExitReason.MODEL_FINISHED);
  check('no false no-progress', res.reason !== ExitReason.NO_PROGRESS);
  store.close();
}

describe('Phase G — max_turns remains a ceiling, distinct from no_progress');
{
  const { store, sandbox, tools } = mk('ceiling');
  const r = uid(); store.createRun(r);
  const c = store.claim('w1', { runId: r });
  let n = 0;
  // makes genuine progress every turn, but never finishes
  const busy = { name: 'busy', capabilities: new Set(),
    async invoke() { n++; return { content: `w${n}`, finish: false, input_tokens: 5, output_tokens: 5,
      tool_calls: [{ id: `t${n}`, name: 'write', args: { path: `f${n}.txt`, content: `${n}` } }] }; } };
  const w = new Worker(store, { sandbox, model: busy, tools, authorize: createAuthorizer(),
    workerId: 'w1', maxTurns: 6, maxRepeatedCalls: 3, maxTurnsWithoutProgress: 5 });
  const res = await w.run(r, c.leaseToken, { input: 'go' });
  eq('hit the ceiling, not the progress detector', res.reason, ExitReason.MAX_TURNS);
  check('work really was happening', project(store, r).budget.tool_calls >= 5);
  store.close();
}

process.exit(summary('recovery + no-progress', path.join(HERE, '../results-recovery.json')) ? 1 : 0);
