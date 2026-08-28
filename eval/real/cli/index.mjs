#!/usr/bin/env node
// Real-repository evaluation CLI.
//
//   node eval/real/cli/index.mjs list
//   node eval/real/cli/index.mjs bracket [--tasks a,b] [--repository r]
//   node eval/real/cli/index.mjs run     [--tasks a,b] [--difficulty d] [--repeat N] [--out f.json]
//   node eval/real/cli/index.mjs report  <results.json>
//   node eval/real/cli/index.mjs compare <baseline.json> <candidate.json>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REAL_TASKS, selectRealTasks } from '../tasks/index.mjs';
import { REPOSITORIES } from '../repositories/index.mjs';
import { REAL_RUNNERS, buildModel } from '../runners/index.mjs';
import { verifyReal } from '../evaluators/index.mjs';
import { bracketTask } from '../setup/bracket.mjs';
import { checkInfrastructure } from '../environments/index.mjs';
import { aggregate } from '../../metrics/index.mjs';
import { OUTCOME } from '../tasks/schema.mjs';
import { explain } from '../../../v0/src/core/run/explain.mjs';
import { classifyFailure } from '../evaluators/failures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_ROOT = path.join(HERE, '..');
const EVAL_ROOT = path.join(os.tmpdir(), 'harness-real-eval');

const C = process.stdout.isTTY
  ? { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`,
      d: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` }
  : new Proxy({}, { get: () => (s => s) });

const flag = (a, n, d = null) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const BADGE = { PASS: C.g('PASS '), FAIL: C.r('FAIL '), TIMEOUT: C.y('TMOUT'), INFRA_FAILURE: C.y('INFRA') };

function pickTasks(args) {
  const ids = flag(args, '--tasks')?.split(',').map(s => s.trim()).filter(Boolean);
  return selectRealTasks({
    ids, difficulty: flag(args, '--difficulty'),
    category: flag(args, '--category'), repository: flag(args, '--repository'),
  });
}

// ── list ────────────────────────────────────────────────────────────────
function cmdList() {
  console.log(C.d('ID                             REPO           DIFF    CATEGORIES'));
  for (const t of REAL_TASKS)
    console.log(`${t.task_id.padEnd(31)}${t.repository.padEnd(15)}${t.difficulty.padEnd(8)}${t.categories.join(',')}`);
  const byD = {}, byR = {};
  for (const t of REAL_TASKS) { byD[t.difficulty] = (byD[t.difficulty] ?? 0) + 1; byR[t.repository] = (byR[t.repository] ?? 0) + 1; }
  console.log(C.d(`\n${REAL_TASKS.length} tasks over ${Object.keys(byR).length} repositories — ` +
    Object.entries(byD).map(([k, v]) => `${v} ${k}`).join(', ')));
  console.log(C.d(`repositories: ${Object.entries(byR).map(([k, v]) => `${k}(${v})`).join(' ')}`));
}

