// WAVE 4a — provider abstraction + request provenance.
//
// The claim: the runtime is provider-agnostic in fact, not just in comment. A second provider with
// a GENUINELY DIFFERENT wire format must pass through the same seam and produce the same
// ModelResult, with no vendor knowledge anywhere in the loop.
//
// Anthropic was chosen to FALSIFY the abstraction, not to add coverage. Its format differs where a
// leaky seam would show: the system prompt is out-of-band, tool results are content blocks, tool
// calls come back as `tool_use` blocks, and the stop reason is named differently. A second
// OpenAI-compatible endpoint would have proved nothing.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools, toolDefinitions } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { fork } from '../../src/core/replay/index.mjs';
import {
  createProvider, PROVIDER_KINDS, toAnthropicRequest, fromAnthropicResponse,
} from '../../src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../src/agent/model/shims/gemma-tool-calls.mjs';
import { requestDigest, endpointHost, stableStringify } from '../../src/core/projection/artifacts.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROKEN = 'export const add = (a, b) => a - b;\n';
const FIXED  = 'export const add = (a, b) => a + b;\n';

/** A stub server that answers in the shape the given provider expects. */
async function stubServer(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const reply = handler(JSON.parse(body || '{}'), req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  return { server, port, close: () => new Promise((r) => server.close(r)) };
}

describe('providers/P6-unknown-kind-fails-at-construction');
{
  // A misconfigured provider that only failed at first call would burn a run and leave a
  // confusing trajectory. It must fail while it is still just a config mistake.
  let threw = null;
  try { createProvider({ kind: 'bogus' }); } catch (e) { threw = e; }
  check('an unknown kind throws', !!threw);
  check('the message names the known kinds', /openai-compat/.test(String(threw?.message)),
    String(threw?.message).slice(0, 70));
  eq('exactly two providers are offered', PROVIDER_KINDS.length, 2);
}

describe('providers/anthropic-wire-translation');
{
  // The translation is where all the vendor knowledge lives. If any of this leaked into the core,
  // the abstraction would be nominal.
  const messages = [
    { role: 'system', content: 'you are a coding agent' },
    { role: 'user', content: 'fix it' },
    { role: 'assistant', content: 'reading',
      tool_calls: [{ id: 'tc1', type: 'function',
                     function: { name: 'read', arguments: JSON.stringify({ path: 'a.js' }) } }] },
    { role: 'tool', tool_call_id: 'tc1', content: 'file contents' },
  ];
  const tools = toolDefinitions(makeTools(new LocalSandbox(fs.mkdtempSync(path.join(os.tmpdir(), 'p-')))));
  const body = toAnthropicRequest({ messages, tools, model: 'claude-sonnet-5' });

  eq('the system prompt is hoisted out of the message list', body.system, 'you are a coding agent');
  check('no message retains role "system"', !body.messages.some(m => m.role === 'system'));
  check('no message retains role "tool"', !body.messages.some(m => m.role === 'tool'));

  const asst = body.messages.find(m => m.role === 'assistant');
  check('the tool CALL became a tool_use block',
    asst.content.some(b => b.type === 'tool_use' && b.name === 'read'));
  check('accompanying prose is preserved, not dropped',
    asst.content.some(b => b.type === 'text' && b.text === 'reading'));

  const userBlocks = body.messages.filter(m => m.role === 'user' && Array.isArray(m.content));
  check('the tool RESULT became a tool_result block',
    userBlocks.some(m => m.content.some(b => b.type === 'tool_result' && b.tool_use_id === 'tc1')));
  check('tool definitions use input_schema', body.tools.every(t => !!t.input_schema && !t.function));
}

describe('providers/P2-structurally-identical-ModelResult');
{
  // Both providers must produce the same SHAPE. If they diverge, every downstream consumer —
  // the projection, the shims, the completion contract — has to learn which provider ran.
  const oa = { id: 'x', model: 'm', choices: [{ index: 0, finish_reason: 'tool_calls',
    message: { role: 'assistant', content: 'ok',
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 } };
  const an = { id: 'y', model: 'claude', stop_reason: 'tool_use',
    content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'read', input: { path: 'a' } }],
    usage: { input_tokens: 10, output_tokens: 5 } };

  // Normalise each through its own path.
  const fromAnthropic = fromAnthropicResponse(an, { duration_ms: 5, attempts: 1 });
  // The OpenAI normaliser is internal; assert against the documented ModelResult contract instead.
  const REQUIRED = ['content', 'tool_calls', 'finish', 'finish_reason',
                    'input_tokens', 'output_tokens', 'cache_read_tokens', 'cost_usd',
                    'duration_ms', 'ext'];
  for (const k of REQUIRED) check(`anthropic result has ${k}`, k in fromAnthropic, typeof fromAnthropic[k]);

  eq('content matches', fromAnthropic.content, 'ok');
  eq('one tool call', fromAnthropic.tool_calls.length, 1);
  eq('tool call name', fromAnthropic.tool_calls[0].name, 'read');
  eq('tool call args', JSON.stringify(fromAnthropic.tool_calls[0].args), '{"path":"a"}');
  eq('tokens normalised', `${fromAnthropic.input_tokens}/${fromAnthropic.output_tokens}`, '10/5');
  check('finish is FALSE when tool calls are present', fromAnthropic.finish === false);

  // The `finish` semantics must agree across providers: "the model stopped and asked for nothing".
  const done = fromAnthropicResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }],
    usage: { input_tokens: 1, output_tokens: 1 } }, {});
  check('finish is TRUE when the model ends its turn', done.finish === true);
}

