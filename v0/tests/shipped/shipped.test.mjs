// SHIPPED CONFIGURATION — the wiring a developer actually runs.
//
// This suite exists because of a pattern, not a hunch. Across four waves the same class of defect
// recurred six times: a mechanism was built, tested in isolation, and never connected to the
// product path.
//
//   Wave 1  D2  the completion contract existed and the CLI passed none
//   Wave 1  D3  the provider shim existed and the CLI wired none
//   Wave 2      the shim could not express an array argument, found only in manual testing
//   Wave 3      compaction never fired on a real run, found only in manual testing
//   Wave 4  F1  `verify` bypassed the deployer's denyCommandPatterns entirely
//   Wave 4  F5  the provider seam and streaming were unreachable from the CLI
//
// Every one passed the module tests. So these assert the DEFAULT WIRING — what
// `orionctl run` composes — rather than the modules it composes. If a mechanism is not reachable
// from here, it is not shipped, whatever its own suite says.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools, toolDefinitions } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker, DEFAULT_SYSTEM, ExitReason } from '../../src/agent/loop/worker.mjs';
import { defaultCompletionContract, buildModel, streamEnabled, selectShims } from '../../src/cli/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROKEN = 'export const add = (a, b) => a - b;\n';
const FIXED  = 'export const add = (a, b) => a + b;\n';

const call = (name, args) => ({ content: '', finish: false,
  tool_calls: [{ id: 'tc_' + Math.random().toString(16).slice(2, 10), name, args }] });
const finish = (content = 'done') => ({ content, tool_calls: [], finish: true });

/** A run driven with the CLI's OWN contract, exactly as `orionctl run` composes it. */
async function shippedRun(responses, { posture = 'permissive' } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shipped-'));
  const sandbox = new LocalSandbox(path.join(d, 'w'));
  sandbox.write('math.js', BROKEN);
  const store = new Store(path.join(d, 'run.db'));
  let i = 0;
  const model = { name: 'scripted', provider: 'test', capabilities: new Set(['tools']),
    async invoke() {
      const r = responses[Math.min(i++, responses.length - 1)];
      return { input_tokens: 1, output_tokens: 1, ...(typeof r === 'function' ? r(sandbox) : r) };
    } };
  const runId = uid('run');
  store.createRun(runId, { task: 'fix add()' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  const res = await new Worker(store, {
    sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture, escalateUnsafeRecovery: false }),
    completionContract: defaultCompletionContract(store, runId),   // the SHIPPED contract
    maxTurns: 10,
  }).run(runId, claim.leaseToken, { input: 'fix it' });
  return { res, store, runId, sandbox };
}

// ═════════════════════════════════════ F1 — the deployer's policy reaches command-bearing tools
describe('shipped/F1-deny-patterns-apply-to-every-command-bearing-tool');
{
  // ROOT CAUSE: the authorizer gated hard denials on `action.name === 'bash'`, and the worker set
  // `action.command` only for bash. So a deployed policy — "never git push", "never npm publish" —
  // was enforced for `bash` and silently NOT for `verify`, which also runs shell commands.
  const policy = createAuthorizer({ posture: 'strict',
    denyCommandPatterns: [/\bgit\s+push\b/, /\bnpm\s+publish\b/] });

  for (const posture of ['permissive', 'auto', 'strict']) {
    const p = createAuthorizer({ posture, denyCommandPatterns: [/\bgit\s+push\b/] });
    for (const tool of ['bash', 'verify']) {
      const d = p({ kind: 'tool', name: tool, command: 'git push --force origin main',
                    args_digest: 'x', effects: tool === 'bash' ? 'Mutating' : 'ReadOnly' }, {});
      eq(`F1: ${tool} denied at ${posture} posture`, d.decision, 'deny');
    }
  }

  // The policy must not become a blunt instrument: a legitimate check still runs.
  for (const cmd of ['npm test', 'py -m pytest -q', 'make check']) {
    eq(`F1: legitimate verify "${cmd}" still allowed`,
      policy({ kind: 'tool', name: 'verify', command: cmd, args_digest: 'x', effects: 'ReadOnly' }, {}).decision,
      'allow');
  }

  // And a tool with no command at all is unaffected.
  eq('F1: a command-less tool is untouched',
    policy({ kind: 'tool', name: 'read', args_digest: 'x', effects: 'ReadOnly' }, {}).decision, 'allow');
}

