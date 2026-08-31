// write pre-state witness (ADR-011, phase 7).
//
// Phase 4 measured that `write.verify()` collapses "never applied" and "applied then changed"
// onto `not-applied`, so SAFE_RETRY reissued and silently destroyed a legitimate concurrent
// change (1/6 misclassification, 1 silent overwrite). `edit` never had the problem because its
// precondition is the PRE-state. These tests assert the equivalent evidence for `write`.
//
// The four cases of §6/§9 are tested exactly, plus the pre-effect conflict check, which is a
// DIFFERENT protection from post-crash verification and must not be conflated with it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools, toolDefinitions, validateArgs, ABSENT } from '../../src/agent/tools/index.mjs';
import { decideRecovery, Decision, RecoveryClass } from '../../src/core/recovery/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const note = (s) => console.log(`       ${s}`);

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwit-'));
const sandbox = new LocalSandbox(dir);
const tools = makeTools(sandbox);

const S0 = 'export const a = 1;\n';
const S1 = 'export const a = 2;\n';                     // the intended write
const S2 = 'export const a = 2;\nexport const b = 3;\n'; // a LATER third-party change

/** Simulate the worker: capture the witness, then classify against a given world. */
function witnessed(args) { return tools.write.captureWitness(args); }
function verifyIn(world, args) {
  sandbox.write(args.path, world);
  const rec = tools.write.recovery(args);
  return { verified: rec.verify(), decision: decideRecovery(rec), class: rec.class };
}

console.log('writewitness');

// ── the witness is captured by the RUNTIME, not the model (§15) ─────────
{
  sandbox.write('w.js', S0);
  const a = witnessed({ path: 'w.js', content: S1 });
  ok('captureWitness injects expected_pre_sha', a.expected_pre_sha === sha(S0), a.expected_pre_sha);
  ok('  it is the PRE-state, not the target', a.expected_pre_sha !== sha(S1));

  const absent = witnessed({ path: 'nope.js', content: S1 });
  ok('absent file yields the ABSENT sentinel', absent.expected_pre_sha === ABSENT, absent.expected_pre_sha);

  const def = toolDefinitions(tools).find(t => t.function.name === 'write');
  ok('the model never sees expected_pre_sha',
     !('expected_pre_sha' in def.function.parameters.properties));
  ok('  but validation accepts it',
     validateArgs(tools.write, { path: 'w.js', content: S1, expected_pre_sha: 'abc' }).length === 0);
}

// ── §9 case 1: never applied ────────────────────────────────────────────
{
  sandbox.write('c1.js', S0);
  const args = witnessed({ path: 'c1.js', content: S1 });
  const r = verifyIn(S0, args);                       // world still S0
  ok('case 1 never applied -> not-applied', r.verified === 'not-applied', r.verified);
  ok('  decision REISSUE (safe: pre-state intact)', r.decision.decision === Decision.REISSUE);
  ok('  class is SELF_VERIFYING when witnessed', r.class === RecoveryClass.SELF_VERIFYING, r.class);
}

// ── §9 case 2: applied ──────────────────────────────────────────────────
{
  sandbox.write('c2.js', S0);
  const args = witnessed({ path: 'c2.js', content: S1 });
  const r = verifyIn(S1, args);                       // world is the target
  ok('case 2 applied -> applied', r.verified === 'applied', r.verified);
  ok('  decision SKIP', r.decision.decision === Decision.SKIP);
}

// ── §9 case 3: applied THEN CHANGED — the defect ────────────────────────
{
  sandbox.write('c3.js', S0);
  const args = witnessed({ path: 'c3.js', content: S1 });
  const r = verifyIn(S2, args);                       // third actor moved it on
  ok('case 3 applied-then-changed -> UNKNOWN', r.verified === 'unknown', r.verified);
  ok('  decision is NOT reissue', r.decision.decision !== Decision.REISSUE, r.decision.decision);
  ok('  decision is ESCALATE', r.decision.decision === Decision.ESCALATE, r.decision.decision);
  note('this is the case that previously returned not-applied and destroyed the change');
}

// ── §9 case 4: pre-state changed BEFORE the write (pre-effect) ──────────
{
  sandbox.write('c4.js', S0);
  const args = witnessed({ path: 'c4.js', content: S1 });
  sandbox.write('c4.js', S2);                         // someone else got there first
  let threw = false, msg = '';
  try { tools.write.run(args); } catch (e) { threw = true; msg = e.message; }
  ok('case 4 conflicting pre-state -> write REFUSED', threw, 'write proceeded');
  ok('  the other change SURVIVES', sandbox.read('c4.js') === S2);
  ok('  the error tells the agent what to do', /changed since it was read/.test(msg), msg.slice(0, 60));
}

// ── §14 compatibility: an unwitnessed write is UNCHANGED ────────────────
{
  sandbox.write('c5.js', S0);
  const legacy = { path: 'c5.js', content: S1 };      // no witness
  const rec = tools.write.recovery(legacy);
  ok('unwitnessed write stays SAFE_RETRY', rec.class === RecoveryClass.SAFE_RETRY, rec.class);
  sandbox.write('c5.js', S2);
  ok('  and still reports not-applied on a changed world (documented limit)',
     rec.verify() === 'not-applied', rec.verify());
  note('legacy callers do NOT silently gain the stronger guarantee');
}

// ── absent-file handling ────────────────────────────────────────────────
{
  const args = witnessed({ path: 'new.js', content: S1 });   // file does not exist
  ok('absent pre-state is witnessed as ABSENT', args.expected_pre_sha === ABSENT);
  const rec = tools.write.recovery(args);
  ok('  still absent -> not-applied (retry is safe)', rec.verify() === 'not-applied', rec.verify());
  tools.write.run(args);
  ok('  after writing -> applied', rec.verify() === 'applied', rec.verify());
  sandbox.write('new.js', S2);
  ok('  then changed -> unknown', rec.verify() === 'unknown', rec.verify());
}

// ── a third party independently producing the target bytes ──────────────
{
  sandbox.write('c6.js', S0);
  const args = witnessed({ path: 'c6.js', content: S1 });
  const r = verifyIn(S1, args);
  ok('equivalent content -> applied (goal satisfied)', r.verified === 'applied', r.verified);
}

// ── the SAFETY INVARIANT (§28) stated directly ──────────────────────────
{
  // An uncertain write must NEVER be automatically reissued once the pre-state has changed.
  sandbox.write('inv.js', S0);
  const args = witnessed({ path: 'inv.js', content: S1 });
  sandbox.write('inv.js', S2);
  const rec = tools.write.recovery(args);
  const d = decideRecovery(rec);
  const before = sandbox.read('inv.js');
  if (d.decision === Decision.REISSUE) tools.write.run(args);   // execute the runtime's choice
  ok('INVARIANT: uncertain write is never auto-reissued', d.decision !== Decision.REISSUE, d.decision);
  ok('  world untouched by recovery', sandbox.read('inv.js') === before);
  ok('  concurrent change survives', sandbox.read('inv.js') === S2);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nwritewitness: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