describe('providers/P5-shims-still-apply-and-are-provider-agnostic');
{
  // A shim is written against ModelResult, so it must work regardless of which provider produced
  // it. That is the payoff of normalising BEFORE shimming.
  const observed = '<|tool_call>call:read{path:<|"|>calc.py<|"|>}<tool_call|>';
  const viaAnthropicShape = fromAnthropicResponse(
    { stop_reason: 'end_turn', content: [{ type: 'text', text: observed }], usage: {} }, {});
  const shimmed = applyGemmaToolCallShim(viaAnthropicShape);
  eq('the shim parsed a tool call out of an ANTHROPIC-shaped result', shimmed.tool_calls.length, 1);
  eq('with the right name', shimmed.tool_calls[0].name, 'read');
  check('and marked itself for the degraded record', !!shimmed.ext?.shimmed, String(shimmed.ext?.shimmed));
}

describe('providers/P4-capability-negotiation-is-explicit');
{
  const noStream = createProvider({ kind: 'openai-compat', baseUrl: 'http://x/v1', model: 'm',
    capabilities: ['tools'] });
  const streams = createProvider({ kind: 'anthropic', apiKey: 'k', model: 'c' });
  check('a provider states what it cannot do', !noStream.capabilities.has('streaming'));
  check('and what it can', streams.capabilities.has('streaming'));
  check('both declare their provider identity',
    noStream.provider === 'openai-compat' && streams.provider === 'anthropic');
}

describe('providers/P1-P3-a-real-task-completes-through-BOTH-providers');
{
  // The end-to-end proof: the same scripted task, driving real tools, through two wire formats.
  const results = {};
  for (const kind of ['openai-compat', 'anthropic']) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), `prov-${kind}-`));
    const sandbox = new LocalSandbox(path.join(d, 'w'));
    sandbox.write('math.js', BROKEN);
    const store = new Store(path.join(d, 'run.db'));

    let turn = 0;
    const { port, close } = await stubServer((body) => {
      turn++;
      if (kind === 'openai-compat') {
        return turn === 1
          ? { id: 'x', model: 'm', choices: [{ index: 0, finish_reason: 'tool_calls', message: {
              role: 'assistant', content: '', tool_calls: [{ id: 'w1', type: 'function',
                function: { name: 'write', arguments: JSON.stringify({ path: 'math.js', content: FIXED }) } }] } }],
              usage: { prompt_tokens: 5, completion_tokens: 5 } }
          : { id: 'x', model: 'm', choices: [{ index: 0, finish_reason: 'stop',
              message: { role: 'assistant', content: 'fixed', tool_calls: [] } }],
              usage: { prompt_tokens: 5, completion_tokens: 5 } };
      }
      // Anthropic shape — and assert the REQUEST arrived translated (P3).
      results.anthropicRequestSeen = body;
      return turn === 1
        ? { id: 'y', model: 'claude', stop_reason: 'tool_use', content: [
            { type: 'tool_use', id: 'w1', name: 'write', input: { path: 'math.js', content: FIXED } }],
            usage: { input_tokens: 5, output_tokens: 5 } }
        : { id: 'y', model: 'claude', stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'fixed' }], usage: { input_tokens: 5, output_tokens: 5 } };
    });

    const model = kind === 'openai-compat'
      ? createProvider({ kind, baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm' })
      : createProvider({ kind, baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'claude' });

    const runId = uid('run');
    store.createRun(runId, { task: 'fix add()' });
    const claim = store.claim('w', { runId, leaseMs: 60_000 });
    const res = await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
      authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
      maxTurns: 6 }).run(runId, claim.leaseToken, { input: 'fix it' });
    await close();

    results[kind] = { res, store, runId, sandbox };
    eq(`${kind}: the run completed`, res.status, 'completed');
    check(`${kind}: the file was ACTUALLY changed`, sandbox.read('math.js') === FIXED);
  }

  // P3 — the request really did arrive in Anthropic's shape.
  const seen = results.anthropicRequestSeen ?? {};
  check('P3: the Anthropic endpoint received tool_result content blocks',
    JSON.stringify(seen).includes('tool_result'), Object.keys(seen).join(','));
  check('P3: and input_schema tool definitions', JSON.stringify(seen).includes('input_schema'));

  // Both trajectories record their provider.
  for (const kind of ['openai-compat', 'anthropic']) {
    const { store, runId } = results[kind];
    const req = store.events(runId).find(e => e.type === 'model.requested');
    eq(`${kind}: model.requested names the provider`, req.payload.provider, kind);
  }
}

