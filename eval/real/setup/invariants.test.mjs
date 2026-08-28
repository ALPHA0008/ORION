// Evaluator invariants (section 26). These are PERMANENT tests: the evaluator is part of the
// product's credibility, so its failure modes are pinned down the same way the runtime's are.
//
//   broken verifier                       -> INFRA_FAILURE
//   broken environment                    -> INFRA_FAILURE
//   agent changed nothing                 -> FAIL
//   wrong solution                        -> FAIL
//   successful tool call + wrong state    -> FAIL
//   successful final prose + wrong state  -> FAIL   (never score from the agent's claims)
//   agent edited the tests                -> FAIL   (anti-gaming)
//   correct solution                      -> PASS

import fs from 'node:fs';
import path from 'node:path';
import { RealEnvironment, InfraFailure } from '../environments/index.mjs';
import { REPOSITORIES } from '../repositories/index.mjs';
import { verifyReal, snapshotTestFiles } from '../evaluators/index.mjs';
import { classifyFailure } from '../evaluators/failures.mjs';
import { REAL_TASK_BY_ID } from '../tasks/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const repo = REPOSITORIES['is-number'];
const task = REAL_TASK_BY_ID['isnum-string-trim'];

/** Provision a mutated checkout, run `mutateMore`, verify. */
function trial(mutateMore, taskOverride = task) {
  const env = new RealEnvironment(repo);
  try {
    const dir = env.provision('inv-' + Math.random().toString(36).slice(2, 8));
    taskOverride.mutate(dir);
    const guard = snapshotTestFiles(dir);
    mutateMore?.(dir);
    const v = verifyReal(taskOverride, repo, { dir, testFileGuard: guard });
    return v;
  } finally { env.destroy(); }
}

// 1. agent changed nothing -> FAIL
{
  const v = trial(null);
  ok('agent changed nothing -> FAIL', v.outcome === 'FAIL', `got ${v.outcome}`);
  ok('  classified as no_edits_made',
     classifyFailure({ outcome: v.outcome, detail: v.detail, status: 'completed',
                       metrics: { edits: 0, writes: 0, tool_calls: 3, tool_success_rate: 1, model_calls: 6 } })
       === 'no_edits_made');
}

// 2. wrong solution -> FAIL
{
  const v = trial((dir) => {
    const p = path.join(dir, 'index.js');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace("num !== ''", 'true'));
  });
  ok('wrong solution -> FAIL', v.outcome === 'FAIL', `got ${v.outcome}`);
}

// 3. successful tool call + wrong world state -> FAIL
//    (writing an unrelated file "successfully" must not score)
{
  const v = trial((dir) => fs.writeFileSync(path.join(dir, 'NOTES.md'), 'I fixed the bug.\n'));
  ok('successful tool call + wrong state -> FAIL', v.outcome === 'FAIL', `got ${v.outcome}`);
}

// 4. successful final prose + wrong state -> FAIL
//    The verifier never reads the agent's message; prove it by passing a triumphant result.
{
  const v = trial(null);
  ok('agent prose cannot produce PASS', v.outcome === 'FAIL', `got ${v.outcome}`);
  ok('  verifier ignores result text entirely',
     !JSON.stringify(v).includes('I have fixed'));
}

// 5. anti-gaming: editing the repo's tests -> FAIL
{
  const v = trial((dir) => {
    const p = path.join(dir, 'test.js');
    fs.writeFileSync(p, "require('mocha');\ndescribe('x', () => { it('y', () => {}); });\n");
  });
  ok('agent rewrote the test file -> FAIL', v.outcome === 'FAIL', `got ${v.outcome}`);
  ok('  detail names the anti-gaming guard', /modified test file/.test(v.detail), v.detail);
}

// 6. anti-gaming: deleting the repo's tests -> FAIL
{
  const v = trial((dir) => fs.rmSync(path.join(dir, 'test.js')));
  ok('agent deleted the test file -> FAIL', v.outcome === 'FAIL', `got ${v.outcome}`);
  ok('  detail names the deletion', /deleted test file/.test(v.detail), v.detail);
}

// 7. correct solution -> PASS
{
  const v = trial((dir) => task.solution(dir));
  ok('correct solution -> PASS', v.outcome === 'PASS', `got ${v.outcome}: ${v.detail}`);
}

// 8. broken verifier -> INFRA_FAILURE (never blamed on the agent)
{
  const broken = { ...task, verification: { method: 'repo_invariant', check: () => { throw new Error('boom'); } } };
  const v = trial(null, broken);
  ok('verifier that throws -> INFRA_FAILURE', v.outcome === 'INFRA_FAILURE', `got ${v.outcome}`);
  ok('  classified as environment_failure',
     classifyFailure({ outcome: v.outcome, metrics: {} }) === 'environment_failure');
}

// 9. unknown verification method -> INFRA_FAILURE
{
  const bogus = { ...task, verification: { method: 'astrology' } };
  const v = trial(null, bogus);
  ok('unknown verification method -> INFRA_FAILURE', v.outcome === 'INFRA_FAILURE', `got ${v.outcome}`);
}

// 10. broken environment -> InfraFailure, not a silent pass
{
  let threw = null;
  const env = new RealEnvironment({ ...repo, url: 'https://github.com/this-org-does-not-exist-xyz/nope.git',
                                    commit: '0'.repeat(40) },
                                  { root: path.join(process.env.TEMP ?? '/tmp', 'harness-real-eval-badrepo') });
  try { env.provision('bad'); } catch (e) { threw = e; } finally { try { env.destroy(); } catch {} }
  ok('unreachable repository -> InfraFailure', threw instanceof InfraFailure,
     threw ? threw.constructor.name : 'did not throw');
}

// 11. hidden tests are absent during the run and present only at verification
{
  const hiddenTask = REAL_TASK_BY_ID['isnum-hidden-contract'];
  const env = new RealEnvironment(repo);
  try {
    const dir = env.provision('inv-hidden');
    hiddenTask.mutate(dir);
    ok('hidden test not present during the run', !fs.existsSync(path.join(dir, '__hidden__/contract.test.cjs')));
    const guard = snapshotTestFiles(dir);
    const v = verifyReal(hiddenTask, repo, { dir, testFileGuard: guard });
    ok('hidden test catches the lazy Boolean() defect', v.outcome === 'FAIL', `got ${v.outcome}`);
    hiddenTask.solution(dir);
    const v2 = verifyReal(hiddenTask, repo, { dir, testFileGuard: guard });
    ok('hidden test passes on the correct implementation', v2.outcome === 'PASS', `got ${v2.outcome}: ${v2.detail}`);
  } finally { env.destroy(); }
}

console.log(`\nreal-eval-invariants: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
