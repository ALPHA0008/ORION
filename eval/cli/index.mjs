#!/usr/bin/env node
// Evaluation CLI.
//
//   node eval/cli/index.mjs run   [--tasks a,b] [--difficulty easy] [--runner harness-v0]
//                                 [--repeat N] [--out reports/x.json] [--label "..."]
//   node eval/cli/index.mjs list
//   node eval/cli/index.mjs report <results.json>
//   node eval/cli/index.mjs compare <baseline.json> <candidate.json>

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { TASKS, selectTasks } from '../tasks/index.mjs';
import { RUNNERS, buildModel } from '../runners/index.mjs';
import { verify } from '../evaluators/index.mjs';
import { aggregate } from '../metrics/index.mjs';
import { OUTCOME } from '../tasks/schema.mjs';
import { explain } from '../../v0/src/core/run/explain.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = path.join(HERE, '..');
const C = process.stdout.isTTY
  ? { g: s=>`\x1b[32m${s}\x1b[0m`, r: s=>`\x1b[31m${s}\x1b[0m`, y: s=>`\x1b[33m${s}\x1b[0m`,
      d: s=>`\x1b[2m${s}\x1b[0m`, b: s=>`\x1b[1m${s}\x1b[0m`, c: s=>`\x1b[36m${s}\x1b[0m` }
  : new Proxy({}, { get: () => (s=>s) });

const flag = (a, n, d = null) => { const i = a.indexOf(n); return i >= 0 ? a[i+1] : d; };
const has  = (a, n) => a.includes(n);

const BADGE = {
  PASS: C.g('PASS '), FAIL: C.r('FAIL '), TIMEOUT: C.y('TMOUT'), INFRA_FAILURE: C.y('INFRA'),
};

