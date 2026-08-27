// STEPS 7, 8, 11, 12, 13, 15 — provider failure, context pressure, orphan recovery,
// time travel, security, and replay-under-nondeterminism. All with the REAL model.
import { requireRealModel, mkEnv, mkWorker, metrics, CFG, uid, realModel } from '../_helpers/real-model.mjs';
import { project, WINDOW, MSG_CLAMP } from '../../src/core/projection/index.mjs';
import { explain } from '../../src/core/run/explain.mjs';
import { replay, fork, rerun } from '../../src/core/replay/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { createOpenAICompatModel } from '../../src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../src/agent/model/shims/gemma-tool-calls.mjs';
import { LocalSandbox, attachCheckpoints } from '../../src/sandbox/local/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';
import http from 'node:http';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
import { fileURLToPath } from 'node:url';

requireRealModel();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = {};
console.log(`model: ${CFG.model} @ ${CFG.baseUrl}\n`);

// ═══════════ STEP 7 — provider failure, via a FAULT-INJECTING PROXY to the real model
// Real upstream, real model output; the proxy injects transport faults in front of it.
function startFaultProxy({ faults = [] } = {}) {
  const q = [...faults];
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      const fault = q.shift();
      seen.push(fault ?? 'pass');
      if (fault === 'timeout') return;                         // never respond
      if (fault === '429') { res.writeHead(429, {'retry-after':'0','content-type':'application/json'});
        return res.end('{"error":{"message":"rate limited"}}'); }
      if (fault === '500' || fault === '502' || fault === '503') {
        res.writeHead(Number(fault), {'content-type':'application/json'});
        return res.end('{"error":{"message":"upstream"}}'); }
      if (fault === 'malformed') { res.writeHead(200, {'content-type':'application/json'});
        return res.end('{"choices": [ this is not json'); }
      if (fault === 'empty') { res.writeHead(200, {'content-type':'application/json'});
        return res.end('{"choices": [], "usage": {}}'); }
      // pass through to the REAL model
      try {
        const up = await fetch(CFG.baseUrl.replace(/\/+$/,'') + '/chat/completions', {
          method: 'POST', headers: { 'content-type':'application/json',
            ...(CFG.apiKey ? { authorization: `Bearer ${CFG.apiKey}` } : {}) }, body });
        const text = await up.text();
        res.writeHead(up.status, {'content-type':'application/json'});
        res.end(text);
      } catch (e) { res.writeHead(502); res.end('{"error":{"message":"proxy upstream failed"}}'); }
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () =>
    r({ url: `http://127.0.0.1:${srv.address().port}/v1`, seen,
        close: () => new Promise(x => srv.close(x)) })));
}

