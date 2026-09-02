// §11-12 — freeze the corpus and give it an identity.
//
// The benchmark is itself an experimental instrument, so a result has to be expressible as
// "agent result X on corpus version Y at runtime commit Z". That requires the corpus to have a
// version and a content hash which change if, and only if, the task definitions change.
//
// The hash covers ONLY the task's semantic definition -- id, repo, base commit, problem statement,
// the oracles and the interpreter. It deliberately excludes absolute venv/work paths, which are
// properties of this machine, not of the corpus. Otherwise the "same" corpus would hash
// differently on another host and the version would be worthless.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Tranche 2 gets its OWN identity. CAPABILITY_V1_STAGE1 is immutable and must never be
// modified or replaced by this script.
const CORPUS_VERSION = process.env.CORPUS_VERSION ?? 'CAPABILITY_V1_STAGE1';

const TASKS_SUBDIR = process.env.TASKS_SUBDIR ?? '.';
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', TASKS_SUBDIR, 'corpus.json'), 'utf8'));
const repro = JSON.parse(fs.readFileSync(path.join(HERE, 'reports', process.env.REPRO_NAME ?? 'repro-sweep.json'), 'utf8'));

// Refuse to freeze anything that has not two-sidedly reproduced through the production verifier.
const reproOk = new Map(repro.rows.map(r => [r.task_id, r.reproducible]));
const unverified = corpus.tasks.filter(t => reproOk.get(t.task_id) !== true);
if (unverified.length) {
  console.error(`REFUSING TO FREEZE: ${unverified.length} task(s) not verified by the repro sweep:`);
  for (const t of unverified) console.error(`  ${t.task_id}`);
  process.exit(1);
}

const semantic = (t) => ({
  task_id: t.task_id, repository: t.repository, base_commit: t.base_commit,
  problem_statement: t.problem_statement,
  gold_patch: t.gold_patch, test_patch: t.test_patch,
  fail_to_pass: t.fail_to_pass, pass_to_pass: t.pass_to_pass,
  verified_test: t.verified_test, python: t.python, install_args: t.install_args,
});
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

const tasks = corpus.tasks
  .map(t => ({ ...semantic(t), task_sha256: sha(semantic(t)) }))
  .sort((a, b) => a.task_id.localeCompare(b.task_id));

const corpusSha = sha(tasks.map(t => t.task_sha256));
const runtimeCommit = execFileSync('git', ['rev-parse', 'HEAD'],
  { cwd: path.join(HERE, '..', '..'), encoding: 'utf8' }).trim();

const manifest = {
  corpus_version: CORPUS_VERSION,
  corpus_sha256: corpusSha,
  frozen_at: new Date().toISOString(),
  runtime_commit: runtimeCommit,
  source: corpus.source,
  // The label must name the ACTUAL source. Tranche 2 is a Verified multi-file slice, not Lite.
  label: process.env.CORPUS_LABEL ?? 'Stage-1 filtered SWE-bench-lite slice, locally reproduced',
  count: tasks.length,
  bracket: 'preflight-negative AND oracle-positive, re-verified through the production verifier',
  verifier: 'pytest exit status; FAIL_TO_PASS must pass AND PASS_TO_PASS must not regress; no LLM judge',
  tasks,
};

fs.writeFileSync(path.join(HERE, 'tasks', TASKS_SUBDIR, 'frozen-corpus.json'), JSON.stringify(manifest, null, 2));
console.log(`FROZEN ${CORPUS_VERSION}`);
console.log(`  corpus_sha256   ${corpusSha}`);
console.log(`  runtime_commit  ${runtimeCommit}`);
console.log(`  tasks           ${tasks.length}`);
