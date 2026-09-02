// Part C — repeatability study for the 8 HIGH-confidence failure tasks, n=3, Gemma.
//
// Model-B mode (Stage 1E): the same runner is used for the editing-family protocol with ONLY the
// model changed (adapter parity is verified separately, see research/capability-v1/
// model-b-editing-protocol.md). Two backward-compatible knobs:
//   RUN_LABEL=<name>  output-artifact prefix, default "gemma4-31b" — so Model-B runs are never
//                     labled as Gemma and never collide with the Gemma repeat artifacts.
//   ONLY_IDS=a,b,c    restrict to a subset of TASKS (default: all 8).
// Default behaviour is byte-for-byte as before.
//
// SAFETY: this NEVER writes runs/<label>.json. run-baseline.mjs defaults to that path and would
// overwrite eval/capability-v1/runs/gemma4-31b.json — the valid Stage-1 baseline. Every repeat
// goes to runs/repeats/ under a per-task, per-run label, and the runner asserts the baseline is
// untouched before and after.
//
// Nothing is tuned between repeats: same model, prompt, tools, runtime, task, commit, verifier,
// limits and sandbox. The only thing that varies is the sampling.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runTask } from './run-baseline.mjs';
import { createOpenAICompatModel } from '../../v0/src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../v0/src/agent/model/shims/gemma-tool-calls.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'runs', 'gemma4-31b.json');
const OUTDIR = path.join(HERE, 'runs', 'repeats');

/**
 * The 8 HIGH-confidence failures from the Stage-1 failure table.
 *
 * NOT the whole failure distribution: these are 2 long-horizon + 4 editing + 2 termination, against
 * a full distribution of 6 + 4 + 4. The 6 MEDIUM-confidence failures stay at n=1. Repeating these
 * strengthens evidence for THESE EIGHT, and does not re-measure the distribution.
 */
const TASKS = [
  'pallets__flask-4045',
  'pallets__flask-5063',
  'pylint-dev__pylint-6506',
  'pytest-dev__pytest-11148',
  'pytest-dev__pytest-6116',
  'pytest-dev__pytest-7432',
  'pytest-dev__pytest-8365',
  'pytest-dev__pytest-8906',
];

const N = Number(process.env.REPEATS ?? 3);
const RUN_LABEL = process.env.RUN_LABEL ?? 'gemma4-31b';
const ONLY_IDS = process.env.ONLY_IDS
  ? new Set(process.env.ONLY_IDS.split(',').map(s => s.trim()).filter(Boolean))
  : null;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const baselineSha = sha(BASELINE);
console.log(`baseline guard: ${path.basename(BASELINE)} sha256=${baselineSha.slice(0, 16)}…`);

const frozen = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', 'frozen-corpus.json'), 'utf8'));
const local = new Map(JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', 'corpus.json'), 'utf8'))
  .tasks.map(t => [t.task_id, t]));
const tasks = frozen.tasks.filter(t => TASKS.includes(t.task_id) && (!ONLY_IDS || ONLY_IDS.has(t.task_id)))
  .map(t => {
    const l = local.get(t.task_id);
    if (!l) throw new Error(`no local environment for ${t.task_id}`);
    return { ...t, python_exe: l.python_exe, venv: l.venv, work_dir: l.work_dir };
  });
const expected = ONLY_IDS ? ONLY_IDS.size : TASKS.length;
if (tasks.length !== expected)
  throw new Error(`expected ${expected} tasks, found ${tasks.length}`);
if (ONLY_IDS) {
  const missing = [...ONLY_IDS].filter(id => !TASKS.includes(id));
  if (missing.length) throw new Error(`ONLY_IDS outside the 8-TASK set: ${missing.join(', ')}`);
}

fs.mkdirSync(OUTDIR, { recursive: true });

const model = createOpenAICompatModel({
  baseUrl: process.env.HARNESS_BASE_URL,
  apiKey: process.env.HARNESS_API_KEY ?? 'not-needed',
  model: process.env.HARNESS_MODEL,
  timeoutMs: 300_000, maxRetries: 2,
  shims: [applyGemmaToolCallShim],
});

console.log(`repeats: ${tasks.length} tasks x ${N} runs = ${tasks.length * N} · corpus ${frozen.corpus_version}`);
console.log('─'.repeat(96));

for (const task of tasks) {
  for (let r = 1; r <= N; r++) {
    const label = `${RUN_LABEL}-${task.task_id}-r${r}`;
    const out = path.join(OUTDIR, `${label}.json`);
    if (fs.existsSync(out)) { console.log(`  skip (exists) ${label}`); continue; }

    process.stdout.write(`  ${task.task_id.padEnd(28)} r${r} `);
    let res;
    try { res = await runTask(task, model); }
    catch (e) { res = { task_id: task.task_id, outcome: 'INFRA', infra: String(e.message).slice(0, 300) }; }

    fs.writeFileSync(out, JSON.stringify({
      model: process.env.HARNESS_MODEL,
      corpus_version: frozen.corpus_version, corpus_sha256: frozen.corpus_sha256,
      runtime_commit: frozen.runtime_commit,
      repeat_index: r, of: N, at: new Date().toISOString(), results: [res],
    }, null, 2));

    const mark = res.task_success ? 'PASS' : (res.outcome ?? (res.timed_out ? 'TIMEOUT' : 'FAIL'));
    console.log(`${String(mark).padEnd(8)} ${res.reason ?? res.infra ?? ''} ${res.wall_ms ? Math.round(res.wall_ms / 1000) + 's' : ''}`);

    // The baseline must be byte-identical after every single run, not merely at the end.
    if (sha(BASELINE) !== baselineSha)
      throw new Error('FATAL: the Stage-1 baseline artifact changed during the repeat study');
  }
}

console.log('─'.repeat(96));
console.log(`baseline intact: ${sha(BASELINE) === baselineSha}`);
console.log(`wrote ${fs.readdirSync(OUTDIR).length} repeat artifacts to runs/repeats/`);
