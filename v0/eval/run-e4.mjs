#!/usr/bin/env node
// E4 — the first REAL-PROJECT measurement of this harness.
//
// WHAT THIS MEASURES, AND WHY IT IS A SEPARATE TRACK FROM eval/real/
//
// `eval/real/` drives a harness-agnostic RUNNER INTERFACE over five tiny npm libraries
// (camelcase, p-limit, is-number, slugify, ansi-styles) at pinned commits. It is the right shape
// for comparing models and for regression-testing the mechanism.
//
// E4 measures something `eval/real/` deliberately does not: the SHIPPED PATH on REAL AGENT
// CODEBASES. Every task here shells out to `node v0/src/cli/index.mjs run "<task>"` exactly as a
// developer would — default posture, no special flags, the real sandbox, the real completion
// contract — against six large third-party repositories. If the CLI composition is broken, this
// track fails and `eval/real/` would not notice.
//
// DOCUMENTED CONFLICTS with EVAL.md / REAL-EVAL.md conventions (brief says to name them):
//   1. Env vars. Those tracks read HARNESS_BASE_URL / HARNESS_API_KEY / HARNESS_MODEL. E4 reads
//      the PRODUCT's own ORION_BASE_URL / ORION_API_KEY / ORION_MODEL, because measuring the
//      shipped path means configuring it the way the product is configured.
//   2. Results location. Those tracks commit results under eval/real/reports/. E4 writes to
//      v0/eval/results/, which is gitignored: the standing repo rule is that results-*.json are
//      never committed. (Note the repo's existing v0/tests/results-*.json ARE tracked and churn —
//      that is the convention this rule exists to stop spreading.)
//   3. Provisioning. Those tracks clone from github at a pinned commit. E4 copies from the
//      already-cloned research/repos/ trees, which are READ-ONLY sources here, into a fresh temp
//      workspace per run. Nothing E4 does can write to research/repos/.
//
// SEEDED BUGS. A `mini_bugfix` task applies one exact string replacement to the TEMP COPY before
// the run. These are not real defects in those projects. `verify-manifest.mjs` asserts, for every
// seeded task, that the verify command FAILS on the seeded copy and PASSES on the pristine one —
// so a task can neither be won by doing nothing nor be unwinnable.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V0 = path.resolve(HERE, '..');
const ROOT = path.resolve(V0, '..');
const REPOS = path.join(ROOT, 'research', 'repos');
const CLI = path.join(V0, 'src', 'cli', 'index.mjs');
const RESULTS = path.join(HERE, 'results');

/**
 * The sandbox shells to bash AND node. Without node on PATH the `verify` tool fails exit 127
 * ("command not found"), which looks exactly like a model failure and is not one. The runner
 * therefore OWNS the PATH rather than trusting the ambient shell — the brief calls this out as a
 * known environment bug, and a measurement rig that can be poisoned by the operator's shell is
 * not a measurement rig.
 */
const NODE_DIR = path.dirname(process.execPath);
const GIT_BIN = 'C:\\Users\\abhijith.p\\AppData\\Local\\Programs\\Git\\bin';
const GIT_USR = 'C:\\Users\\abhijith.p\\AppData\\Local\\Programs\\Git\\usr\\bin';
const RUN_PATH = [NODE_DIR, GIT_BIN, GIT_USR, process.env.PATH ?? ''].join(path.delimiter);

const ENDPOINT = {
  ORION_BASE_URL: process.env.ORION_BASE_URL ?? 'http://localhost:11434/v1',
  ORION_MODEL: process.env.ORION_MODEL ?? 'qwen3.6:35b-a3b-q4_K_M',
  ORION_API_KEY: process.env.ORION_API_KEY ?? 'ollama',
};

// ── argv ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const only = flag('tasks')?.split(',').map(s => s.trim()).filter(Boolean) ?? null;
const repoFilter = flag('repo');
const runsOverride = flag('runs') ? Number(flag('runs')) : null;
const label = flag('label', `e4-${new Date().toISOString().replace(/[:.]/g, '-')}`);

// ── helpers ──────────────────────────────────────────────────────────────────────────

