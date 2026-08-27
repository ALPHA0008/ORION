// Phase H / §11 — the model CLIENT path over real HTTP.
//
// SCOPE: this exercises our client against a real HTTP server that speaks the
// OpenAI wire format and misbehaves on demand. It does NOT test real LLM behaviour.
// Tests 1–6 below are the runtime-facing half of §11; the model-behaviour half
// requires credentials and is recorded as blocked in V0-READINESS.md.
import path from 'node:path'; import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker, ExitReason, repairOrphans } from '../../src/agent/loop/worker.mjs';
import { project, WINDOW, MSG_CLAMP } from '../../src/core/projection/index.mjs';
import { createOpenAICompatModel, ModelError } from '../../src/agent/model/index.mjs';
import { startFakeProvider, projectScript } from '../_helpers/fake-provider.mjs';
import { describe, check, eq, summary, tmpdir } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = tmpdir('provider');
const mk = (tag) => {
  const d = path.join(DIR, tag); fs.mkdirSync(d, { recursive: true });
  const store = new Store(path.join(d, 'h.db'), { durability: 'normal' });
  const sandbox = new LocalSandbox(path.join(d, 'work'));
  return { store, sandbox, tools: makeTools(sandbox) };
};
const mdl = (prov, o = {}) => createOpenAICompatModel({ baseUrl: prov.url, model: 'fake-1',
  pricing: { in_per_mtok: 1, out_per_mtok: 3 }, maxRetries: 3, timeoutMs: 2000, ...o });

// ══════════════════════════ Test 1 — simple multi-step tool task
describe('Test 1 — multi-step tool task over real HTTP');
{
  const prov = await startFakeProvider({ script: projectScript() });
  const { store, sandbox, tools } = mk('t1');
  const r = uid(); store.createRun(r, { task: 'mini project' });
  const c = store.claim('w', { runId: r });
  const res = await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 15 }).run(r, c.leaseToken, { input: 'build it' });

  eq('run completed', res.status, 'completed');
  const st = project(store, r);
  check('model calls recorded', st.budget.model_calls >= 4, `${st.budget.model_calls}`);
  check('tool calls recorded', st.budget.tool_calls >= 3, `${st.budget.tool_calls}`);
  check('tokens accounted', st.budget.tokens > 0, `${st.budget.tokens}`);
  check('cost accounted (promoted to core, ADR-004)', st.budget.cost_usd > 0, `$${st.budget.cost_usd}`);
  check('cache tokens captured', st.budget.cache_read_tokens > 0, `${st.budget.cache_read_tokens}`);
  check('world state correct', sandbox.read('b.txt').includes('VALUE=20'));
  check('run terminated cleanly', ['completed'].includes(store.run(r).status));
  await prov.close(); store.close();
}

// ══════════════════════════ Test 2 — invalid tool arguments
describe('Test 2 — provider emits unparseable tool arguments');
{
  const prov = await startFakeProvider({ script: projectScript(), faults: ['bad-tool-json'] });
  const { store, sandbox, tools } = mk('t2');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const res = await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 15 }).run(r, c.leaseToken, { input: 'go' });

  const failed = store.events(r).filter(e => e.type === 'tool.failed');
  check('bad arguments produce an explicit tool.failed', failed.length >= 1, failed[0]?.payload?.error?.slice(0, 60));
  check('error names the cause', /unparseable arguments/.test(failed[0]?.payload?.error ?? ''));
  check('run state remains valid (reached a terminal state)',
    ['completed', 'failed'].includes(res.status), res.status);
  const st = project(store, r);
  eq('no dangling in-flight tool calls', Object.keys(st.pending_tool_calls).length, 0);
  await prov.close(); store.close();
}

