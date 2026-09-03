#!/usr/bin/env node
// Phase K — the time-travel CLI. The user should never need to know what "event sourcing" is.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../core/run/store.mjs';
import { LocalSandbox, attachCheckpoints } from '../sandbox/local/index.mjs';
import { makeTools } from '../agent/tools/index.mjs';
import { createAuthorizer } from '../auth/default/index.mjs';
import { Worker } from '../agent/loop/worker.mjs';
import { project } from '../core/projection/index.mjs';
import { explain, summarise } from '../core/run/explain.mjs';
import { replay, fork, rerun, nearestTurnBoundary } from '../core/replay/index.mjs';
import { reap, expireHumanRequests } from '../core/lease/reaper.mjs';
import { createOpenAICompatModel } from '../agent/model/index.mjs';

const HOME = process.env.HARNESS_HOME ?? path.join(os.homedir(), '.harness');
const DB = path.join(HOME, 'harness.db');
const WORK = process.env.HARNESS_WORKSPACE ?? process.cwd();

const C = process.stdout.isTTY
  ? { dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
      r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m` }
  : new Proxy({}, { get: () => (s => s) });

function open() { fs.mkdirSync(HOME, { recursive: true }); return new Store(DB); }

function buildModel() {
  const baseUrl = process.env.HARNESS_BASE_URL;
  const apiKey = process.env.HARNESS_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
  const model = process.env.HARNESS_MODEL ?? 'gpt-4o-mini';
  if (!baseUrl) {
    console.error(C.r('No model configured.'));
    console.error('  Set HARNESS_BASE_URL (an OpenAI-compatible endpoint) and HARNESS_API_KEY.');
    console.error('  e.g. HARNESS_BASE_URL=https://api.openai.com/v1 HARNESS_MODEL=gpt-4o-mini');
    process.exit(2);
  }
  return createOpenAICompatModel({ baseUrl, apiKey, model });
}

function makeWorker(store, workspace) {
  const sandbox = attachCheckpoints(new LocalSandbox(workspace), path.join(HOME, 'workspaces',
    Buffer.from(workspace).toString('hex').slice(0, 16) + '.git'));
  return { sandbox, worker: (extra = {}) => new Worker(store, {
    sandbox, model: buildModel(), tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: process.env.HARNESS_POSTURE ?? 'auto' }),
    ...extra }) };
}

const short = (id) => id.replace(/^run_/, '#');

// ─────────────────────────────────────────────────────────────── commands
const cmds = {
  async run([task]) {
    if (!task) die('usage: harness run "<task>"');
    const store = open();
    const runId = uid('run');
    store.createRun(runId, { task });
    console.log(C.b(`Run ${short(runId)}`) + C.dim(`  ${WORK}`));
    console.log('─'.repeat(48));
    const { worker } = makeWorker(store, WORK);
    const c = store.claim('cli', { runId });
    const res = await worker().run(runId, c.leaseToken, { input: task });
    printLive(store, runId);
    console.log('');
    console.log(res.status === 'completed' ? C.g(`✓ ${res.reason}`) : C.y(`${res.status} — ${res.reason}`));
    if (res.status === 'paused') console.log(C.dim(`  resume with:  harness resume ${short(runId)}`));
    console.log(C.dim(`  history:      harness explain ${short(runId)}`));
    store.close();
  },

  list() {
    const store = open();
    const runs = store.listRuns({ limit: 30 });
    if (!runs.length) return console.log(C.dim('no runs yet — try: harness run "…"'));
    console.log(C.dim('ID          STATUS      EVENTS  WHEN                 TASK'));
    for (const r of runs) {
      const st = project(store, r.id);
      const badge = { completed: C.g('completed'), failed: C.r('failed   '), paused: C.y('paused   '),
                      parked: C.y('parked   '), running: C.c('running  '), pending: C.dim('pending  ') }[r.status] ?? r.status;
      console.log(`${short(r.id).padEnd(11)} ${badge}  ${String(st.seq).padStart(6)}  ` +
        `${new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')}  ` +
        `${(r.task ?? '').slice(0, 40)}${r.parent_run_id ? C.dim(`  ⑂${short(r.parent_run_id)}@${r.forked_from_seq}`) : ''}`);
    }
    store.close();
  },

  status([id]) {
    const store = open(); const runId = resolve(store, id);
    console.log(summarise(store, runId, project(store, runId)));
    store.close();
  },

  async resume([id]) {
    const store = open(); const runId = resolve(store, id);
    reap(store); expireHumanRequests(store);
    const run = store.run(runId);
    if (['completed', 'failed', 'parked'].includes(run.status) && run.status !== 'parked')
      return void console.log(C.y(`run is already ${run.status}`)), store.close();
    const pending = store.humanRequests(runId, 'pending');
    if (pending.length) {
      console.log(C.y('This run is waiting on you:'));
      for (const p of pending) console.log(`  ${p.id}  ${p.prompt}`);
      console.log(C.dim(`  answer with:  harness answer ${short(runId)} <approve|deny>`));
      return void store.close();
    }
    const c = store.claim('cli', { runId });
    if (!c) { console.log(C.r('could not claim the run (another worker holds it)')); return void store.close(); }
    console.log(C.dim(`resuming from event ${store.lastSeq(runId)}…`));
    const { worker } = makeWorker(store, WORK);
    const res = await worker().run(runId, c.leaseToken, {});
    printLive(store, runId);
    console.log(res.status === 'completed' ? C.g(`✓ ${res.reason}`) : C.y(`${res.status} — ${res.reason}`));
    store.close();
  },

  answer([id, response]) {
    const store = open(); const runId = resolve(store, id);
    const pending = store.humanRequests(runId, 'pending');
    if (!pending.length) return void console.log(C.dim('nothing pending')), store.close();
    store.answerHumanRequest(pending[0].id, response ?? 'approve');
    console.log(C.g(`answered "${response ?? 'approve'}"`) + C.dim(`  now: harness resume ${short(runId)}`));
    store.close();
  },

  replay([id, ...rest]) {
    const store = open(); const runId = resolve(store, id);
    const at = flag(rest, '--at');
    const r = replay(store, runId, { at: at ? Number(at) : null });
    console.log(C.b(`Replay of ${short(runId)}${at ? ` at event ${at}` : ''}`));
    console.log(C.dim(`reconstructed from the event log — no model calls, no cost`));
    console.log('');
    console.log(summarise(store, runId, r.state));
    store.close();
  },

  fork([id, ...rest]) {
    const store = open(); const runId = resolve(store, id);
    const at = Number(flag(rest, '--at'));
    if (!Number.isInteger(at)) die('usage: harness fork <run> --at <seq>');
    const f = fork(store, runId, at);
    console.log(C.g(`forked ${short(runId)} @${at} -> ${C.b(short(f.run_id))}`));
    if (!f.at_turn_boundary) {
      const better = nearestTurnBoundary(store, runId, at);
      console.log(C.y(`  warning: event ${at} is MID-TURN — ${f.open_tool_calls.length} tool call(s) were`));
      console.log(C.y(`           requested but never resolved: ${f.open_tool_calls.join(', ')}`));
      console.log(C.dim(`           the resumed model sees "[no result recorded]" for these and may`));
      console.log(C.dim(`           treat them as already done. For a clean split try --at ${better}.`));
    }
    console.log(C.dim('  history up to that point is inherited; the future is new'));
    console.log(C.y('  note: the WORKSPACE is not rewound automatically.'));
    console.log(C.dim(`        run the fork in a fresh workspace, or restore a checkpoint first.`));
    console.log(C.dim(`  continue with:  harness resume ${short(f.run_id)}`));
    store.close();
  },

  rerun([id]) {
    const store = open(); const runId = resolve(store, id);
    const r = rerun(store, runId);
    console.log(C.g(`new run ${short(r.run_id)} from the same task`) + C.dim(' (no history inherited)'));
    console.log(C.dim(`  start with:  harness resume ${short(r.run_id)}`));
    store.close();
  },

  explain([id, ...rest]) {
    const store = open(); const runId = resolve(store, id);
    console.log(explain(store, runId, { verbose: rest.includes('--verbose'), full: rest.includes('--full') }));
    store.close();
  },

  doctor() {
    const store = open();
    const runs = store.listRuns({ limit: 1000 });
    const stale = runs.filter(r => r.status === 'running' && (r.lease_expires_at ?? 0) < Date.now());
    const waiting = runs.filter(r => r.status === 'paused');
    console.log(C.b('harness doctor'));
    console.log(`  home              ${HOME}`);
    console.log(`  database          ${DB} ${fs.existsSync(DB) ? C.g('ok') : C.r('missing')}`);
    console.log(`  runs              ${runs.length}`);
    console.log(`  model endpoint    ${process.env.HARNESS_BASE_URL ?? C.r('NOT SET (HARNESS_BASE_URL)')}`);
    console.log(`  api key           ${process.env.HARNESS_API_KEY || process.env.OPENAI_API_KEY ? C.g('present') : C.y('absent')}`);
    console.log(`  posture           ${process.env.HARNESS_POSTURE ?? 'auto'}`);
    console.log(`  ${stale.length ? C.y(`stale leases      ${stale.length} (run 'harness reap')`) : C.g('stale leases      none')}`);
    console.log(`  ${waiting.length ? C.y(`awaiting human    ${waiting.length}`) : C.g('awaiting human    none')}`);
    let sqliteOk = true;
    try { store.db.exec('PRAGMA integrity_check'); } catch { sqliteOk = false; }
    console.log(`  db integrity      ${sqliteOk ? C.g('ok') : C.r('FAILED')}`);
    store.close();
  },

  reap() {
    const store = open();
    const r = reap(store); const h = expireHumanRequests(store);
    console.log(`requeued ${r.requeued}, parked ${r.parked}, expired human requests ${h.expired}`);
    for (const a of r.actions) console.log(C.dim(`  ${short(a.run_id)} ${a.action} (attempt ${a.attempts})`));
    store.close();
  },

  help() { usage(); },
};