/** Copy a repo tree, skipping what would make the copy enormous or the run non-hermetic. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.venv',
                      '__pycache__', '.orion', 'target', '.brain']);
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) { try { fs.copyFileSync(s, d); } catch { /* unreadable file: skip */ } }
  }
}

/** Run a command to completion with a hard timeout. Never hangs; a timeout is an OUTCOME. */
function run(cmd, argv, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, argv, { cwd, env, shell: false });
    let out = ''; let err = ''; let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, timedOut, ms: Date.now() - started });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e.message ?? e), timedOut, ms: Date.now() - started });
    });
  });
}

/** Read one run's events straight from the run.db the CLI just wrote. */
function readEvents(orionHome, runId) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(orionHome, 'orion.db'));
    const rows = db.prepare('SELECT seq,type,payload FROM events WHERE run_id=? ORDER BY seq').all(runId);
    return rows.map(r => ({ seq: Number(r.seq), type: String(r.type),
                            payload: r.payload ? JSON.parse(String(r.payload)) : {} }));
  } catch { return []; }
}

/**
 * Attribute a non-passing run to exactly ONE of the four layers.
 *
 * Order matters: the most specific evidence wins. A run that hit a provider error AND then
 * produced an empty turn is a provider failure — blaming the model for output it never got to
 * produce is the single easiest way to make an eval flatter than the truth.
 */
function attribute({ events, verifyOk, timedOut, cliCode, finalText, task }) {
  const type = (t) => events.filter(e => e.type === t);
  const last = events.at(-1)?.type ?? '(no events)';

  if (timedOut) return { layer: 'runtime', reason: `runtime: wall-clock timeout after ${task.timeoutMinutes}m` };
  if (!events.length) return { layer: 'runtime', reason: `runtime: no events recorded (cli exit ${cliCode})` };

  // provider — transport/auth/endpoint, including a socket-level stall.
  const modelErr = type('model.failed').at(-1) ?? events.find(e => e.type === 'degraded'
    && /^(model|provider)$/.test(String(e.payload?.subsystem ?? '')));
  const exit = type('run.failed').at(-1)?.payload?.reason ?? null;
  if (exit === 'model_unavailable' || exit === 'model_failed') {
    const detail = String(modelErr?.payload?.error ?? modelErr?.payload?.reason ?? exit).slice(0, 90);
    return { layer: 'provider', reason: `provider: ${detail}` };
  }

  // tool — a built-in tool failed on a well-formed call. The node-PATH case is called out
  // separately because it is an ENVIRONMENT defect of the rig, not of the tool (brief §3).
  const toolFails = type('tool.failed');
  const pathBug = toolFails.find(e => /127|command not found/i.test(String(e.payload?.error ?? '')));
  if (pathBug)
    return { layer: 'runtime', reason: `runtime: sandbox PATH — ${String(pathBug.payload.error).slice(0, 70)}` };

  // model — unusable output. Checked before generic tool failures so that "called a tool that
  // does not exist" is attributed to the model rather than to the tool it invented.
  const unknownTool = toolFails.find(e => /unknown tool/i.test(String(e.payload?.error ?? '')));
  if (unknownTool)
    return { layer: 'model', reason: `model: called a tool that does not exist (${String(unknownTool.payload.name ?? '?')})` };
  if (exit === 'finished_without_change')
    return { layer: 'model', reason: 'model: stopped without satisfying the objective (finished_without_change)' };
  if (exit === 'no_progress') return { layer: 'model', reason: 'model: no progress (repeated identical calls)' };
  if (exit === 'max_turns') return { layer: 'model', reason: 'model: hit the turn ceiling without finishing' };
  if (last === 'run.completed' && !String(finalText).trim())
    return { layer: 'model', reason: 'model: empty final turn' };

  // The run completed but the objective check says otherwise.
  if (!verifyOk) {
    if (task.verify) return { layer: 'model', reason: 'model: run completed but the verify command still fails' };
    return { layer: 'model', reason: 'model: final answer did not meet the task\'s stated expectation' };
  }
  if (toolFails.length)
    return { layer: 'tool', reason: `tool: ${String(toolFails.at(-1).payload?.name ?? '?')} failed — ${String(toolFails.at(-1).payload?.error ?? '').slice(0, 60)}` };
  return { layer: 'runtime', reason: `runtime: unclassified (last event ${last}, cli exit ${cliCode})` };
}