describe('providers/V1-V3-request-provenance');
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-v-'));
  const sandbox = new LocalSandbox(path.join(d, 'w'));
  sandbox.write('math.js', BROKEN);
  const store = new Store(path.join(d, 'run.db'));
  const { port, close } = await stubServer(() => ({ id: 'x', model: 'm',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done', tool_calls: [] } }],
    usage: { prompt_tokens: 3, completion_tokens: 2 } }));

  // A credential in userinfo — the leak this must not reproduce.
  const model = createProvider({ kind: 'openai-compat',
    baseUrl: `http://someuser:SUPERSECRET@127.0.0.1:${port}/v1`, apiKey: 'sk-THIS-IS-SECRET', model: 'm' });
  const runId = uid('run');
  store.createRun(runId, { task: 't' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: 'permissive' }), maxTurns: 2 })
    .run(runId, claim.leaseToken, { input: 'go' });
  await close();

  const events = store.events(runId);
  const req = events.find(e => e.type === 'model.requested');
  const p = req.payload;

  // V1
  for (const k of ['provider', 'endpoint_host', 'request_digest', 'params', 'messages', 'tools', 'context_bytes'])
    check(`V1: model.requested carries ${k}`, k in p, JSON.stringify(p[k]));
  eq('V1: params carry temperature', p.params.temperature, 0);
  check('V1: params carry max_tokens', Number.isInteger(p.params.max_tokens));
  check('V1: context_bytes is real', p.context_bytes > 0, String(p.context_bytes));

  // V2 — THE LEAK SCAN. Nothing secret may appear anywhere in the log.
  const wholeLog = JSON.stringify(events);
  check('V2: the api key never appears in the log', !wholeLog.includes('sk-THIS-IS-SECRET'));
  check('V2: userinfo credentials never appear', !wholeLog.includes('SUPERSECRET'));
  // Assert on UNREDACTED userinfo. The earlier form matched `http://<redacted>@...` as well,
  // which is the fix, not the leak — a scan that flags its own remedy is worse than none.
  const unredactedUserinfo = /https?:\/\/(?!<redacted>@)[^/\s"@]+@/;
  check('V2: no unredacted userinfo survives anywhere in the log',
    !unredactedUserinfo.test(wholeLog),
    (wholeLog.match(unredactedUserinfo) ?? ['none'])[0]);
  check('V2: where a URL was echoed by the provider, it was redacted',
    !wholeLog.includes('someuser'), 'username scrubbed');
  eq('V2: only the HOST was recorded', p.endpoint_host, `127.0.0.1:${port}`);

  // V3 — digest sensitivity.
  const base = { messages: [{ role: 'user', content: 'hi' }], tools: [], params: { temperature: 0 } };
  eq('V3: identical requests digest identically', requestDigest(base), requestDigest(structuredClone(base)));
  check('V3: one changed message changes the digest',
    requestDigest(base) !== requestDigest({ ...base, messages: [{ role: 'user', content: 'HI' }] }));
  check('V3: a changed param changes the digest',
    requestDigest(base) !== requestDigest({ ...base, params: { temperature: 1 } }));
  eq('V3: key order does not affect the digest',
    stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
}

describe('providers/V4-digest-is-reproducible-under-replay-and-fork');
{
  // The digest must be a property of the EVENTS, not of the process that produced them —
  // otherwise it could not be used to compare two runs after the fact.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-v4-'));
  const sandbox = new LocalSandbox(path.join(d, 'w'));
  sandbox.write('math.js', BROKEN);
  const store = new Store(path.join(d, 'run.db'));
  const { port, close } = await stubServer(() => ({ id: 'x', model: 'm',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done', tool_calls: [] } }],
    usage: { prompt_tokens: 3, completion_tokens: 2 } }));
  const model = createProvider({ kind: 'openai-compat', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm' });
  const runId = uid('run');
  store.createRun(runId, { task: 't' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: 'permissive' }), maxTurns: 2 })
    .run(runId, claim.leaseToken, { input: 'go' });
  await close();

  const digestOf = (evts) => evts.find(e => e.type === 'model.requested')?.payload?.request_digest;
  const original = digestOf(store.events(runId));
  check('a digest was recorded', !!original, String(original).slice(0, 16));

  // A separate reader of the same log.
  const storeB = new Store(path.join(d, 'run.db'));
  eq('V4: an independent reader sees the identical digest', digestOf(storeB.events(runId)), original);

  // And a fork inherits it unchanged — the digest travels with the history.
  // Fork AFTER the model.requested event: forking before it would inherit a history that never
  // contained a digest, which would test nothing.
  const reqSeq = store.events(runId).find(e => e.type === 'model.requested').seq;
  const f = fork(store, runId, reqSeq + 1);
  eq('V4: a fork inherits the identical digest', digestOf(store.events(f.run_id)), original);
}

process.exit(summary('providers', path.join(HERE, '..', 'results-providers.json')) ? 1 : 0);