// ── bracket ─────────────────────────────────────────────────────────────
async function cmdBracket(args) {
  const infra = checkInfrastructure();
  if (!infra.ok) { console.error(C.r('infrastructure unavailable: ' + infra.problems.join('; '))); process.exit(2); }

  const tasks = pickTasks(args);
  console.log(C.b(`bracketing ${tasks.length} tasks`) + C.d('  (preflight-negative + oracle-positive)'));
  console.log('─'.repeat(78));
  const rows = [];
  for (const t of tasks) {
    const r = await bracketTask(t, { root: EVAL_ROOT });
    rows.push(r);
    console.log(`  ${r.valid ? C.g('VALID  ') : C.r('INVALID')} ${t.task_id.padEnd(31)}` +
      C.d(`pre=${r.preflight?.outcome ?? '-'} oracle=${r.oracle?.outcome ?? '-'}`));
    if (!r.valid) console.log(C.d(`          ${r.excluded_reason}`));
  }
  const valid = rows.filter(r => r.valid).length;
  console.log('─'.repeat(78));
  console.log(C.b(`  ${valid}/${rows.length} valid`));
  if (valid < rows.length)
    console.log(C.y('  invalid tasks MUST be excluded from scoring — they are not agent failures'));

  const out = flag(args, '--out', path.join(REAL_ROOT, 'reports', 'bracket.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  console.log(C.d(`\nwrote ${out}`));
}

// ── run ─────────────────────────────────────────────────────────────────
async function cmdRun(args) {
  if (!process.env.HARNESS_BASE_URL) {
    console.error(C.r('No model configured.'));
    console.error('  export HARNESS_BASE_URL / HARNESS_API_KEY / HARNESS_MODEL');
    console.error('  (the evaluation must never silently fall back to a scripted model)');
    process.exit(2);
  }
  const infra = checkInfrastructure();
  if (!infra.ok) { console.error(C.r('infrastructure unavailable: ' + infra.problems.join('; '))); process.exit(2); }

  const runnerName = flag(args, '--runner', 'harness-v0');
  const runner = REAL_RUNNERS[runnerName];
  if (!runner) { console.error(C.r(`unknown runner ${runnerName}`)); process.exit(2); }

  const tasks = pickTasks(args);
  if (!tasks.length) { console.error(C.r('no tasks selected')); process.exit(2); }
  const repeat = Number(flag(args, '--repeat', '1'));
  const label = flag(args, '--label', runnerName);
  const model = buildModel();

  console.log(C.b(label) + C.d(`  runner=${runnerName}  model=${process.env.HARNESS_MODEL}  ` +
    `tasks=${tasks.length}  repeat=${repeat}  compact=${process.env.HARNESS_COMPACT === '1'}`));
  console.log('─'.repeat(78));

  const results = [];
  for (const task of tasks) {
    for (let rep = 0; rep < repeat; rep++) {
      const tag = repeat > 1 ? `${task.task_id}#${rep}` : task.task_id;
      process.stdout.write(`  ${tag.padEnd(33)}${C.d(task.difficulty.padEnd(7))}`);

      let r;
      try {
        r = await runner.run(task, { model, root: EVAL_ROOT });
      } catch (e) {
        results.push(infraRow(task, rep, `runner threw: ${e.message}`));
        console.log(BADGE.INFRA_FAILURE + ' ' + C.d(String(e.message).slice(0, 44)));
        continue;
      }

      if (r.infraError) {
        results.push(infraRow(task, rep, r.infraError));
        console.log(BADGE.INFRA_FAILURE + ' ' + C.d(r.infraError.slice(0, 44)));
        continue;
      }

      const ver = r.timedOut
        ? { outcome: OUTCOME.TIMEOUT, detail: `exceeded ${task.timeout_ms}ms` }
        : verifyReal(task, r.repo, { dir: r.dir, testFileGuard: r.guard });

      const row = {
        task_id: task.task_id, repeat: rep, runner: runnerName,
        repository: task.repository, base_commit: REPOSITORIES[task.repository].commit,
        difficulty: task.difficulty, categories: task.categories,
        outcome: ver.outcome, detail: ver.detail, evidence: (ver.evidence ?? '').slice(-1500),
        agent_status: r.status, agent_reason: r.reason, run_error: r.runError,
        final_message: String(r.result ?? '').slice(0, 400),
        metrics: r.metrics,
        failure_class: ver.outcome === 'PASS' ? null
          : classifyFailure({ outcome: ver.outcome, detail: ver.detail, metrics: r.metrics,
                              status: r.status, reason: r.reason, runError: r.runError }),
        explain: explain(r.store, r.runId),
      };
      results.push(row);
      r.close();

      const m = r.metrics;
      console.log(`${BADGE[ver.outcome] ?? ver.outcome} ` +
        C.d(`${(m.wall_ms / 1000).toFixed(0)}s ${m.model_calls}mc ${m.tool_calls}tc ` +
            `${m.input_tokens + m.output_tokens}tok`) +
        (ver.outcome === 'PASS' ? '' : C.d(`  ${row.failure_class ?? ''} ${String(ver.detail).slice(0, 34)}`)));
    }
  }

  const agg = aggregate(results);
  printSummary(agg, results);

  const out = flag(args, '--out', path.join(REAL_ROOT, 'reports', `${label.replace(/\W+/g, '-')}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    label, runner: runnerName, model: process.env.HARNESS_MODEL,
    endpoint_kind: 'openai-compatible',
    compaction: process.env.HARNESS_COMPACT === '1' ? 'supersede' : 'none',
    at: new Date().toISOString(), node: process.version,
    repositories: Object.fromEntries(Object.entries(REPOSITORIES)
      .map(([k, v]) => [k, { url: v.url, commit: v.commit, test_command: v.test_command }])),
    aggregate: agg, results,
  }, null, 2));
  console.log(C.d(`\nwrote ${out}`));
}

const infraRow = (task, rep, detail) => ({
  task_id: task.task_id, repeat: rep, repository: task.repository,
  difficulty: task.difficulty, categories: task.categories,
  outcome: OUTCOME.INFRA_FAILURE, detail, failure_class: 'environment_failure',
  metrics: { wall_ms: 0, model_calls: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
});

function printSummary(a, results = []) {
  console.log('─'.repeat(78));
  console.log(C.b(`  ${a.passed}/${a.tasks_scored} passed  (${a.success_rate}%)`) +
    (a.infra_failures ? C.y(`   ${a.infra_failures} INFRA excluded`) : ''));
  const bd = Object.entries(a.by_difficulty).map(([k, v]) => `${k} ${v.pass}/${v.total}`).join('  ');
  if (bd) console.log(C.d(`  by difficulty: ${bd}`));
  console.log(C.d(`  wall p50 ${(a.p50_wall_ms / 1000).toFixed(0)}s  p95 ${(a.p95_wall_ms / 1000).toFixed(0)}s`));
  console.log(C.d(`  per success: ${a.model_calls_per_success} model calls, ` +
    `${a.tool_calls_per_success} tool calls, ${a.tokens_per_success} tokens`));

  const fails = results.filter(r => r.outcome !== 'PASS' && r.outcome !== 'INFRA_FAILURE');
  if (fails.length) {
    const byClass = {};
    for (const f of fails) byClass[f.failure_class ?? 'unclassified'] = (byClass[f.failure_class ?? 'unclassified'] ?? 0) + 1;
    console.log(C.d(`  failure classes: ${Object.entries(byClass).sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k}=${v}`).join(' ')}`));
  }
}

// ── report / compare ────────────────────────────────────────────────────
function cmdReport([file]) {
  if (!file) { console.error('usage: report <results.json>'); process.exit(2); }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(C.b(d.label) + C.d(`  ${d.model}  ${d.at}  compaction=${d.compaction}`));
  printSummary(d.aggregate, d.results);
  const fails = d.results.filter(r => r.outcome !== 'PASS');
  if (!fails.length) return;
  console.log('\n' + C.b('failures:'));
  for (const r of fails) {
    console.log(`  ${C.r(r.outcome)} ${r.task_id}  ${C.d(`[${r.failure_class ?? '?'}] ${r.detail ?? ''}`)}`);
    console.log(C.d(`        agent=${r.agent_status}/${r.agent_reason}  ` +
      `${r.metrics.model_calls}mc ${r.metrics.tool_calls}tc dup=${r.metrics.duplicate_action_rate}`));
  }
}

function cmdCompare([a, b]) {
  if (!a || !b) { console.error('usage: compare <baseline.json> <candidate.json>'); process.exit(2); }
  const A = JSON.parse(fs.readFileSync(a, 'utf8')), B = JSON.parse(fs.readFileSync(b, 'utf8'));
  const key = r => `${r.task_id}#${r.repeat}`;
  const ra = Object.fromEntries(A.results.map(r => [key(r), r]));
  const rb = Object.fromEntries(B.results.map(r => [key(r), r]));
  console.log(C.b(`${A.label}  ->  ${B.label}`));
  console.log(`  success: ${A.aggregate.success_rate}%  ->  ${B.aggregate.success_rate}%`);
  console.log(`  tokens/success: ${A.aggregate.tokens_per_success} -> ${B.aggregate.tokens_per_success}\n`);
  let improved = 0, regressed = 0;
  for (const k of [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort()) {
    const x = ra[k], y = rb[k];
    if (!x || !y || x.outcome === y.outcome) continue;
    const better = x.outcome !== 'PASS' && y.outcome === 'PASS';
    if (better) improved++; else regressed++;
    console.log(`  ${better ? C.g('IMPROVED') : C.r('REGRESSED')}  ${k}  ${x.outcome} -> ${y.outcome}`);
  }
  console.log(C.b(`\n  ${improved} improved, ${regressed} regressed`));
  if (regressed) console.log(C.r('  REGRESSIONS PRESENT — do not merge on aggregate score alone'));
}

const cmds = { list: cmdList, bracket: cmdBracket, run: cmdRun, report: cmdReport, compare: cmdCompare };
const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !cmds[cmd]) {
  console.log(`real-eval — capability measurement on pinned real repositories

  node eval/real/cli/index.mjs list
  node eval/real/cli/index.mjs bracket [--tasks a,b] [--repository r]
  node eval/real/cli/index.mjs run [--tasks a,b] [--difficulty d] [--repeat N] [--label L] [--out f.json]
  node eval/real/cli/index.mjs report <results.json>
  node eval/real/cli/index.mjs compare <baseline.json> <candidate.json>

config: HARNESS_BASE_URL  HARNESS_API_KEY  HARNESS_MODEL  [HARNESS_COMPACT=1]`);
  process.exit(cmd ? 2 : 0);
}
await cmds[cmd](args);
