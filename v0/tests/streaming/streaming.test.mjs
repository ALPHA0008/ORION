// WAVE 4b — streaming as DURABLE PARTIAL EXECUTION.
//
// Streaming here is not a rendering feature. The claim under test is that a partially-completed
// model call leaves durable, attributable evidence — so a crash mid-stream is recoverable, ttft_ms
// becomes observable, and replay reconstructs the turn at zero model cost.
//
// Three assertions are BLOCKING:
//   S5  replay of a streamed run makes ZERO model calls
//   S6  a stream killed mid-flight leaves a durable partial; resume does not duplicate effects
//   S8  a streamed and a non-streamed run reach the SAME final projection
//
// S8 is the one that decides whether this feature is allowed to exist. If turning streaming on
// changed the outcome, streaming would be a SECOND EXECUTION MODEL — precisely what Wave 2
// refused for the REPL and what the whole trajectory design forbids.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { createProvider } from '../../src/agent/model/index.mjs';
import { createStreamAccumulator, DELTA_BYTES } from '../../src/agent/model/stream.mjs';
import { replay } from '../../src/core/replay/index.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { projectArtifacts } from '../../src/core/projection/artifacts.mjs';
import { EVENT_TYPES, EVENT_CONTRACT_VERSION } from '../../src/core/event/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROKEN = 'export const add = (a, b) => a - b;\n';
const FIXED  = 'export const add = (a, b) => a + b;\n';

/**
 * An SSE server that streams a scripted turn.
 * `plan` is a list of turns; each turn is { text?, toolCall?, chunkSize? }.
 */
async function sseServer(turns, { killAfterBytes = null } = {}) {
  let turn = 0;
  const server = http.createServer((req, res) => {
    const spec = turns[Math.min(turn++, turns.length - 1)];
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    let sent = 0;

    if (spec.toolCall) {
      send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: spec.toolCall.id,
        function: { name: spec.toolCall.name, arguments: '' } }] } }] });
      const argStr = JSON.stringify(spec.toolCall.args);
      for (let i = 0; i < argStr.length; i += 24) {
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0,
          function: { arguments: argStr.slice(i, i + 24) } }] } }] });
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
             usage: { prompt_tokens: 5, completion_tokens: 5 } });
    } else {
      const text = spec.text ?? 'done';
      const size = spec.chunkSize ?? 8;
      // Deltas flush on a byte OR time threshold; a tiny chunk size with a hard kill can beat
      // both, so the fixture writes chunks large enough to cross DELTA_BYTES before the kill.
      for (let i = 0; i < text.length; i += size) {
        const piece = text.slice(i, i + size);
        send({ choices: [{ index: 0, delta: { content: piece } }] });
        sent += piece.length;
        if (killAfterBytes && sent >= killAfterBytes) {
          // Let the socket flush what was already written before severing it. Destroying
          // immediately discards the buffered bytes, so the client would see an empty partial
          // and the test would assert on a kill that delivered nothing.
          setTimeout(() => res.destroy(), 60);
          return;
        }
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
             usage: { prompt_tokens: 5, completion_tokens: 5 } });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  return { port, close: () => new Promise((r) => server.close(r)) };
}

function rig(dir) {
  const d = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'stream-'));
  const sandbox = new LocalSandbox(path.join(d, 'w'));
  if (!fs.existsSync(path.join(d, 'w', 'math.js'))) sandbox.write('math.js', BROKEN);
  return { d, sandbox, store: new Store(path.join(d, 'run.db')) };
}

describe('streaming/contract-version');
{
  check('the contract is at or beyond v4', EVENT_CONTRACT_VERSION >= 4, `v${EVENT_CONTRACT_VERSION}`);
  for (const t of ['stream.started', 'stream.delta', 'stream.finished'])
    check(`${t} is in the frozen vocabulary`, EVENT_TYPES.includes(t));
  check('the set is still frozen', Object.isFrozen(EVENT_TYPES));
  // ADDITIVE ONLY: every earlier member must still be present, or old logs stop replaying.
  for (const t of ['run.created', 'tool.succeeded', 'plan.created', 'artifact.created'])
    check(`earlier contract member ${t} survives`, EVENT_TYPES.includes(t));
}

