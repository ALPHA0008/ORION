// P0 — baseline integrity. Regression tests for the three fixes that landed outside a wave.
//
// Each of these was found by running the product, not by a test, which is exactly why each now
// gets one: a fix with no failing-first test is a fix that can be silently reverted.
//
//   T1  store:  busy_timeout armed BEFORE journal_mode=WAL; tx() retries BEGIN on SQLITE_BUSY only
//   T2  config: requestTimeoutMs is a real, validated, number-coerced knob that reaches the provider
//   T3  shims:  qwen models get reasoning-as-content, which never touches a content-bearing answer
//   T4  shadow: the checkpoint shadow repo is named by a digest, not a truncated hex prefix
//
// Everything HOME-dependent in the CLI module is a constant captured at import, so ORION_HOME is
// pinned to a fresh directory BEFORE the dynamic import below.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { Store, uid } from '../../src/core/run/store.mjs';
import { resolveConfig } from '../../src/config/index.mjs';
import { applyReasoningAsContent } from '../../src/agent/model/shims/reasoning-as-content.mjs';
import { startFakeProvider } from '../_helpers/fake-provider.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `p0-${tag}-`));

const SHADOW_HOME = mk('orionhome');
process.env.ORION_HOME = SHADOW_HOME;
const EMPTY_HOME = mk('home');
process.env.HOME = EMPTY_HOME;
process.env.USERPROFILE = EMPTY_HOME;
const { selectShims, buildModel, makeSandbox } = await import('../../src/cli/index.mjs');

/**
 * A second connection, in a real second thread, that takes a write lock, reports that it holds
 * it (the barrier), keeps it for `holdMs`, then releases. The main thread's store call blocks
 * synchronously, so the lock holder MUST live on another thread for the release to happen.
 */
