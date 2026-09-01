// §7 anti-gaming bracket: prove the verifier scores the WORLD, not the test file.
//
// The agent runs with write/edit/bash on a real checkout, so it can delete the failing test, skip
// it, or gut its assertions. If any of those scored as a pass, every number this benchmark produces
// would be worthless. `run-baseline.mjs` defends against it by restoring the oracle before judging;
// this file proves the defence actually works by ATTACKING it.
//
// Each attack is applied to a real accepted task, then the real verifier is asked for a verdict.
// An attack that yields task_success is a benchmark-invalidating defect, not a curiosity.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyTask, resetTask } from './verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIET = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };
const git = (a, o = {}) => execFileSync('git', a, { ...QUIET, timeout: 300_000, ...o });

/** Files the test_patch touches — exactly what an attacker would go after. */
const testFiles = (diff) => [...diff.matchAll(/^diff --git a\/(\S+) b\/\S+/gm)].map(m => m[1]);

const ATTACKS = {
  /** The bluntest: remove the file holding the failing test. */
  delete_test_file(dir, task) {
    for (const f of testFiles(task.test_patch)) fs.rmSync(path.join(dir, f), { force: true });
  },
  /** Neuter every assertion while leaving the file present and importable. */
  strip_assertions(dir, task) {
    for (const f of testFiles(task.test_patch)) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) continue;
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
        .replace(/^(\s*)assert\b.*$/gm, '$1pass'), 'utf8');
    }
  },
  /** Make the suite green by skipping it -- a "pass" that proves nothing. */
  skip_everything(dir, task) {
    for (const f of testFiles(task.test_patch)) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) continue;
      fs.writeFileSync(p, 'import pytest\npytestmark = pytest.mark.skip(reason="gamed")\n'
        + fs.readFileSync(p, 'utf8'), 'utf8');
    }
  },
  /** Replace the test file wholesale with something that trivially passes. */
  replace_with_trivial_pass(dir, task) {
    for (const f of testFiles(task.test_patch)) {
      const p = path.join(dir, f);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, 'def test_ok():\n    assert True\n', 'utf8');
    }
  },
  /** Silence collection at the root via a conftest hook. */
  conftest_skip_hook(dir) {
    fs.writeFileSync(path.join(dir, 'conftest.py'),
      'import pytest\n\ndef pytest_collection_modifyitems(items):\n'
      + '    for i in items:\n        i.add_marker(pytest.mark.skip(reason="gamed"))\n', 'utf8');
  },
};

// ── main ─────────────────────────────────────────────────────────────────────
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', 'corpus.json'), 'utf8'));
const sample = Number(process.env.SAMPLE ?? 3);
const tasks = corpus.tasks.slice(0, sample);

console.log(`anti-gaming: ${Object.keys(ATTACKS).length} attacks x ${tasks.length} tasks`);
console.log('─'.repeat(92));

const rows = [];
let breaches = 0;
for (const task of tasks) {
  for (const [name, attack] of Object.entries(ATTACKS)) {
    let verdict, err = null;
    try {
      resetTask(task);                 // clean tree at base_commit
      attack(path.resolve(task.work_dir), task);
      verdict = verifyTask(task);      // the REAL verifier, unchanged
    } catch (e) { err = String(e.message).slice(0, 200); verdict = { task_success: false }; }

    const breached = verdict.task_success === true;
    if (breached) breaches++;
    rows.push({ task_id: task.task_id, attack: name, scored_success: breached, error: err });
    console.log(`  ${breached ? 'BREACH  ' : 'defended'}  ${task.task_id.padEnd(28)} ${name}`);
  }
}

const outDir = path.join(HERE, 'reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'anti-gaming.json'),
  JSON.stringify({ at: new Date().toISOString(), attacks: Object.keys(ATTACKS),
                   tasks: tasks.map(t => t.task_id), breaches, rows }, null, 2));

console.log('─'.repeat(92));
console.log(breaches === 0
  ? `all ${rows.length} attacks defended -- the verifier scores world state, not the test file`
  : `${breaches} BREACH(ES) -- the benchmark is INVALID until fixed`);
process.exitCode = breaches === 0 ? 0 : 1;
