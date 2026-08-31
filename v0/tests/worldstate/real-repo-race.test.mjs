// Adversarial REAL-REPOSITORY race (brief §19).
//
// The 22-task benchmark cannot reach this defect: 91 real runs produced 20 `write` calls and
// ZERO recovery decisions, because it is single-worker with no crash injection and no concurrent
// modifier. §19 therefore asks for one minimal adversarial task that DOES exercise it.
//
// This runs against a real pinned repository checkout (p-limit@df476048) rather than a fabricated
// fixture, so the bytes, sizes and structure are the ones the benchmark actually uses. It needs
// no model: the point is the recovery contract, not the agent's reasoning.
//
// If the pinned mirror is unavailable (no network, cold cache) the suite SKIPS rather than
// failing — an infrastructure gap must never look like a recovery defect.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { decideRecovery, Decision } from '../../src/core/recovery/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const note = (s) => console.log(`       ${s}`);

const REPO = 'p-limit';
const COMMIT = 'df476048d023ff868cd45b35ee47f5fb0ca2b25a';
const CACHE = path.join(os.tmpdir(), 'harness-real-eval', '_cache', `${REPO}.git`);

let SRC = null;
try {
  SRC = execFileSync('git', ['--git-dir', CACHE, 'show', `${COMMIT}:index.js`],
                     { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch { /* mirror not present */ }

if (!SRC) {
  console.log('real-repo-race: SKIPPED — pinned mirror unavailable (infrastructure, not a defect)');
  console.log('\nreal-repo-race: 0 passed, 0 failed');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrace-'));
const sandbox = new LocalSandbox(dir);
const tools = makeTools(sandbox);

console.log(`real-repo-race — ${REPO}@${COMMIT.slice(0, 8)}/index.js (${Buffer.byteLength(SRC)} bytes)`);

// The real defect from the benchmark's own task set: `activeCount--` neutered.
const BROKEN = SRC.replace('\t\tactiveCount--;', '\t\tactiveCount -= 0;');
ok('adversarial mutation anchors in the real pinned source', BROKEN !== SRC);

// The agent's whole-file fix — exactly the route phase 3 observed the model taking.
const FIXED = SRC;

// ── the race, on real repository bytes ───────────────────────────────────
{
  sandbox.write('index.js', BROKEN);

  // 1. the agent writes the whole file (effect lands)
  tools.write.run({ path: 'index.js', content: FIXED });
  ok('agent write landed', sandbox.read('index.js') === FIXED);

  // 2. crash before the durable success event — nothing more is recorded

  // 3. a concurrent actor makes a legitimate later change to the same file
  const CONCURRENT = FIXED.replace(
    'export default function pLimit(concurrency) {',
    'export const REVISION = 2;\n\nexport default function pLimit(concurrency) {');
  sandbox.write('index.js', CONCURRENT);
  ok('concurrent actor changed the file', sandbox.read('index.js').includes('REVISION = 2'));

  // 4. recovery runs
  const rec = tools.write.recovery({ path: 'index.js', content: FIXED });
  const v = rec.verify();
  const d = decideRecovery(rec);
  note(`real-repo write race -> verify()='${v}' decision='${d.decision}'`);

  ok('verify() reports not-applied for an APPLIED effect', v === 'not-applied', v);
  ok('  decision is REISSUE', d.decision === Decision.REISSUE, d.decision);

  if (d.decision === Decision.REISSUE) tools.write.run({ path: 'index.js', content: FIXED });
  const after = sandbox.read('index.js');
  ok('  the concurrent change is DESTROYED on real repository bytes',
     !after.includes('REVISION = 2'),
     'if this ever fails, write gained lost-update protection');
  note('world_state_correctness = FAIL even though a task verifier would report PASS');

  // The crucial §22 point: the repo's own test suite would still be green.
  ok('  the file is still the semantically correct fix (task would PASS)', after === FIXED);
  note('task_success and recovery_correctness disagree — they must be reported separately');
}

// ── the same race with `edit` on the same real file ──────────────────────
{
  sandbox.write('index.js', BROKEN);
  tools.edit.run({ path: 'index.js', old_string: 'activeCount -= 0;', new_string: 'activeCount--;' });
  const CONCURRENT = sandbox.read('index.js').replace(
    'export default function pLimit(concurrency) {',
    'export const REVISION = 2;\n\nexport default function pLimit(concurrency) {');
  sandbox.write('index.js', CONCURRENT);

  const rec = tools.edit.recovery({ path: 'index.js', old_string: 'activeCount -= 0;', new_string: 'activeCount--;' });
  const v = rec.verify();
  const d = decideRecovery(rec);
  note(`real-repo edit race  -> verify()='${v}' decision='${d.decision}'`);
  ok('edit correctly reports applied on the same race', v === 'applied', v);
  ok('  decision is SKIP', d.decision === Decision.SKIP, d.decision);
  ok('  the concurrent change SURVIVES', sandbox.read('index.js').includes('REVISION = 2'));
}

// -- ADR-011: the SAME real-repository race, WITH a pre-state witness -----
{
  sandbox.write('index.js', BROKEN);
  const args = tools.write.captureWitness({ path: 'index.js', content: FIXED });

  tools.write.run(args);                       // effect lands
  ok('witnessed agent write landed', sandbox.read('index.js') === FIXED);

  // crash before the durable success event, then a concurrent actor changes the file
  const CONCURRENT = FIXED.replace(
    'export default function pLimit(concurrency) {',
    'export const REVISION = 2;' + String.fromCharCode(10) + String.fromCharCode(10) +
    'export default function pLimit(concurrency) {');
  sandbox.write('index.js', CONCURRENT);

  const rec = tools.write.recovery(args);
  const v = rec.verify();
  const d = decideRecovery(rec);
  note(`real-repo witnessed write -> verify()='${v}' decision='${d.decision}'`);

  ok('verify() is UNKNOWN on real repository bytes', v === 'unknown', v);
  ok('  decision is ESCALATE', d.decision === Decision.ESCALATE, d.decision);

  if (d.decision === Decision.REISSUE) tools.write.run(args);
  const after = sandbox.read('index.js');
  ok('  world_state_correctness = PASS (concurrent change survives)',
     after.includes('REVISION = 2'), 'lost update still occurs');
  note('recovery_correctness = PASS and world_state_correctness = PASS');
}


fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nreal-repo-race: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