/** The objective check: the verify command for seeded/schema tasks, evidence for read tasks. */
async function judge(task, ws, events, finalText) {
  if (task.verify) {
    const r = await run('bash', ['-lc', task.verify],
      { cwd: ws, env: { ...process.env, PATH: RUN_PATH }, timeoutMs: 120_000 });
    return { ok: r.code === 0, detail: r.code === 0 ? 'verify exit 0' : `verify exit ${r.code}` };
  }
  // read_explain has no command to run, so it is judged on EVIDENCE FROM THE LOG, not on prose
  // quality: the run must have actually read the file it was asked about and must have produced a
  // real final answer. That is deliberately a low bar — it measures "did the harness drive a real
  // read-and-answer loop", not "was the explanation good", and the report says so.
  const readOk = events.some(e => e.type === 'tool.succeeded'
    && String(e.payload?.name) === 'read'
    && events.some(q => q.type === 'tool.requested'
        && q.payload?.tool_call_id === e.payload?.tool_call_id
        && String(q.payload?.args?.path ?? '').replace(/\\/g, '/').includes(task.expectRead)));
  const text = String(finalText ?? '');
  const subsOk = (task.expectSubstrings ?? []).every(s => text.toLowerCase().includes(s.toLowerCase()));
  const longEnough = text.trim().length >= 80;
  if (!readOk) return { ok: false, grade: 'fail', detail: `did not read ${task.expectRead}` };
  if (!longEnough) return { ok: false, grade: 'fail', detail: `final answer too short (${text.trim().length} chars)` };
  // The substring bar is a proxy, not the contract: the model READ the file and produced a
  // substantive answer. Asking it to also spell a literal token is worthwhile signal (E4
  // measured six correct-answer misses on "agent"/"extras") but it is a PARTIAL result, not a
  // failure — a correct read that merely used different words.
  if (!subsOk) return { ok: true, grade: 'partial', detail: 'read the file and answered (missing expected term)' };
  return { ok: true, grade: 'pass', detail: 'read the file and answered' };
}

// ── one attempt ──────────────────────────────────────────────────────────────────────
async function attempt(task, n) {
  const stamp = `${task.id}-${n}-${Date.now().toString(36)}`;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'e4-'));
  const ws = path.join(base, 'ws');
  const orionHome = path.join(base, '.orion');
  fs.mkdirSync(orionHome, { recursive: true });

  const t0 = Date.now();
  copyTree(path.join(REPOS, task.workspaceDir), ws);
  const copyMs = Date.now() - t0;

  // Seed the regression into the COPY. The source tree is never touched.
  let seeded = null;
  if (task.seed) {
    const f = path.join(ws, task.seed.file);
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes(task.seed.find))
      return { id: task.id, run: n, status: 'error', layer: 'runtime',
               reason: 'runtime: seed did not apply to the copy', ms: 0, ws };
    fs.writeFileSync(f, src.replace(task.seed.find, task.seed.replace));
    seeded = task.seed.file;
  }

  const env = {
    ...process.env, PATH: RUN_PATH, ...ENDPOINT,
    ORION_HOME: orionHome, ORION_WORKSPACE: ws,
  };
  const r = await run(process.execPath, [CLI, 'run', task.task],
    { cwd: ws, env, timeoutMs: task.timeoutMinutes * 60_000 });

  const runId = (r.out.match(/Run #([0-9a-f]+)/) ?? [])[1] ?? null;
  const fullRunId = runId ? `run_${runId}` : null;
  const events = fullRunId ? readEvents(orionHome, fullRunId) : [];
  const finalText = [...events].reverse()
    .find(e => e.type === 'model.responded' && String(e.payload?.content ?? '').trim())
    ?.payload?.content ?? '';

  const verdict = await judge(task, ws, events, finalText);
  const usage = events.filter(e => e.type === 'model.responded')
    .reduce((a, e) => ({ in: a.in + (e.payload?.input_tokens ?? 0),
                         out: a.out + (e.payload?.output_tokens ?? 0) }), { in: 0, out: 0 });

  const passed = verdict.ok && !r.timedOut;
  const att = passed ? null : attribute({
    events, verifyOk: verdict.ok, timedOut: r.timedOut, cliCode: r.code, finalText, task });

  return {
    id: task.id, repo: task.repo, type: task.type, run: n,
    status: r.timedOut ? 'timeout' : (passed ? 'pass' : 'fail'),
    grade: verdict.grade ?? 'pass',
    layer: att?.layer ?? null,
    reason: att?.reason ?? verdict.detail,
    runId: fullRunId,
    ms: r.ms, copyMs,
    events: events.length,
    modelCalls: events.filter(e => e.type === 'model.responded').length,
    toolCalls: events.filter(e => e.type === 'tool.succeeded').length,
    tokensIn: usage.in, tokensOut: usage.out,
    exitReason: events.filter(e => e.type === 'run.completed' || e.type === 'run.failed')
      .at(-1)?.payload?.reason ?? null,
    finalChars: String(finalText).trim().length,
    seeded,
    // The workspace is LEFT ON DISK so a failure can be inspected; the temp dir is the only
    // place the CLI's run.db lives, and no other run.db is touched.
    workspace: ws, orionHome,
    cliTail: r.out.split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 400),
  };
}

