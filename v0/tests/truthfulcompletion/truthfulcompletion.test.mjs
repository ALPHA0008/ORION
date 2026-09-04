// WAVE 1 — D2/D3: the CLI must not report success for work it did not do.
//
// Measured on the published 0.1.2 (plan §1.4): a run whose model emitted an UNPARSED tool call
// touched nothing, and `orionctl run` printed `✓ model_finished`. The file was unchanged and the
// failing test still failed. The gate that prevents this (ADR-013) was implemented and tested,
// but the CLI never supplied a contract, so it was inert; and the shim that would have parsed
// the tool call existed but was never wired.
//
// These tests exercise the CLI's OWN wiring — `defaultCompletionContract` and `selectShims` —
// not a hand-built contract, because the defect was entirely in what the CLI passed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker, ExitReason } from '../../src/agent/loop/worker.mjs';
import { defaultCompletionContract, selectShims } from '../../src/cli/index.mjs';
import { applyGemmaToolCallShim } from '../../src/agent/model/shims/gemma-tool-calls.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'src', 'cli', 'index.mjs');
const BROKEN = 'export const add = (a, b) => a - b;\n';

/** Drive a run through the worker using the CLI's own default contract. */
async function runWith(responses, { seed = BROKEN } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'truthful-'));
  const sandbox = new LocalSandbox(path.join(dir, 'w'));
  sandbox.write('math.js', seed);
  const store = new Store(path.join(dir, 'run.db'));
  const runId = uid('run');
  store.createRun(runId, { task: 'fix add()' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  let i = 0;
  const model = { name: 'scripted', async invoke() {
    const r = responses[Math.min(i++, responses.length - 1)];
    return { input_tokens: 1, output_tokens: 1, ...(typeof r === 'function' ? r(sandbox) : r) };
  } };
  const worker = new Worker(store, {
    sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
    completionContract: defaultCompletionContract(store, runId),
    maxTurns: 6,
  });
  const res = await worker.run(runId, claim.leaseToken, { input: 'fix it' });
  return { res, store, runId, sandbox, dir };
}

const finish = (content = 'all done!') => ({ content, tool_calls: [], finish: true });
const call = (name, args) => ({ content: '', finish: false,
  tool_calls: [{ id: 'tc_' + Math.random().toString(16).slice(2, 8), name, args }] });

describe('truthfulcompletion/unperformed-work-is-not-success');
{
  // THE §1.4 CASE. The model says it is done, having called no tools at all.
  const { res, store, runId, sandbox } = await runWith([finish('I fixed it!')]);

  check('the run did NOT report completed', res.status !== 'completed', `${res.status}/${res.reason}`);
  eq('it failed as FINISHED_WITHOUT_CHANGE', res.reason, ExitReason.FINISHED_WITHOUT_CHANGE);
  check('the file really is untouched', sandbox.read('math.js') === BROKEN);

  const types = store.events(runId).map(e => e.type);
  check('exactly one bounded continuation was granted',
    types.filter(t => t === 'turn.started').length === 2,
    `${types.filter(t => t === 'turn.started').length} turns`);
  check('the continuation was recorded as a degradation', types.includes('degraded'));
  check('no run.completed event exists', !types.includes('run.completed'));
}

describe('truthfulcompletion/performed-work-is-success');
{
  // The mirror image: real work must still complete, or the gate is just a new way to lie.
  const FIXED = 'export const add = (a, b) => a + b;\n';
  const { res, store, runId, sandbox } = await runWith([
    call('write', { path: 'math.js', content: FIXED }),
    finish('fixed'),
  ]);

  eq('the run completed', res.status, 'completed');
  eq('it completed for the normal reason', res.reason, ExitReason.MODEL_FINISHED);
  check('the file was actually changed', sandbox.read('math.js') === FIXED);
  check('a mutating tool succeeded in the log',
    store.events(runId).some(e => e.type === 'tool.succeeded'));
}

describe('truthfulcompletion/read-only-work-is-not-punished');
{
  // A genuine analysis task must not be forced to fabricate a mutation. Demanding a world
  // change here would be dishonest in the opposite direction.
  const { res } = await runWith([
    call('read', { path: 'math.js' }),
    finish('this file subtracts instead of adding'),
  ]);
  eq('an analysis run completes', res.status, 'completed');
  eq('for the normal reason', res.reason, ExitReason.MODEL_FINISHED);
}

describe('truthfulcompletion/attempted-but-failed-mutation-is-not-success');
{
  // The agent tried to edit and the edit did not apply. That is not done.
  const { res, sandbox } = await runWith([
    call('edit', { path: 'math.js', old_string: 'NOT PRESENT ANYWHERE', new_string: 'x' }),
    finish('done!'),
  ]);
  check('a failed mutation does not complete the run', res.status !== 'completed',
    `${res.status}/${res.reason}`);
  check('the file is unchanged', sandbox.read('math.js') === BROKEN);
}

describe('truthfulcompletion/contract-is-replay-equivalent');
{
  // The predicate reads the durable event log, never the filesystem and never memory — so the
  // same decision is reconstructible. If it scanned the workspace, a fork or a replay on a
  // different machine would reach a different verdict.
  const { store, runId } = await runWith([finish('nothing done')]);
  const contract = defaultCompletionContract(store, runId);
  const a = contract.objectiveSatisfied();
  const b = contract.objectiveSatisfied();
  eq('the predicate is stable across calls', a, b);
  eq('and it reports the work as unsatisfied', a, false);
}

describe('truthfulcompletion/shim-selection');
{
  // D3 — the CLI must actually choose the shim.
  eq('a gemma model auto-selects the shim', selectShims('gemma4-31b', {}).length, 1);
  eq('the selected shim is the gemma one', selectShims('gemma4-31b', {})[0], applyGemmaToolCallShim);
  eq('a non-gemma model selects none', selectShims('gpt-4o-mini', {}).length, 0);
  eq('ORION_SHIMS=gemma forces it on', selectShims('gpt-4o-mini', { ORION_SHIMS: 'gemma' }).length, 1);
  eq('ORION_SHIMS=none forces it off', selectShims('gemma4-31b', { ORION_SHIMS: 'none' }).length, 0);
}

describe('truthfulcompletion/shim-parses-the-observed-payload');
{
  // The exact string the live vLLM endpoint returned in plan §1.4.
  const observed = '<|tool_call>call:read{path:<|"|>calc.py<|"|>}<tool_call|>';
  const out = applyGemmaToolCallShim({ content: observed, tool_calls: [], finish: true, ext: {} });
  eq('the raw text becomes one tool call', out.tool_calls.length, 1);
  eq('with the right name', out.tool_calls[0].name, 'read');
  eq('and the right argument', out.tool_calls[0].args.path, 'calc.py');
  check('the run is no longer treated as finished', out.finish !== true);
  check('the rewrite is marked for the degraded record', !!out.ext?.shimmed, String(out.ext?.shimmed));
}

describe('truthfulcompletion/cli-integration');
{
  // End-to-end through the real binary, mirroring §1.4: a model that produces no usable tool
  // call must make `orionctl run` report failure, not success.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'truthful-cli-'));
  const work = path.join(dir, 'w'); fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'calc.py'), 'def add(a, b):\n    return a - b\n');

  // A stub OpenAI-compatible endpoint that answers exactly as the live one did: prose only,
  // no tool_calls, finish_reason stop.
  const server = path.join(dir, 'server.mjs');
  fs.writeFileSync(server, `
import http from 'node:http';
http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id:'x', model:'stub', choices:[{ index:0, finish_reason:'stop',
      message:{ role:'assistant', content:'I have fixed the bug.', tool_calls: [] } }],
      usage:{ prompt_tokens:10, completion_tokens:5 } }));
  });
}).listen(8791, '127.0.0.1');
`);
  const srv = spawnSync(process.execPath, ['-e', `
const { spawn } = require('node:child_process');
const p = spawn(process.execPath, [${JSON.stringify(server)}], { detached:true, stdio:'ignore' });
p.unref(); console.log(p.pid);
`], { encoding: 'utf8' });
  const pid = Number((srv.stdout || '').trim());

  // Give the stub a moment to bind.
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},600)'], { timeout: 5_000 });

  const env = { ...process.env,
    ORION_HOME: path.join(dir, 'home'), ORION_WORKSPACE: work,
    ORION_BASE_URL: 'http://127.0.0.1:8791/v1', ORION_MODEL: 'stub', ORION_API_KEY: 'x' };
  const r = spawnSync(process.execPath, [CLI, 'run', 'fix the bug in calc.py'],
    { encoding: 'utf8', env, timeout: 120_000 });
  const out = (r.stdout || '') + (r.stderr || '');

  check('orionctl did NOT print a success tick', !/✓\s*model_finished/.test(out), out.slice(-160).replace(/\n/g, ' | '));
  check('orionctl reported the run as not finishing its work',
    /finished_without_change|failed/i.test(out), out.slice(-160).replace(/\n/g, ' | '));
  check('the file on disk is genuinely unchanged',
    fs.readFileSync(path.join(work, 'calc.py'), 'utf8').includes('a - b'));

  try { if (pid) process.kill(pid); } catch { /* already gone */ }
}

process.exit(summary('truthfulcompletion', path.join(HERE, '..', 'results-truthfulcompletion.json')) ? 1 : 0);