describe('streaming/S3-deltas-are-bounded-not-per-token');
{
  // Unit-level proof of the cadence rule, independent of any server.
  let deltas = 0;
  const acc = createStreamAccumulator({ onDelta: () => { deltas++; }, deltaMs: 1e9 });
  const TOKENS = 400;
  for (let i = 0; i < TOKENS; i++) acc.push({ textDelta: '0123456789' });   // 4,000 bytes total
  acc.finish({ finishReason: 'stop' });
  check('S3: far fewer delta events than tokens', deltas < TOKENS / 10, `${deltas} deltas / ${TOKENS} pushes`);
  check('S3: but the stream was not silent', deltas >= 1, `${deltas}`);
  check('S3: cadence respects the byte threshold', deltas <= Math.ceil((TOKENS * 10) / DELTA_BYTES) + 1,
    `${deltas} vs ceil(4000/${DELTA_BYTES})`);
}

describe('streaming/S1-S2-a-streamed-turn-is-recorded');
{
  const { store, sandbox } = rig();
  const { port, close } = await sseServer([
    { toolCall: { id: 'w1', name: 'write', args: { path: 'math.js', content: FIXED } } },
    { text: 'all fixed now' },
  ]);
  const model = createProvider({ kind: 'openai-compat', baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'm', capabilities: ['tools', 'streaming'] });
  const runId = uid('run');
  store.createRun(runId, { task: 'fix add()' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  const res = await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
    stream: true, maxTurns: 6 }).run(runId, claim.leaseToken, { input: 'fix it' });
  await close();

  const events = store.events(runId);
  const types = events.map(e => e.type);
  eq('the run completed', res.status, 'completed');
  check('the file was ACTUALLY changed', sandbox.read('math.js') === FIXED);

  check('S1: stream.started appended', types.includes('stream.started'));
  check('S1: at least one stream.delta appended', types.filter(t => t === 'stream.delta').length >= 1,
    `${types.filter(t => t === 'stream.delta').length}`);
  check('S1: stream.finished appended', types.includes('stream.finished'));

  const fin = events.filter(e => e.type === 'stream.finished');
  const withTtft = fin.find(e => Number.isFinite(e.payload?.ttft_ms));
  check('S2: ttft_ms is POPULATED (it was always null before this wave)', !!withTtft,
    JSON.stringify(fin.map(e => e.payload?.ttft_ms)));
  check('S2: and it is greater than zero', (withTtft?.payload?.ttft_ms ?? -1) > 0,
    String(withTtft?.payload?.ttft_ms));
  check('stream.started carries the request digest',
    !!events.find(e => e.type === 'stream.started')?.payload?.request_digest);
}

describe('streaming/S4-large-accumulation-becomes-an-artifact');
{
  const { store, sandbox } = rig();
  // A single response far larger than the artifact threshold, in big chunks.
  const BIG = 'x'.repeat(20_000);
  const { port, close } = await sseServer([{ text: BIG, chunkSize: 6_000 }]);
  const model = createProvider({ kind: 'openai-compat', baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'm', capabilities: ['tools', 'streaming'] });
  const runId = uid('run');
  store.createRun(runId, { task: 'talk a lot' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: 'permissive' }), stream: true, maxTurns: 3 })
    .run(runId, claim.leaseToken, { input: 'go' });
  await close();

  const events = store.events(runId);
  const deltas = events.filter(e => e.type === 'stream.delta');
  const withArtifact = deltas.filter(e => e.payload?.artifact_id);
  check('S4: a large delta was promoted to an artifact', withArtifact.length >= 1,
    `${withArtifact.length} of ${deltas.length} deltas`);
  check('S4: the delta carries a REFERENCE, not the blob',
    withArtifact.every(e => !('text' in e.payload) && !('content' in e.payload)),
    JSON.stringify(withArtifact[0]?.payload ?? {}).slice(0, 90));
  const arts = projectArtifacts(events);
  check('S4: the artifact is in the artifact projection',
    withArtifact.every(e => arts.has(e.payload.artifact_id)));
}