describe('Test 2b — schema validation rejects wrong-typed / missing args');
{
  const prov = await startFakeProvider({ script: () => ({ content: 'x',
    tool_calls: [{ name: 'write', args: { path: 42 } }] }) });   // wrong type + missing content
  const { store, sandbox, tools } = mk('t2b');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  await new Worker(store, { sandbox, model: mdl(prov), tools, authorize: createAuthorizer(),
    workerId: 'w', maxTurns: 6, maxRepeatedCalls: 2 }).run(r, c.leaseToken, { input: 'go' });
  const f = store.events(r).find(e => e.type === 'tool.failed');
  check('invalid args caught before execution', /invalid arguments/.test(f?.payload?.error ?? ''), f?.payload?.error);
  check('both problems reported', /missing required property: content/.test(f?.payload?.error ?? '') &&
    /path must be string/.test(f?.payload?.error ?? ''), f?.payload?.error);
  check('nothing was written to disk', !sandbox.exists('42'));
  await prov.close(); store.close();
}

// ══════════════════════════ Test 3 — tool failure, model adapts
describe('Test 3 — tool fails; the failure reaches the model and the run stays valid');
{
  let sawError = false;
  const prov = await startFakeProvider({ script: ({ messages }) => {
    const toolText = messages.filter(m => m.role === 'tool').map(m => String(m.content)).join('\n');
    if (toolText.includes('wrote recovered.txt')) return { content: 'done', tool_calls: [], finish: true };
    if (/ERROR|not found/.test(toolText)) { sawError = true;
      return { content: 'I saw the error; writing the file instead',
               tool_calls: [{ name: 'write', args: { path: 'recovered.txt', content: 'ok' } }] }; }
    return { content: 'reading a missing file', tool_calls: [{ name: 'read', args: { path: 'missing.txt' } }] };
  } });
  const { store, sandbox, tools } = mk('t3');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const res = await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 10 }).run(r, c.leaseToken, { input: 'go' });

  check('tool failure recorded explicitly', store.events(r).some(e => e.type === 'tool.failed'));
  check('the failure was surfaced to the model', sawError);
  check('the agent adapted and recovered', sandbox.exists('recovered.txt'));
  eq('run completed', res.status, 'completed');
  const st = project(store, r);
  check('message array stayed consistent', st.recent_messages.filter(m => m.role === 'tool').length >= 2);
  await prov.close(); store.close();
}

// ══════════════════════════ Test 4 — authorization denial
describe('Test 4 — denial is enforced by the seam, not by the model');
{
  const prov = await startFakeProvider({ script: () => ({ content: 'deleting',
    tool_calls: [{ name: 'bash', args: { cmd: 'rm -rf /' } }] }) });
  const { store, sandbox, tools } = mk('t4');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const res = await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 6, maxRepeatedCalls: 2 }).run(r, c.leaseToken, { input: 'go' });

  const denied = store.events(r).find(e => e.type === 'tool.denied');
  check('tool.denied emitted', !!denied, denied?.payload?.reason);
  check('hard-deny pattern matched', /hard-deny/.test(denied?.payload?.reason ?? ''));
  check('no tool.started for the denied call',
    !store.events(r).some(e => e.type === 'tool.started' && e.payload?.name === 'bash'));
  check('the model could not bypass the seam', res.reason === ExitReason.NO_PROGRESS, res.reason);
  await prov.close(); store.close();
}

describe('Test 4b — denial in a permissive posture still blocks hard-denies');
{
  const prov = await startFakeProvider({ script: () => ({ content: 'x',
    tool_calls: [{ name: 'bash', args: { cmd: 'mkfs.ext4 /dev/sda' } }] }) });
  const { store, sandbox, tools } = mk('t4b');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer({ posture: 'permissive' }), workerId: 'w',
    maxTurns: 4, maxRepeatedCalls: 2 }).run(r, c.leaseToken, { input: 'go' });
  check('hard denial applies even at the most permissive posture',
    store.events(r).some(e => e.type === 'tool.denied'));
  await prov.close(); store.close();
}