// ───────────────────────────────────────────────────────────────── helpers
function printLive(store, runId) {
  const evs = store.events(runId);
  for (const e of evs) {
    const p = e.payload || {};
    if (e.type === 'tool.succeeded') console.log(C.g('  ✓ ') + `${p.name} ${C.dim(oneline(p.result))}`);
    else if (e.type === 'tool.failed') console.log(C.r('  ✕ ') + `${p.name} ${C.dim(oneline(p.error))}`);
    else if (e.type === 'tool.denied') console.log(C.r('  ⛔ ') + `${p.name} ${C.dim(oneline(p.reason))}`);
    else if (e.type === 'degraded') console.log(C.y('  ⚠ ') + C.dim(`[${p.subsystem}] ${oneline(p.reason)}`));
    else if (e.type === 'human.requested') console.log(C.y('  🙋 ') + oneline(p.prompt));
    else if (e.type === 'run.lease_lost') console.log(C.y('  ✕ Process terminated'));
    else if (e.type === 'tool.recovery_decided')
      console.log(C.c(`  ♻ Recovered from event #${e.seq}`) + C.dim(` — ${p.name}: ${p.decision}`));
  }
}
const oneline = (s) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 60);
function flag(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
function die(m) { console.error(C.r(m)); process.exit(2); }
function resolve(store, id) {
  if (!id) die('missing run id');
  const want = id.replace(/^#/, '');
  const all = store.listRuns({ limit: 1000 });
  const hit = all.find(r => r.id === id || r.id === `run_${want}` || r.id.endsWith(want));
  if (!hit) die(`no such run: ${id}`);
  return hit.id;
}
function usage() {
  console.log(`${C.b('harness')} — durable agent runs you can replay and fork

  harness run "<task>"           start a run in the current directory
  harness list                   all runs
  harness status <run>           where a run got to
  harness resume <run>           continue a run (after a crash, or a human answer)
  harness answer <run> <reply>   answer a question the run is waiting on
  harness explain <run>          what the run actually did      [--verbose] [--full]
  harness replay <run>           reconstruct history            [--at <seq>]
  harness fork <run> --at <seq>  branch from a point in history
  harness rerun <run>            fresh run of the same task
  harness reap                   reclaim runs whose worker died
  harness doctor                 environment check

${C.dim('config:')}  HARNESS_BASE_URL  HARNESS_API_KEY  HARNESS_MODEL  HARNESS_HOME  HARNESS_POSTURE`);
}

/**
 * Package version, read from the manifest rather than duplicated in source — a hardcoded string
 * silently drifts from what npm actually published.
 */
function packageVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8'));
    return pkg.version ?? 'unknown';
  } catch { return 'unknown'; }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === '-v' || cmd === '--version' || cmd === 'version') {
  console.log(packageVersion());
  process.exit(0);
}
if (!cmd || cmd === '-h' || cmd === '--help') { usage(); process.exit(0); }
if (!cmds[cmd]) { console.error(C.r(`unknown command: ${cmd}`)); usage(); process.exit(2); }
try { await cmds[cmd](args); } catch (e) { console.error(C.r(e.message)); process.exit(1); }