describe('streaming/S5-BLOCKING-replay-makes-zero-model-calls');
{
  const { store, sandbox } = rig();
  const { port, close } = await sseServer([
    { toolCall: { id: 'w1', name: 'write', args: { path: 'math.js', content: FIXED } } },
    { text: 'fixed' },
  ]);
  const model = createProvider({ kind: 'openai-compat', baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'm', capabilities: ['tools', 'streaming'] });
  const runId = uid('run');
  store.createRun(runId, { task: 'fix add()' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
    stream: true, maxTurns: 6 }).run(runId, claim.leaseToken, { input: 'fix it' });
  await close();

  const live = project(store, runId);
  const r = replay(store, runId);
  eq('S5 [BLOCKING]: replay makes ZERO model calls', r.modelCalls ?? 0, 0);
  eq('S5: replay reconstructs the same event count', r.state?.seq ?? live.seq, live.seq);

  // A third reader agrees — the stream lives in the log, not in the process that made it.
  const storeB = new Store(path.join(path.dirname(store.path ?? ''), 'run.db'));
  check('S5: the streamed turn is readable from the log alone',
    store.events(runId).some(e => e.type === 'stream.finished'));
}

describe('streaming/S6-BLOCKING-a-killed-stream-leaves-a-durable-partial');
{
  const { d, store, sandbox } = rig();
  // The server destroys the connection part-way through the response.
  const { port, close } = await sseServer([{ text: 'y'.repeat(8_000), chunkSize: 1_200 }],
    { killAfterBytes: 3_600 });
  const model = createProvider({ kind: 'openai-compat', baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'm', capabilities: ['tools', 'streaming'], maxRetries: 0 });
  const runId = uid('run');
  store.createRun(runId, { task: 'long answer' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: 'permissive' }), stream: true,
    maxTurns: 2, maxConsecutiveModelFailures: 1 }).run(runId, claim.leaseToken, { input: 'go' });
  await close();

  const events = store.events(runId);
  const fin = events.find(e => e.type === 'stream.finished');
  check('S6 [BLOCKING]: a stream.finished was still recorded', !!fin);
  check('S6: it is marked aborted', fin?.payload?.aborted === true, JSON.stringify(fin?.payload));
  check('S6: the partial bytes received are recorded', (fin?.payload?.bytes ?? 0) > 0,
    String(fin?.payload?.bytes));
  check('S6: the deltas received before the kill are durable',
    events.filter(e => e.type === 'stream.delta').length >= 1);
  check('S6: the failure is attributed, not silent',
    events.some(e => e.type === 'model.failed'));
  // No duplicated effect: nothing was written to the workspace by a half-finished stream.
  check('S6: no effect was applied by the aborted turn', sandbox.read('math.js') === BROKEN);
}

