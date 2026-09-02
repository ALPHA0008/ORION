// §13 reproducibility sweep — the LAST gate before any model is allowed to run.
//
// Bracketing proved each task once, during admission. This re-proves every accepted task through
// the SHARED production verifier, the same code path a real run will use, and refuses to let the
// corpus freeze until the remaining failure modes are agent failures rather than ours.
//
// Two-sided per task:
//   clean tree  -> task_success MUST be false   (the objective is genuinely unsatisfied)
//   gold patch  -> task_success MUST be true    (a known-good solution really satisfies the verifier)
//
// A task failing either direction is NOT silently repaired (§7). It is reported, and the decision
// about what to do with it is made explicitly.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyTask, resetTask } from './verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIET = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };
const git = (a, o = {}) => execFileSync('git', a, { ...QUIET, timeout: 300_000, ...o });

function applyGold(task) {
  const f = path.join(task.work_dir, '.__gold.diff');
  fs.writeFileSync(f, task.gold_patch.endsWith('\n') ? task.gold_patch : task.gold_patch + '\n', 'utf8');
  git(['-C', task.work_dir, 'apply', '--whitespace=nowarn', f]);
  fs.rmSync(f, { force: true });
}

const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', process.env.TASKS_SUBDIR ?? '.', 'corpus.json'), 'utf8'));
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const tasks = only ? corpus.tasks.filter(t => only.has(t.task_id)) : corpus.tasks;

console.log(`reproducibility sweep: ${tasks.length} accepted tasks, via the production verifier`);
console.log('─'.repeat(100));

const rows = [];
for (const t of tasks) {
  const row = { task_id: t.task_id, repository: t.repository, python: t.python };
  try {
    resetTask(t);
    const clean = verifyTask(t);
    row.clean_unsatisfied = clean.task_success === false;
    row.clean_f2p = clean.fail_to_pass_now_passes;

    resetTask(t);
    applyGold(t);
    const gold = verifyTask(t);
    row.gold_satisfies = gold.task_success === true;
    row.gold_f2p = gold.fail_to_pass_now_passes;
    row.gold_p2p = gold.pass_to_pass_still_passes;
    row.p2p_checked = gold.pass_to_pass_checked;
    row.p2p_declared = gold.pass_to_pass_declared;
    row.p2p_unrunnable = gold.pass_to_pass_unrunnable;
    if (!row.gold_satisfies) row.evidence = String(gold.f2p_output ?? '').replace(/\s+/g, ' ').slice(-260)
      || String(gold.p2p_output ?? '').replace(/\s+/g, ' ').slice(-260);

    resetTask(t);   // leave every tree clean for the baseline
  } catch (e) {
    row.error = String(e.message).slice(0, 260);
  }
  row.reproducible = row.clean_unsatisfied === true && row.gold_satisfies === true;
  rows.push(row);
  console.log(`  ${row.reproducible ? 'OK    ' : 'FAILED'}  ${t.task_id.padEnd(28)} `
    + `clean=${row.clean_unsatisfied ? 'unsat' : 'SAT!'} gold=${row.gold_satisfies ? 'pass' : 'FAIL'} `
    + `p2p=${row.p2p_checked ?? '-'}/${row.p2p_declared ?? '-'}`
    + (row.p2p_unrunnable ? ` (${row.p2p_unrunnable} unrunnable upstream)` : ''));
}

const outDir = path.join(HERE, 'reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, process.env.REPRO_NAME ?? 'repro-sweep.json'),
  JSON.stringify({ at: new Date().toISOString(), total: rows.length,
                   reproducible: rows.filter(r => r.reproducible).length, rows }, null, 2));

const ok = rows.filter(r => r.reproducible).length;
console.log('─'.repeat(100));
console.log(`reproducible ${ok} / ${rows.length}`);
if (ok < rows.length) {
  console.log('NOT reproducible:');
  for (const r of rows.filter(x => !x.reproducible))
    console.log(`  ${r.task_id.padEnd(28)} ${r.error ?? r.evidence ?? 'see repro-sweep.json'}`);
}
process.exitCode = ok === rows.length ? 0 : 1;