async function cmdRun(args) {
  if (!process.env.HARNESS_BASE_URL) {
    console.error(C.r('No model configured.'));
    console.error('  export HARNESS_BASE_URL / HARNESS_API_KEY / HARNESS_MODEL');
    console.error('  (the evaluation must never silently fall back to a scripted model)');
    process.exit(2);
  }
  const runnerName = flag(args, '--runner', 'harness-v0');
  const runner = RUNNERS[runnerName];
  if (!runner) { console.error(C.r(`unknown runner ${runnerName}`)); process.exit(2); }

  const ids = flag(args, '--tasks')?.split(',').map(s => s.trim()).filter(Boolean);
  const tasks = selectTasks({ ids, difficulty: flag(args, '--difficulty'), category: flag(args, '--category') });
  if (!tasks.length) { console.error(C.r('no tasks selected')); process.exit(2); }

  const repeat = Number(flag(args, '--repeat', '1'));
  const label = flag(args, '--label', runnerName);
  const model = buildModel();

  console.log(C.b(`${label}`) + C.d(`  runner=${runnerName}  model=${process.env.HARNESS_MODEL}  tasks=${tasks.length}  repeat=${repeat}`));
  console.log('─'.repeat(78));

  const results = [];
  for (const task of tasks) {
    for (let rep = 0; rep < repeat; rep++) {
      process.stdout.write(`  ${task.task_id.padEnd(28)} ${C.d(task.difficulty.padEnd(6))} `);
      let r, ver;
      try {
        r = await runner.run(task, { model, evalRoot: path.join(os.tmpdir(), 'harness-eval') });
      } catch (e) {
        results.push(infraResult(task, rep, `runner threw: ${e.message}`));
        console.log(BADGE.INFRA_FAILURE + ' ' + C.d(String(e.message).slice(0, 50)));
        continue;
      }

      if (r.infraError) {
        ver = { outcome: OUTCOME.INFRA_FAILURE, detail: r.infraError };
      } else if (r.timedOut) {
        ver = { outcome: OUTCOME.TIMEOUT, detail: `exceeded ${task.timeout_ms}ms` };
      } else {
        ver = await verify(task, { sandbox: r.sandbox, store: r.store, runId: r.runId, result: r.result });
      }

      const row = {
        task_id: task.task_id, repeat: rep, runner: runnerName,
        difficulty: task.difficulty, categories: task.categories,
        repository: task.repository, base_commit: task.base_commit,
        outcome: ver.outcome, detail: ver.detail, evidence: ver.evidence ?? null,
        agent_status: r.status, agent_reason: r.reason,
        final_message: String(r.result ?? '').slice(0, 400),
        metrics: r.metrics,
        explain: explain(r.store, r.runId),
        workdir: r.dir,
      };
      results.push(row);
      r.close();

      const m = r.metrics;
      console.log(`${BADGE[ver.outcome] ?? ver.outcome} ` +
        C.d(`${(m.wall_ms/1000).toFixed(1)}s  ${m.model_calls}mc ${m.tool_calls}tc ` +
            `${m.input_tokens + m.output_tokens}tok`) +
        (ver.outcome === 'PASS' ? '' : C.d('  ' + String(ver.detail).slice(0, 46))));
    }
  }

  const agg = aggregate(results);
  printSummary(agg);

  const out = flag(args, '--out', path.join(EVAL_ROOT, 'reports', `${label.replace(/\W+/g,'-')}-${Date.now()}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    label, runner: runnerName, model: process.env.HARNESS_MODEL,
    endpoint_kind: 'openai-compatible', at: new Date().toISOString(),
    node: process.version, aggregate: agg, results,
  }, null, 2));
  console.log(C.d(`\nwrote ${out}`));
}

function infraResult(task, rep, detail) {
  return { task_id: task.task_id, repeat: rep, difficulty: task.difficulty,
           categories: task.categories, outcome: OUTCOME.INFRA_FAILURE, detail,
           metrics: { wall_ms: 0, model_calls: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 } };
}

function printSummary(a) {
  console.log('─'.repeat(78));
  console.log(C.b(`  ${a.passed}/${a.tasks_scored} passed  (${a.success_rate}%)`) +
    (a.infra_failures ? C.y(`   ${a.infra_failures} infra failures excluded`) : ''));
  const bd = Object.entries(a.by_difficulty).map(([k,v]) => `${k} ${v.pass}/${v.total}`).join('  ');
  if (bd) console.log(C.d(`  by difficulty: ${bd}`));
  console.log(C.d(`  wall p50 ${(a.p50_wall_ms/1000).toFixed(1)}s  p95 ${(a.p95_wall_ms/1000).toFixed(1)}s`));
  console.log(C.d(`  per success: ${a.model_calls_per_success} model calls, ${a.tool_calls_per_success} tool calls, ${a.tokens_per_success} tokens`));
  console.log(C.d(`  totals: ${a.total_input_tokens}in/${a.total_output_tokens}out tokens, ${a.total_degraded} degraded, ${a.total_escalations} escalations`));
}

function cmdList() {
  console.log(C.d('ID                            DIFF    CATEGORIES                    VERIFY'));
  for (const t of TASKS) {
    console.log(`${t.task_id.padEnd(30)}${t.difficulty.padEnd(8)}${t.categories.join(',').padEnd(30)}${t.verification.method}`);
  }
  const byD = {};
  for (const t of TASKS) byD[t.difficulty] = (byD[t.difficulty] ?? 0) + 1;
  console.log(C.d(`\n${TASKS.length} tasks — ${Object.entries(byD).map(([k,v])=>`${v} ${k}`).join(', ')}`));
}

function cmdReport([file]) {
  if (!file) { console.error('usage: report <results.json>'); process.exit(2); }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(C.b(`${d.label}`) + C.d(`  ${d.model}  ${d.at}`));
  printSummary(d.aggregate);
  console.log('\n' + C.b('failures:'));
  for (const r of d.results.filter(r => r.outcome !== 'PASS')) {
    console.log(`  ${C.r(r.outcome)} ${r.task_id}  ${C.d(r.detail ?? '')}`);
    console.log(C.d(`        agent: ${r.agent_status}/${r.agent_reason}  ${r.metrics.model_calls}mc ${r.metrics.tool_calls}tc`));
  }
}

function cmdCompare([a, b]) {
  if (!a || !b) { console.error('usage: compare <baseline.json> <candidate.json>'); process.exit(2); }
  const A = JSON.parse(fs.readFileSync(a, 'utf8')), B = JSON.parse(fs.readFileSync(b, 'utf8'));
  const byId = (d) => Object.fromEntries(d.results.map(r => [`${r.task_id}#${r.repeat}`, r]));
  const ra = byId(A), rb = byId(B);
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort();

  console.log(C.b(`${A.label}  ->  ${B.label}`));
  console.log(`  success: ${A.aggregate.success_rate}%  ->  ${B.aggregate.success_rate}%  ` +
    delta(B.aggregate.success_rate - A.aggregate.success_rate, '%'));
  console.log(`  tokens/success: ${A.aggregate.tokens_per_success} -> ${B.aggregate.tokens_per_success}`);
  console.log('');
  let improved = 0, regressed = 0;
  for (const k of keys) {
    const x = ra[k], y = rb[k];
    if (!x || !y) continue;
    if (x.outcome === y.outcome) continue;
    const better = x.outcome !== 'PASS' && y.outcome === 'PASS';
    if (better) improved++; else regressed++;
    console.log(`  ${better ? C.g('IMPROVED') : C.r('REGRESSED')}  ${k}  ${x.outcome} -> ${y.outcome}`);
  }
  console.log(C.b(`\n  ${improved} improved, ${regressed} regressed`));
  if (regressed > 0) console.log(C.r('  REGRESSIONS PRESENT — do not merge on aggregate score alone'));
}

const delta = (n, unit='') => n > 0 ? C.g(`(+${n.toFixed(1)}${unit})`) : n < 0 ? C.r(`(${n.toFixed(1)}${unit})`) : C.d('(no change)');

const [cmd, ...args] = process.argv.slice(2);
const cmds = { run: cmdRun, list: cmdList, report: cmdReport, compare: cmdCompare };
if (!cmd || !cmds[cmd]) {
  console.log(`eval — objective capability measurement

  node eval/cli/index.mjs list
  node eval/cli/index.mjs run [--tasks a,b] [--difficulty easy] [--repeat N] [--label "..."] [--out f.json]
  node eval/cli/index.mjs report <results.json>
  node eval/cli/index.mjs compare <baseline.json> <candidate.json>

config: HARNESS_BASE_URL  HARNESS_API_KEY  HARNESS_MODEL`);
  process.exit(cmd ? 2 : 0);
}
await cmds[cmd](args);