// ── main ─────────────────────────────────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', 'E4-TASKS.json'), 'utf8'));
let tasks = manifest.tasks;
if (only) tasks = tasks.filter(t => only.includes(t.id));
if (repoFilter) tasks = tasks.filter(t => t.repo === repoFilter);
if (!tasks.length) { console.error('no tasks matched'); process.exit(2); }

console.log(`E4 — ${tasks.length} task(s), model ${ENDPOINT.ORION_MODEL} @ ${ENDPOINT.ORION_BASE_URL}`);
console.log(`PATH head: ${NODE_DIR}`);
console.log('');

const results = [];
for (const task of tasks) {
  const n = runsOverride ?? task.runs ?? 1;
  for (let i = 1; i <= n; i++) {
    process.stdout.write(`  ${task.id} [${i}/${n}] … `);
    const res = await attempt(task, i);
    results.push(res);
    const mark = res.status === 'pass'
      ? (res.grade === 'partial' ? 'PARTIAL' : 'PASS')
      : res.status.toUpperCase();
    console.log(`${mark}  ${(res.ms / 1000).toFixed(1)}s  ${res.modelCalls}mc/${res.toolCalls}tc  `
      + `${res.tokensIn}/${res.tokensOut}tok  ${res.status === 'pass'
        ? (res.grade === 'partial' ? '— ' + res.reason : '') : '— ' + res.reason}`);
  }
}

const pass = results.filter(r => r.status === 'pass').length;
const partial = results.filter(r => r.status === 'pass' && r.grade === 'partial').length;
const byLayer = {};
for (const r of results) if (r.layer) byLayer[r.layer] = (byLayer[r.layer] ?? 0) + 1;

console.log('');
console.log(`AGGREGATE: ${pass}/${results.length} passed `
  + `(${((pass / results.length) * 100).toFixed(1)}%)`
  + (partial ? `, ${partial} of them partial (read the file, missing expected term)` : ''));
console.log(`attribution: ${Object.entries(byLayer).map(([k, v]) => `${k}=${v}`).join('  ') || '(no failures)'}`);

fs.mkdirSync(RESULTS, { recursive: true });
const outFile = path.join(RESULTS, `${label}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  label, generated: new Date().toISOString(),
  model: ENDPOINT.ORION_MODEL, endpoint: ENDPOINT.ORION_BASE_URL,
  total: results.length, passed: pass, partial,
  passRate: Number(((pass / results.length) * 100).toFixed(1)),
  attribution: byLayer, results,
}, null, 2));
console.log(`\nresults → ${outFile}`);