describe('STEP 7 — provider failures in front of a REAL model');
{
  const rows = [];
  for (const [label, faults, expect] of [
    ['429 rate limit',      ['429','429'],        'recover'],
    ['500 server error',    ['500'],              'recover'],
    ['503 unavailable',     ['503'],              'recover'],
    ['malformed body',      ['malformed'],        'recover'],
    ['empty choices',       ['empty'],            'recover'],
    ['timeout',             ['timeout'],          'recover'],
    ['persistent 500 (total outage)', Array(40).fill('500'), 'terminate'],
  ]) {
    const prox = await startFaultProxy({ faults });
    const env = mkEnv('prov-' + label.replace(/\W+/g,''));
    const model = createOpenAICompatModel({ baseUrl: prox.url, apiKey: CFG.apiKey, model: CFG.model,
      timeoutMs: 8_000, maxRetries: 3, shims: [applyGemmaToolCallShim] });
    const runId = uid('run'); env.store.createRun(runId, { task: 'write hello.txt containing hi' });
    const c = env.store.claim('w', { runId });
    const res = await mkWorker(env.store, env.sandbox, env.tools,
      { model, workerId: 'w', maxTurns: 8,
        authorize: createAuthorizer({ posture:'permissive', escalateUnsafeRecovery:false }) })
      .run(runId, c.leaseToken, { input: 'Write a file called hello.txt containing exactly: hi' });
    const ev = env.store.events(runId);
    const st = project(env.store, runId);
    const mf = ev.filter(e => e.type === 'model.failed');
    const dg = ev.filter(e => e.type === 'degraded');
    const row = { label, expect, status: st.status, reason: st.exit_reason,
      model_failed: mf.length, kinds: [...new Set(mf.map(e => e.payload.kind))],
      degraded: dg.length, wrote: env.sandbox.exists('hello.txt') };
    rows.push(row);
    console.log(`  ${label.padEnd(20)} -> ${row.status}/${row.reason}  model.failed=${row.model_failed} ${JSON.stringify(row.kinds)} degraded=${row.degraded} wrote=${row.wrote}`);
    if (expect === 'recover') {
      check(`[${label}] the run still completed`, row.status === 'completed', `${row.status}/${row.reason}`);
      check(`[${label}] the failure was recorded, not hidden`, row.model_failed > 0 || row.degraded > 0,
        `failed=${row.model_failed} degraded=${row.degraded}`);
    } else {
      check(`[${label}] a permanent outage terminates explicitly`,
        ['failed'].includes(row.status), `${row.status}/${row.reason}`);
      check(`[${label}] terminal reason names the cause`,
        ['model_unavailable','model_failed'].includes(row.reason), row.reason);
    }
    env.store.close(); await prox.close();
  }
  out.provider = rows;
}

// ═══════════ STEP 8 — context pressure with the real model
describe('STEP 8 — context pressure: bounded projection under a real model');
{
  const env = mkEnv('ctx');
  // seed many moderately large files so tool outputs are big
  for (let i = 0; i < 14; i++) env.sandbox.write(`data/f${i}.txt`, `file ${i}\n` + ('X'.repeat(3000)));
  const runId = uid('run');
  const task = 'Read every file in the data/ directory one at a time, from f0.txt through f13.txt. ' +
               'After reading all of them, write a file summary.txt containing the word COMPLETE.';
  env.store.createRun(runId, { task });
  const c = env.store.claim('w', { runId });
  const sizes = [];
  const res = await mkWorker(env.store, env.sandbox, env.tools, {
    workerId: 'w', maxTurns: 24,
    budget: { tokens: 2_000_000, tool_calls: 200, cost_usd: 100 },
    authorize: createAuthorizer({ posture:'permissive', escalateUnsafeRecovery:false }),
    hooks: { beforeAppend: (m) => { if (m === 'after:model.responded')
      sizes.push(Buffer.byteLength(JSON.stringify(project(env.store, runId)))); } },
  }).run(runId, c.leaseToken, { input: task });

  const st = project(env.store, runId);
  const m = metrics(env.store, runId, 0);
  const peak = sizes.length ? Math.max(...sizes) : 0;
  const ceiling = WINDOW * (MSG_CLAMP + 220) + 8000;
  console.log(`  events=${m.events} msgs=${st.message_count} hot=${st.recent_messages.length} dropped=${st.dropped_message_count}`);
  console.log(`  projection peak=${peak}B ceiling=${ceiling}B  tokens in=${m.input_tokens}`);
  check('the run made real progress under pressure', m.tool_calls >= 5, `${m.tool_calls} tool calls`);
  check('hot window respected the cap', st.recent_messages.length <= WINDOW, `${st.recent_messages.length}`);
  check('projection stayed under the WINDOW x MSG_CLAMP ceiling', peak <= ceiling, `${peak} <= ${ceiling}`);
  check('elision is COUNTED, not silent',
    st.message_count === st.recent_messages.length + st.dropped_message_count,
    `${st.dropped_message_count} dropped + ${st.recent_messages.length} hot = ${st.message_count}`);
  check('large tool outputs were clamped in hot state',
    st.recent_messages.every(mm => typeof mm.content !== 'string' || mm.content.length <= MSG_CLAMP + 120),
    `max ${Math.max(...st.recent_messages.map(mm => String(mm.content ?? '').length))}`);
  check('full history remains in the event log', env.store.events(runId).length > st.recent_messages.length,
    `${env.store.events(runId).length} events`);
  out.context = { metrics: m, message_count: st.message_count, hot: st.recent_messages.length,
    dropped: st.dropped_message_count, peak_projection_bytes: peak, ceiling,
    status: st.status, reason: st.exit_reason, sizes,
    wrote_summary: env.sandbox.exists('summary.txt'), explain: explain(env.store, runId) };
  env.store.close();
}