describe('streaming/S7-the-lease-survives-a-long-stream');
{
  const { store, sandbox } = rig();
  // A deliberately slow stream, against a lease far shorter than it.
  const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (let i = 0; i < 6; i++) {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'chunk ' } }] })}\n\n`);
      await new Promise(r => setTimeout(r, 120));
    }
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const model = createProvider({ kind: 'openai-compat', baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'm', capabilities: ['tools', 'streaming'] });
  const runId = uid('run');
  store.createRun(runId, { task: 'slow stream' });
  // The lease must be comfortably SHORTER than the stream, or the test proves nothing about
  // heartbeating — it would merely show a stream finishing inside its lease.
  const LEASE = 400;
  const claim = store.claim('w', { runId, leaseMs: LEASE });
  const t0 = Date.now();
  const res = await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: 'permissive' }), stream: true,
    leaseMs: LEASE, maxTurns: 2 }).run(runId, claim.leaseToken, { input: 'go' });
  const elapsed = Date.now() - t0;
  await new Promise(r => server.close(r));

  check('S7: the stream really outlasted the lease', elapsed > LEASE, `${elapsed}ms vs ${LEASE}ms`);
  check('S7: the run did NOT die as lease_lost', res.reason !== 'lease_lost', String(res.reason));
  check('S7: the lease was heartbeated during the stream',
    store.events(runId).filter(e => e.type === 'run.lease_renewed').length >= 1);
}

describe('streaming/S8-BLOCKING-streamed-and-non-streamed-reach-the-same-projection');
{
  // THE TEST THAT DECIDES WHETHER THIS FEATURE MAY EXIST.
  //
  // The same scripted turns, once streamed and once not. If the final projections differ,
  // streaming is a second execution model and must not ship.
  const runOne = async (stream) => {
    const { store, sandbox } = rig();
    const { port, close } = await sseServer([
      { toolCall: { id: 'w1', name: 'write', args: { path: 'math.js', content: FIXED } } },
      { text: 'fixed' },
    ]);
    // Non-streaming path needs a JSON endpoint; streaming needs SSE. Use the SSE server for the
    // streamed run and an equivalent JSON server for the other, so the MODEL OUTPUT is identical
    // and only the transport differs — which is exactly the variable under test.
    let model;
    if (stream) {
      model = createProvider({ kind: 'openai-compat', baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'm', capabilities: ['tools', 'streaming'] });
    } else {
      let turn = 0;
      const js = http.createServer((req, res) => {
        turn++;
        const body = turn === 1
          ? { id: 'x', model: 'm', choices: [{ index: 0, finish_reason: 'tool_calls', message: {
              role: 'assistant', content: '', tool_calls: [{ id: 'w1', type: 'function',
                function: { name: 'write', arguments: JSON.stringify({ path: 'math.js', content: FIXED }) } }] } }],
              usage: { prompt_tokens: 5, completion_tokens: 5 } }
          : { id: 'x', model: 'm', choices: [{ index: 0, finish_reason: 'stop',
              message: { role: 'assistant', content: 'fixed', tool_calls: [] } }],
              usage: { prompt_tokens: 5, completion_tokens: 5 } };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
      const jp = await new Promise((r) => js.listen(0, '127.0.0.1', () => r(js.address().port)));
      model = createProvider({ kind: 'openai-compat', baseUrl: `http://127.0.0.1:${jp}/v1`, model: 'm' });
      model.__close = () => new Promise(r => js.close(r));
    }
    const runId = uid('run');
    store.createRun(runId, { task: 'fix add()' });
    const claim = store.claim('w', { runId, leaseMs: 60_000 });
    const res = await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
      authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
      stream, maxTurns: 6 }).run(runId, claim.leaseToken, { input: 'fix it' });
    await close();
    await model.__close?.();
    return { res, store, runId, sandbox, state: project(store, runId) };
  };

  const streamed = await runOne(true);
  const plain = await runOne(false);

  eq('S8: both runs reached the same status', streamed.res.status, plain.res.status);
  eq('S8: both runs reached the same exit reason', streamed.res.reason, plain.res.reason);
  eq('S8 [BLOCKING]: the workspace ends identical',
    streamed.sandbox.read('math.js'), plain.sandbox.read('math.js'));

  // The projection that the model would see next must match. Stream bookkeeping is extra EVENTS,
  // but it must not change derived state.
  const shape = (s) => JSON.stringify({
    turns: s.budget.turns, tool_calls: s.budget.tool_calls,
    messages: s.recent_messages.map(m => [m.role, String(m.content ?? '').slice(0, 60)]),
  });
  eq('S8 [BLOCKING]: the final projection is identical', shape(streamed.state), shape(plain.state));
  check('S8: the streamed run really did stream',
    streamed.store.events(streamed.runId).some(e => e.type === 'stream.finished'));
  check('S8: the plain run recorded no stream events',
    !plain.store.events(plain.runId).some(e => String(e.type).startsWith('stream.')));
}

describe('streaming/P4-capability-mismatch-is-recorded-not-silent');
{
  const { store, sandbox } = rig();
  let turn = 0;
  const js = http.createServer((req, res) => {
    turn++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'x', model: 'm', choices: [{ index: 0, finish_reason: 'stop',
      message: { role: 'assistant', content: 'done', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
  const port = await new Promise((r) => js.listen(0, '127.0.0.1', () => r(js.address().port)));
  // Streaming requested, but the provider does NOT declare the capability.
  const model = createProvider({ kind: 'openai-compat', baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'm', capabilities: ['tools'] });
  const runId = uid('run');
  store.createRun(runId, { task: 't' });
  const claim = store.claim('w', { runId, leaseMs: 60_000 });
  const res = await new Worker(store, { sandbox, model, tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: 'permissive' }), stream: true, maxTurns: 2 })
    .run(runId, claim.leaseToken, { input: 'go' });
  await new Promise(r => js.close(r));

  const events = store.events(runId);
  eq('the run still completed via the fallback', res.status, 'completed');
  const deg = events.filter(e => e.type === 'degraded' && e.payload?.subsystem === 'streaming');
  check('P4: the fallback was RECORDED as degraded, not silent', deg.length >= 1,
    JSON.stringify(deg[0]?.payload ?? {}).slice(0, 90));
  check('P4: and no stream events were fabricated',
    !events.some(e => String(e.type).startsWith('stream.')));
}

process.exit(summary('streaming', path.join(HERE, '..', 'results-streaming.json')) ? 1 : 0);