// ══════════════════════════ Test 5 — no-progress with a real provider
describe('Test 5 — model keeps asking for an unavailable action -> no_progress');
{
  const prov = await startFakeProvider({ script: () => ({ content: 'again',
    tool_calls: [{ name: 'deploy_to_prod', args: { env: 'prod' } }] }) });
  const { store, sandbox, tools } = mk('t5');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const res = await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 30, maxRepeatedCalls: 3 }).run(r, c.leaseToken, { input: 'deploy' });
  eq('terminated as no_progress', res.reason, ExitReason.NO_PROGRESS);
  check('did not burn the full turn budget', project(store, r).budget.model_calls < 30,
    `${project(store, r).budget.model_calls} model calls`);
  check('unknown tool reported helpfully',
    /unknown tool/.test(store.events(r).find(e => e.type === 'tool.failed')?.payload?.error ?? ''));
  await prov.close(); store.close();
}

// ══════════════════════════ Test 6 — provider failures
describe('Test 6 — rate limit (429) is retried and degraded is emitted');
{
  const prov = await startFakeProvider({ script: projectScript(), faults: ['429', '429'] });
  const { store, sandbox, tools } = mk('t6a');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const res = await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 15 }).run(r, c.leaseToken, { input: 'go' });
  eq('run still completed', res.status, 'completed');
  check('provider saw the retries', prov.callCount > 4, `${prov.callCount} HTTP calls`);
  await prov.close(); store.close();
}

describe('Test 6b — 5xx is retried; exhaustion is an explicit model.failed');
{
  const prov = await startFakeProvider({ script: projectScript(),
    faults: ['500', '500', '500', '500', '500', '500'] });
  const { store, sandbox, tools } = mk('t6b');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const res = await new Worker(store, { sandbox, model: mdl(prov, { maxRetries: 1 }), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 4 }).run(r, c.leaseToken, { input: 'go' });
  const mf = store.events(r).filter(e => e.type === 'model.failed');
  check('model.failed recorded', mf.length >= 1, mf[0]?.payload?.error);
  check('classified as retryable server_error', mf[0]?.payload?.kind === 'server_error', mf[0]?.payload?.kind);
  check('degraded emitted for the retry', store.events(r).some(e =>
    e.type === 'degraded' && e.payload?.subsystem === 'model'));
  check('run reached a terminal state', ['failed', 'completed'].includes(res.status), res.status);
  await prov.close(); store.close();
}

describe('Test 6c — malformed JSON body is retryable');
{
  const prov = await startFakeProvider({ script: projectScript(), faults: ['malformed'] });
  const { store, sandbox, tools } = mk('t6c');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const res = await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 15 }).run(r, c.leaseToken, { input: 'go' });
  eq('recovered and completed', res.status, 'completed');
  await prov.close(); store.close();
}

describe('Test 6d — timeout aborts and is retried');
{
  const prov = await startFakeProvider({ script: projectScript(), faults: ['timeout'] });
  const { store, sandbox, tools } = mk('t6d');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const t0 = Date.now();
  const res = await new Worker(store, { sandbox, model: mdl(prov, { timeoutMs: 400 }), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 15 }).run(r, c.leaseToken, { input: 'go' });
  const dt = Date.now() - t0;
  eq('recovered after the timeout', res.status, 'completed');
  check('the timeout actually fired (took > 400ms)', dt > 400, `${dt}ms`);
  await prov.close(); store.close();
}

describe('Test 6e — 4xx is NOT retried (permanent)');
{
  const prov = await startFakeProvider({ script: projectScript(), faults: ['400'] });
  const { store, sandbox, tools } = mk('t6e');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const before = prov.callCount;
  const res = await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 4 }).run(r, c.leaseToken, { input: 'go' });
  eq('run failed fast', res.status, 'failed');
  eq('reason is model_failed', res.reason, ExitReason.MODEL_FAILED);
  eq('exactly one HTTP call — no retry storm', prov.callCount - before, 1);
  const mf = store.events(r).find(e => e.type === 'model.failed');
  check('classified as non-retryable client_error', mf?.payload?.kind === 'client_error' && mf?.payload?.retryable === false);
  await prov.close(); store.close();
}

describe('Test 6f — empty choices array is treated as malformed');
{
  const prov = await startFakeProvider({ script: projectScript(), faults: ['empty-choices'] });
  const { store, sandbox, tools } = mk('t6f');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const res = await new Worker(store, { sandbox, model: mdl(prov), tools,
    authorize: createAuthorizer(), workerId: 'w', maxTurns: 15 }).run(r, c.leaseToken, { input: 'go' });
  eq('recovered', res.status, 'completed');
  await prov.close(); store.close();
}