describe('shipped/F1c-the-command-actually-REACHES-the-authorizer');
{
  // The authorizer can only enforce what the worker hands it. This asserts the worker's action
  // construction end-to-end: a `verify` call must arrive at the policy WITH its command, or the
  // fix above is inert in the product exactly as it was before.
  const seen = [];
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shipped-cmd-'));
  const sandbox = new LocalSandbox(path.join(d, 'w'));
  sandbox.write('math.js', BROKEN);
  const store = new Store(path.join(d, 'run.db'));
  let i = 0;
  const responses = [call('verify', { cmd: 'git push --force' }), finish('done')];
  const model = { name: 's', provider: 'test', capabilities: new Set(['tools']),
    async invoke() { const r = responses[Math.min(i++, responses.length - 1)];
                     return { input_tokens: 1, output_tokens: 1, ...r }; } };
  const runId = uid('run');
  store.createRun(runId, { task: 't' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
    authorize: (action, ctx) => {
      seen.push({ name: action.name, command: action.command });
      return createAuthorizer({ posture: 'strict', denyCommandPatterns: [/\bgit\s+push\b/] })(action, ctx);
    },
    completionContract: defaultCompletionContract(store, runId), maxTurns: 3,
  }).run(runId, claim.leaseToken, { input: 'go' });

  const verifyAction = seen.find(a => a.name === 'verify');
  check('F1c: the verify action reached the authorizer', !!verifyAction, JSON.stringify(seen));
  eq('F1c: carrying its command', verifyAction?.command, 'git push --force');
  check('F1c: and the run recorded the denial',
    store.events(runId).some(e => e.type === 'tool.denied'),
    store.events(runId).map(e => e.type).join(','));
}

// ═════════════════════════════════════ F4 — the shipped completion verdict
describe('shipped/F4-completion-verdict-at-DEFAULT-wiring');
{
  // Wave 1 made the runtime stop reporting success for work it did not do. Wave 2 then made a
  // declared plan the ONLY objective, which swung the same truthfulness the other way: a run
  // that edited the file AND got a verify PASS was recorded FAILED because the model never
  // called `plan_step`. Under-claiming is as untruthful as over-claiming, and worse for a user —
  // they cannot tell a real failure from an unticked box.

  // (a) plan declared and satisfied -> complete
  {
    const { res } = await shippedRun([
      call('plan', { goal: 'fix add()', steps: ['fix it'] }),
      call('write', { path: 'math.js', content: FIXED }),
      call('plan_step', { step: '1', state: 'done', evidence: 'wrote a + b' }),
      finish('done'),
    ]);
    eq('F4a: plan satisfied -> completed', res.status, 'completed');
  }

  // (b) THE REGRESSION: real verified work, but the model never marked the step.
  {
    const { res, sandbox } = await shippedRun([
      call('plan', { goal: 'fix add()', steps: ['fix it', 'prove it'] }),
      call('write', { path: 'math.js', content: FIXED }),
      call('verify', { cmd: 'echo TESTS_OK' }),
      finish('I fixed it and the tests pass'),
    ]);
    eq('F4b: verified work without plan_step -> completed', res.status, 'completed');
    check('F4b: and the file really was changed', sandbox.read('math.js') === FIXED);
  }

  // (c) an unfinished plan with NO verified work is still unfinished — the Wave 2 guarantee.
  {
    const { res } = await shippedRun([
      call('plan', { goal: 'fix add()', steps: ['fix it', 'prove it'] }),
      call('write', { path: 'math.js', content: FIXED }),
      finish('good enough'),
    ]);
    check('F4c: mutation without verify and without plan_step -> NOT completed',
      res.status !== 'completed', `${res.status}/${res.reason}`);
  }

  // (d) THE WAVE 1 GUARANTEE, intact: doing nothing is never success.
  {
    const { res, sandbox } = await shippedRun([finish('I fixed it!')]);
    eq('F4d: unperformed work still fails', res.reason, ExitReason.FINISHED_WITHOUT_CHANGE);
    check('F4d: and the file is untouched', sandbox.read('math.js') === BROKEN);
  }

  // (e) an explicitly FAILED step still blocks, even with a verified mutation. That is the
  //     model's own report of incompleteness, not a missing tick.
  {
    const { res } = await shippedRun([
      call('plan', { goal: 'fix add()', steps: ['fix it', 'prove it'] }),
      call('write', { path: 'math.js', content: FIXED }),
      call('verify', { cmd: 'echo TESTS_OK' }),
      call('plan_step', { step: '2', state: 'failed', evidence: 'could not prove it' }),
      finish('done-ish'),
    ]);
    check('F4e: an explicitly failed step still blocks completion',
      res.status !== 'completed', `${res.status}/${res.reason}`);
  }

  // (f) no plan at all, mutation succeeded -> complete (the Wave 1 path is untouched).
  {
    const { res } = await shippedRun([
      call('write', { path: 'math.js', content: FIXED }),
      finish('fixed'),
    ]);
    eq('F4f: no plan + mutation -> completed', res.status, 'completed');
  }
}