function holdLock(dbPath, { begin = 'BEGIN IMMEDIATE', setup = '', holdMs = 400 } = {}) {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(workerData.dbPath);
    db.exec('PRAGMA busy_timeout=5000');
    if (workerData.setup) db.exec(workerData.setup);
    db.exec(workerData.begin);
    parentPort.postMessage('held');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.holdMs);
    db.exec('COMMIT');
    db.close();
    parentPort.postMessage('released');
  `;
  const w = new Worker(code, { eval: true, workerData: { dbPath, begin, setup, holdMs } });
  const held = new Promise((res, rej) => {
    w.on('message', (m) => { if (m === 'held') res(); });
    w.on('error', rej);
  });
  const done = new Promise((res) => w.on('exit', res));
  return { held, done };
}

// ═══════════════════════════════════════════ T1 — store contention
describe('p0/T1: tx() waits out a transient write lock instead of crashing');
{
  const d = mk('tx');
  const dbPath = path.join(d, 'r.db');
  const store = new Store(dbPath);
  store.db.exec('CREATE TABLE t1probe(x INTEGER)');
  // Disarm SQLite's own wait so what is measured is tx()'s retry, not busy_timeout. This is the
  // exact situation the fix exists for: busy_timeout expired and BEGIN surfaced SQLITE_BUSY.
  store.db.exec('PRAGMA busy_timeout=0');

  const lock = holdLock(dbPath, { holdMs: 400 });
  await lock.held;
  const t0 = Date.now();
  let result = null, err = null;
  try {
    result = store.tx(() => { store.db.prepare('INSERT INTO t1probe VALUES (7)').run(); return 42; });
  } catch (e) { err = e; }
  const waited = Date.now() - t0;
  await lock.done;

  check('tx() succeeded despite another connection holding BEGIN IMMEDIATE', err === null,
    err ? String(err.message) : `waited ${waited}ms`);
  eq('...returning fn\'s value', result, 42);
  check('...having genuinely waited for the lock (not a lucky miss)', waited >= 200, `${waited}ms`);
  // Effect: the write is committed and visible to an independent connection.
  const probe = new DatabaseSync(dbPath);
  eq('...and the write is committed, visible to another connection',
    probe.prepare('SELECT COUNT(*) AS n FROM t1probe WHERE x = 7').get().n, 1);
  probe.close();
  store.close();
}

describe('p0/T1: a non-BUSY failure is rethrown at once, and fn never runs twice');
{
  const d = mk('tx2');
  const store = new Store(path.join(d, 'r.db'));
  store.db.exec('BEGIN');   // nested BEGIN IMMEDIATE now fails with a non-BUSY error
  let calls = 0, err = null;
  const t0 = Date.now();
  try { store.tx(() => { calls++; }); } catch (e) { err = e; }
  const took = Date.now() - t0;
  store.db.exec('ROLLBACK');
  check('the non-BUSY error is surfaced', err !== null && /transaction/i.test(String(err?.message)),
    String(err?.message));
  check('...immediately, with no retry delay', took < 200, `${took}ms`);
  eq('...and fn was never invoked', calls, 0);

  let bodyCalls = 0, bodyErr = null;
  try { store.tx(() => { bodyCalls++; throw new Error('boom in body'); }); } catch (e) { bodyErr = e; }
  eq('an error thrown by fn propagates unchanged', bodyErr?.message, 'boom in body');
  eq('...and the body ran exactly once (only BEGIN is retried)', bodyCalls, 1);
  store.close();
}

describe('p0/T1: opening a store while another connection holds the lock waits, not crashes');
{
  // A fresh database in rollback-journal mode, exclusively locked by another connection. Switching
  // it to WAL needs that lock, so the constructor's journal_mode PRAGMA contends — which is only
  // survivable if busy_timeout was armed BEFORE it.
  const d = mk('open');
  const dbPath = path.join(d, 'r.db');
  const lock = holdLock(dbPath, {
    setup: 'CREATE TABLE IF NOT EXISTS pre(x INTEGER)', begin: 'BEGIN EXCLUSIVE', holdMs: 400 });
  await lock.held;
  let store = null, err = null;
  try { store = new Store(dbPath); } catch (e) { err = e; }
  await lock.done;
  check('the Store constructor survived a concurrently held lock', err === null, String(err?.message ?? ''));
  if (store) {
    const runId = store.createRun(uid('run'), { task: 'opened under contention' });
    check('...and the opened store is usable: the run exists', !!store.run(runId));
    eq('...in WAL mode', store.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    store.close();
  } else {
    check('...and the opened store is usable: the run exists', false, 'no store was opened');
  }
}

// ═══════════════════════════════════════════ T2 — requestTimeoutMs
describe('p0/T2: requestTimeoutMs is a real configuration knob');
{
  const home = mk('cfgh'); const work = mk('cfgw');
  const r = resolveConfig({ workspace: work, home, env: { ORION_REQUEST_TIMEOUT_MS: '1234' } });
  eq('ORION_REQUEST_TIMEOUT_MS=1234 resolves to the NUMBER 1234', r.values.requestTimeoutMs, 1234);
  eq('...recorded as coming from the env', r.sources.requestTimeoutMs, 'env ORION_REQUEST_TIMEOUT_MS');
  eq('...with no configuration errors', r.errors.length, 0);

  const work2 = mk('cfgw2');
  fs.writeFileSync(path.join(work2, '.orion.json'), JSON.stringify({ requestTimeoutMs: -1 }));
  const bad = resolveConfig({ workspace: work2, home, env: {} });
  const e = bad.errors.find(x => /requestTimeoutMs/.test(x.message));
  check('a config file value of -1 is a ConfigError', e?.constructor?.name === 'ConfigError', e?.message);
  check('...saying it must be a positive number (not "unknown key")',
    /positive number/.test(String(e?.message)), String(e?.message));

  const work3 = mk('cfgw3');
  fs.writeFileSync(path.join(work3, '.orion.json'), JSON.stringify({ requestTimeoutMs: 90000 }));
  const good = resolveConfig({ workspace: work3, home, env: {} });
  eq('a positive file value is accepted', good.values.requestTimeoutMs, 90000);
  eq('...without errors', good.errors.length, 0);
}

/** Drive a model built by the REAL buildModel against a server that never answers. */
async function stalledModel(timeoutEnv) {
  const fp = await startFakeProvider({ faults: Array(20).fill('timeout') });
  const home = mk('bmh'); const work = mk('bmw');
  const env = { ORION_BASE_URL: fp.url, ORION_MODEL: 'test-model',
                ...(timeoutEnv === undefined ? {} : { ORION_REQUEST_TIMEOUT_MS: timeoutEnv }) };
  const model = buildModel(env, { workspace: work, home });
  const outcome = model.invoke({ messages: [{ role: 'user', content: 'hi' }] })
    .then(() => ({ ok: true }), (err) => ({ ok: false, err }));
  return { fp, model, outcome };
}

describe('p0/T2: the configured timeout reaches the provider buildModel creates');
{
  // Effect, not plumbing: a 1000ms timeout (the lowest in-bounds value, see T2b) against a server
  // that never answers must give up and retry on that cadence: 4 attempts x 1s + backoff
  // (~0.2+0.4+0.8s + jitter) ~= 5.5s. With the 60s default it would still be waiting on the FIRST
  // request at the 15s budget. The lower bound proves each attempt really waited ~1s (the
  // configured value), not some smaller hard-coded timeout.
  const t0 = Date.now();
  const { fp, outcome } = await stalledModel('1000');
  const r = await Promise.race([outcome, new Promise(res => setTimeout(() => res({ ok: null }), 15_000))]);
  const elapsed = Date.now() - t0;
  check('a stalled request is abandoned within the configured timeout (not the 60s default)',
    r.ok === false, r.ok === null ? 'still waiting after 15s' : String(r.err?.message));
  eq('...as a timeout', r.err?.kind, 'timeout');
  eq('...after all four attempts reached the server', fp.calls.length, 4);
  check('...and each attempt waited ~the configured 1000ms (total >= 4s)', elapsed >= 4000, `elapsed ${elapsed}ms`);
}

for (const bad of ['-1', 'abc']) {
  describe(`p0/T2: env ORION_REQUEST_TIMEOUT_MS=${bad} falls back to the default, not an instant abort`);
  const { fp, outcome } = await stalledModel(bad);
  let settled = null;
  outcome.then(v => { settled = v; });
  // Barrier: the first request has arrived. Then give an instant-abort timer every chance to fire.
  const t0 = Date.now();
  while (fp.calls.length < 1 && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 1000));
  eq('the first request reached the server', fp.calls.length >= 1, true);
  eq('...and was NOT aborted and retried (no instant-abort storm)', fp.calls.length, 1);
  eq('...the call is still pending on the default timeout', settled, null);
}

// T2b — requestTimeoutMs is BOUNDED to [1000, 2147483647] ms. Below 1s every real request is
// aborted at once (retry storm); above 2^31-1 Node's setTimeout overflows and fires after ~1ms,
// which is the same storm wearing a "huge timeout" costume.
describe('p0/T2b: a config file requestTimeoutMs outside [1000, 2147483647] is a ConfigError');
{
  const home = mk('cfgbh');
  for (const v of [1, 999, 1e10, 2147483648]) {
    const w = mk('cfgbw');
    fs.writeFileSync(path.join(w, '.orion.json'), JSON.stringify({ requestTimeoutMs: v }));
    const r = resolveConfig({ workspace: w, home, env: {} });
    const e = r.errors.find(x => /requestTimeoutMs/.test(x.message));
    check(`file requestTimeoutMs=${v} is rejected as a ConfigError`,
      e?.constructor?.name === 'ConfigError', e?.message ?? `accepted as ${r.values.requestTimeoutMs}`);
  }
  for (const v of [1000, 2147483647]) {
    const w = mk('cfgbw');
    fs.writeFileSync(path.join(w, '.orion.json'), JSON.stringify({ requestTimeoutMs: v }));
    const r = resolveConfig({ workspace: w, home, env: {} });
    eq(`file requestTimeoutMs=${v} (a bound) is accepted`, r.values.requestTimeoutMs, v);
    eq('...without errors', r.errors.length, 0);
  }
}

for (const bad of ['1', '999', '1e10']) {
  describe(`p0/T2b: env ORION_REQUEST_TIMEOUT_MS=${bad} is out of bounds, so falls back to the default`);
  const { fp, outcome } = await stalledModel(bad);
  let settled = null;
  outcome.then(v => { settled = v; });
  const t0 = Date.now();
  while (fp.calls.length < 1 && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 10));
  // 3s, not 1s: a 999ms timeout must have had time to fire and retry for this to discriminate.
  await new Promise(r => setTimeout(r, 3000));
  eq('the first request reached the server', fp.calls.length >= 1, true);
  eq('...and was NOT aborted and retried (no instant-abort storm)', fp.calls.length, 1);
  eq('...the call is still pending on the default timeout', settled, null);
}

// ═══════════════════════════════════════════ T3 — qwen reasoning shim
describe('p0/T3: qwen models get the reasoning-as-content shim');
{
  const shims = selectShims('qwen3.6:35b-a3b-q4_K_M', {});
  check('selectShims(qwen3.6:35b-a3b-q4_K_M) includes the reasoning shim',
    shims.includes(applyReasoningAsContent), `${shims.length} shim(s)`);
  check('...case-insensitively (Qwen/Qwen3-32B)', selectShims('Qwen/Qwen3-32B', {}).includes(applyReasoningAsContent));
  eq('an unrelated model still gets no shim', selectShims('gpt-4o-mini', {}).length, 0);

  const withContent = { content: 'the answer is 42', tool_calls: [], ext: { reasoning: 'let me think' } };
  const out = applyReasoningAsContent(withContent);
  eq('a response that HAS content keeps it unchanged', out.content, 'the answer is 42');
  check('...and is returned untouched (no shimmed marker)', out === withContent && !out.ext.shimmed);

  const onlyReasoning = { content: '', tool_calls: [], ext: { reasoning: 'the answer is 42' } };
  const out2 = applyReasoningAsContent(onlyReasoning);
  eq('a reasoning-only response gets its reasoning as content', out2.content, 'the answer is 42');
  eq('...marked as shimmed', out2.ext.shimmed, 'reasoning-as-content');
}

describe('p0/T3: the shim is applied through the composed buildModel for a qwen model');
{
  // A real HTTP endpoint answering the way qwen3 does under OpenAI-compat: all reasoning, no content.
  const replies = [
    { content: '', reasoning: 'forty-two' },
    { content: 'real content', reasoning: 'scratch work' },
  ];
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const msg = replies[n++ % replies.length];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...msg }, finish_reason: 'stop' }],
                               usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  const model = buildModel({ ORION_BASE_URL: url, ORION_MODEL: 'qwen3.6:35b-a3b-q4_K_M' },
    { workspace: mk('q3w'), home: mk('q3h') });
  const a = await model.invoke({ messages: [{ role: 'user', content: 'x' }] });
  eq('a reasoning-only qwen reply surfaces as content', a.content, 'forty-two');
  const b = await model.invoke({ messages: [{ role: 'user', content: 'x' }] });
  eq('a content-bearing qwen reply keeps its own content', b.content, 'real content');
  server.close();
}

// ═══════════════════════════════════════════ T4 — shadow repo naming
describe('p0/T4: workspaces sharing a long prefix get distinct shadow repos');
{
  const base = path.join(mk('shadow'), 'a-deliberately-long-common-prefix-for-both-projects');
  const a = path.join(base, 'proj-a'); const b = path.join(base, 'proj-b');
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
  const shadows = path.join(SHADOW_HOME, 'workspaces');
  makeSandbox(a, {});
  makeSandbox(b, {});
  const dirs = fs.readdirSync(shadows).filter(n => n.endsWith('.git'));
  eq('two workspaces produced two shadow repos', dirs.length, 2);
  check('...each a real bare git repo', dirs.every(n => fs.existsSync(path.join(shadows, n, 'HEAD'))));
  makeSandbox(a, {});
  eq('re-opening a workspace reuses its shadow (the name is stable)',
    fs.readdirSync(shadows).filter(n => n.endsWith('.git')).length, 2);
}

process.exit(summary('p0/baseline') ? 1 : 0);