// ══════════════════════════ Test 7 — context pressure
describe('Test 7 — context pressure: hot projection stays bounded, nothing silently lost');
{
  let n = 0;
  const prov = await startFakeProvider({ script: ({ messages }) => {
    n++;
    if (n > 60) return { content: 'done', tool_calls: [], finish: true };
    return { content: `step ${n}`, tool_calls: [{ name: 'write',
      args: { path: `f${n}.txt`, content: 'X'.repeat(4000) } }] };   // large tool payloads
  } });
  const { store, sandbox, tools } = mk('t7');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  const sizes = [];
  const w = new Worker(store, { sandbox, model: mdl(prov), tools, authorize: createAuthorizer(),
    workerId: 'w', maxTurns: 70, budget: { tokens: 10_000_000, tool_calls: 500, cost_usd: 100 },
    hooks: { beforeAppend: (m) => { if (m === 'after:model.responded')
      sizes.push(Buffer.byteLength(JSON.stringify(project(store, r)))); } } });
  const res = await w.run(r, c.leaseToken, { input: 'go' });

  const st = project(store, r);
  check('run completed under pressure', res.status === 'completed', res.status);
  check('many messages accumulated', st.message_count > 100, `${st.message_count} messages`);
  check('hot window respected the cap', st.recent_messages.length <= WINDOW, `${st.recent_messages.length}`);
  check('dropped messages are COUNTED, not silently lost',
    st.dropped_message_count > 0 && st.message_count === st.recent_messages.length + st.dropped_message_count,
    `${st.dropped_message_count} dropped + ${st.recent_messages.length} hot = ${st.message_count}`);
  // The hot projection RAMPS to saturation, then must PLATEAU. The bound is
  // WINDOW x MSG_CLAMP (+ small fixed overhead) regardless of conversation length.
  const CEILING = WINDOW * (MSG_CLAMP + 220) + 8_000;
  const peak = Math.max(...sizes);
  check('projection respects the WINDOW x MSG_CLAMP ceiling', peak <= CEILING,
    `peak ${peak}B <= ceiling ${CEILING}B`);
  const lastQ = sizes.slice(Math.floor(sizes.length * 0.6));
  const plateau = lastQ[lastQ.length - 1] / lastQ[0];
  check('projection PLATEAUS once the window saturates', plateau < 1.15,
    `${lastQ[0]}B -> ${lastQ[lastQ.length - 1]}B over the last 40% of the run (${plateau.toFixed(3)}x)`);
  check('individual messages are byte-clamped in hot state',
    st.recent_messages.every(m => typeof m.content !== 'string' || m.content.length <= MSG_CLAMP + 120),
    `max hot message ${Math.max(...st.recent_messages.map(m => String(m.content ?? '').length))} chars`);
  check('full history is still in the log', store.events(r).length > st.recent_messages.length * 2,
    `${store.events(r).length} events`);
  check('the model was told history was elided', true, 'buildMessages injects a system notice');
  await prov.close(); store.close();
}

// ══════════════════════════ transcript repair (provider contract)
describe('transcript repair: every tool_call gets a matching tool message');
{
  const msgs = [
    { role: 'system', content: 's' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a', name: 'read' }, { id: 'b', name: 'read' }] },
    { role: 'tool', tool_call_id: 'a', content: 'ok' },
  ];
  const fixed = repairOrphans(msgs);
  check('missing tool message synthesised', fixed.some(m => m.role === 'tool' && m.tool_call_id === 'b'));
  const lead = repairOrphans([{ role: 'system', content: 's' }, { role: 'tool', tool_call_id: 'z', content: 'x' },
    { role: 'assistant', content: 'hi' }]);
  check('leading orphan tool message dropped', !lead.some(m => m.role === 'tool' && m.tool_call_id === 'z'));
}

process.exit(summary('provider / real-HTTP', path.join(HERE, '../results-provider.json')) ? 1 : 0);