// ═════════════════════════════════════ F5 — Wave 4 is reachable from the product
describe('shipped/F5-provider-and-streaming-are-reachable-from-the-CLI');
{
  // Wave 4 built a provider seam and a second provider; the CLI then hardcoded
  // createOpenAICompatModel. The capability existed in the library and not in the product.
  eq('F5: the default provider is openai-compat',
    buildModel({ ORION_BASE_URL: 'http://x/v1', ORION_MODEL: 'm' }).provider, 'openai-compat');
  eq('F5: ORION_PROVIDER selects anthropic',
    buildModel({ ORION_PROVIDER: 'anthropic', ORION_API_KEY: 'k' }).provider, 'anthropic');
  check('F5: anthropic gets a default endpoint so a key alone is enough',
    /api\.anthropic\.com/.test(buildModel({ ORION_PROVIDER: 'anthropic', ORION_API_KEY: 'k' }).endpoint));

  eq('F5: streaming is ON by default from the product surface', streamEnabled({}), true);
  eq('F5: ORION_STREAM=off disables it', streamEnabled({ ORION_STREAM: 'off' }), false);
  eq('F5: ORION_STREAM=0 disables it', streamEnabled({ ORION_STREAM: '0' }), false);

  // The shim wiring (Wave 1 D3) must still be reachable from the same path.
  eq('F5: the gemma shim is still auto-selected', selectShims('gemma4-31b', {}).length, 1);
}

describe('shipped/F5b-capability-sets-match-the-implementation');
{
  // The two were INVERTED: openai-compat implemented invokeStream without advertising it, and
  // anthropic advertised streaming without implementing it. Capability negotiation was therefore
  // meaningless in both directions — the capable provider was never asked to stream and the
  // incapable one would have been.
  for (const [label, m] of [
    ['openai-compat', buildModel({ ORION_BASE_URL: 'http://x/v1', ORION_MODEL: 'm' })],
    ['anthropic',     buildModel({ ORION_PROVIDER: 'anthropic', ORION_API_KEY: 'k' })],
  ]) {
    const declares = m.capabilities.has('streaming');
    const implements_ = typeof m.invokeStream === 'function';
    eq(`F5b: ${label} declaration matches implementation`, declares, implements_);
  }
}

// ═════════════════════════════════════ F3d — the prompt and the toolset must not drift
describe('shipped/F3d-the-shipped-prompt-matches-the-shipped-tools');
{
  // A tool the prompt never mentions competes with `bash` on equal footing — which is exactly
  // why `verify` went unused until Wave 2 named it. Drift here is silent and only shows up as
  // "the model does not use the feature".
  const tools = Object.keys(makeTools(new LocalSandbox(fs.mkdtempSync(path.join(os.tmpdir(), 's-')))));
  for (const t of ['read', 'write', 'edit', 'grep', 'bash', 'verify', 'plan', 'plan_step', 'ask_user'])
    check(`F3d: ${t} is a shipped tool`, tools.includes(t), tools.join(','));

  for (const mention of ['plan', 'plan_step', 'verify'])
    check(`F3d: the default system prompt names '${mention}'`,
      DEFAULT_SYSTEM.includes(`'${mention}'`), 'prompt drift');

  check('F3d: the prompt states the completion rule',
    /not the same as doing it|recorded as unfinished/i.test(DEFAULT_SYSTEM));

  // Every quoted term in the prompt must name something that EXISTS — a shipped tool or one of
  // its argument names. Telling the model to call a tool that is not registered, or to pass an
  // argument no schema accepts, is drift the model can only obey by failing.
  const toolset = makeTools(new LocalSandbox(fs.mkdtempSync(path.join(os.tmpdir(), 's2-'))));
  const argNames = new Set(
    Object.values(toolset).flatMap(t => Object.keys(t.schema?.properties ?? {})));
  const known = new Set([...tools, ...argNames]);
  const named = [...DEFAULT_SYSTEM.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  const unknown = [...new Set(named.filter(n => !known.has(n)))];
  eq('F3d: every quoted term names a real tool or argument', unknown.join(','), '');
}

process.exit(summary('shipped', path.join(HERE, '..', 'results-shipped.json')) ? 1 : 0);
