// Assemble the runnable corpus from bracket verdicts.
//
// Only tasks that passed the FULL bracket (preflight-negative AND oracle-positive) are admitted.
// Nothing is authored here and nothing is repaired here: this is a projection of what bracketing
// already proved, plus the two paths the runner needs to reach the environment that proved it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(os.tmpdir(), 'capability-v1');
const FIX = path.join(HERE, 'fixtures');

const sources = (process.env.SOURCES ?? '').split(',').map(s => s.trim()).filter(Boolean);
const files = sources.length ? sources : [path.join(FIX, 'bracket-results.json')];

const seen = new Map();
const rejected = new Map();
for (const f of files) {
  if (!fs.existsSync(f)) { console.error(`missing: ${f}`); continue; }
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const a of d.accepted ?? []) seen.set(a.task_id, a);
  for (const r of d.rejected ?? []) rejected.set(r.task_id, r);
}
// A task accepted in any sweep is accepted: a later sweep on a different interpreter does not
// un-prove an earlier successful bracket.
for (const id of seen.keys()) rejected.delete(id);

const pyExe = (venv) => process.platform === 'win32'
  ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');

const tasks = [];
const dropped = [];
for (const a of seen.values()) {
  const venv = a.venv ?? path.join(ROOT, '_venvs', `${a.task_id}-py${a.python ?? '3.9'}`);
  const exe = pyExe(venv);
  const work = path.join(ROOT, 'work', a.task_id);
  // The bracket is only meaningful if the environment that produced it still exists. A task whose
  // venv or tree was cleaned away is dropped rather than silently re-provisioned differently.
  if (!fs.existsSync(exe) || !fs.existsSync(path.join(work, '.git'))) {
    dropped.push({ task_id: a.task_id, why: !fs.existsSync(exe) ? 'venv missing' : 'tree missing' });
    continue;
  }
  tasks.push({
    task_id: a.task_id, repository: a.repository, language: 'python',
    base_commit: a.base_commit,
    problem_statement: a.problem_statement,
    gold_patch: a.gold_patch, test_patch: a.test_patch,
    fail_to_pass: a.fail_to_pass, pass_to_pass: a.pass_to_pass,
    verified_test: a.verified_test,
    python: a.python ?? '3.9', python_exe: exe, venv, work_dir: work,
    install_args: a.install_args ?? '-e .',
    bracket_seconds: a.bracket_seconds ?? null,
  });
}

tasks.sort((x, y) => x.task_id.localeCompare(y.task_id));

const outDir = path.join(HERE, 'tasks');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'corpus.json'), JSON.stringify({
  source: 'princeton-nlp/SWE-bench_Lite',
  built_at: new Date().toISOString(),
  bracket: 'preflight-negative AND oracle-positive, verified locally',
  count: tasks.length, tasks,
}, null, 2));

// One file per task as well, so a single task is readable without loading the whole corpus.
for (const t of tasks) fs.writeFileSync(path.join(outDir, `${t.task_id}.json`), JSON.stringify(t, null, 2));

fs.writeFileSync(path.join(FIX, 'rejections.json'), JSON.stringify({
  at: new Date().toISOString(), count: rejected.size, rejected: [...rejected.values()],
}, null, 2));

const byRepo = {};
for (const t of tasks) byRepo[t.repository] = (byRepo[t.repository] ?? 0) + 1;
console.log(`corpus: ${tasks.length} tasks`);
for (const [k, v] of Object.entries(byRepo).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${v}`);
if (dropped.length) { console.log(`dropped (environment gone): ${dropped.length}`); for (const d of dropped) console.log(`  ${d.task_id}  ${d.why}`); }
console.log(`rejected on record: ${rejected.size}`);