// ═══════════ STEP 11 — orphan recovery with a real model in the loop
describe('STEP 11 — orphaned tool call, then a REAL model continues');
{
  for (const [label, seedFile, expectDecision] of [
    ['not-applied -> reissue', false, 'reissue'],
    ['applied -> skip',        true,  'skip'],
  ]) {
    const env = mkEnv('orph-' + expectDecision);
    const runId = uid('run');
    const task = 'Write a file called note.txt containing exactly: hello. Then reply DONE.';
    env.store.createRun(runId, { task });
    // fabricate the orphan: tool.started with no terminal event
    env.store.append(runId, 'turn.started', { input: task });
    if (seedFile) env.sandbox.write('note.txt', 'hello');
    env.store.append(runId, 'tool.started',
      { tool_call_id: 'orphan1', name: 'write', args: { path: 'note.txt', content: 'hello' } });

    const c = env.store.claim('w', { runId });
    const res = await mkWorker(env.store, env.sandbox, env.tools,
      { workerId: 'w', maxTurns: 8,
        authorize: createAuthorizer({ posture:'permissive', escalateUnsafeRecovery:false }) })
      .run(runId, c.leaseToken, {});
    const dec = env.store.events(runId).find(e => e.type === 'tool.recovery_decided');
    console.log(`  ${label}: decision=${dec?.payload?.decision} verified=${dec?.payload?.verified} -> ${res.status}/${res.reason}`);
    check(`[${label}] recovery decision recorded`, !!dec, JSON.stringify(dec?.payload));
    eq(`[${label}] decision is correct`, dec?.payload?.decision, expectDecision);
    check(`[${label}] the model continued after recovery`,
      env.store.events(runId).filter(e => e.type === 'model.requested').length > 0);
    check(`[${label}] file has the right content`, env.sandbox.read('note.txt') === 'hello',
      JSON.stringify(env.sandbox.read('note.txt')));
    (out.orphan ??= []).push({ label, decision: dec?.payload?.decision, verified: dec?.payload?.verified,
      status: res.status, reason: res.reason, explain: explain(env.store, runId) });
    env.store.close();
  }

  // UNKNOWN -> escalate, using a bash orphan the runtime cannot verify
  const env = mkEnv('orph-unknown');
  const runId = uid('run');
  env.store.createRun(runId, { task: 'x' });
  env.store.append(runId, 'turn.started', { input: 'x' });
  env.store.append(runId, 'tool.started',
    { tool_call_id: 'orphan2', name: 'bash', args: { cmd: 'echo audit >> log.txt' } });
  const c = env.store.claim('w', { runId });
  const res = await mkWorker(env.store, env.sandbox, env.tools, { workerId: 'w', maxTurns: 4 })
    .run(runId, c.leaseToken, {});
  const dec = env.store.events(runId).find(e => e.type === 'tool.recovery_decided');
  console.log(`  unknown -> escalate: decision=${dec?.payload?.decision} -> ${res.status}/${res.reason}`);
  eq('[unknown] decision is escalate', dec?.payload?.decision, 'escalate');
  eq('[unknown] run paused for a human', res.reason, 'ambiguous_tool_recovery');
  check('[unknown] lease released while waiting', env.store.run(runId).lease_token === null);
  (out.orphan ??= []).push({ label: 'unknown -> escalate', decision: dec?.payload?.decision,
    status: res.status, reason: res.reason, explain: explain(env.store, runId) });
  env.store.close();
}

fs.writeFileSync(path.join(HERE, 'result-06.json'), JSON.stringify(out, null, 2));
process.exit(summary('real-model 06 remaining') ? 1 : 0);
