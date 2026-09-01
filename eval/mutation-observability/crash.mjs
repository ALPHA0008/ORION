// Part A, Q4 — after a crash mid-bash-mutation, can the runtime classify the effect as
// APPLIED / NOT_APPLIED / UNKNOWN, and is the resulting decision SAFE?
//
// "Safe" here does not mean "the runtime knows what happened". It means the runtime never takes an
// action that could destroy work on the strength of a guess. Those are different bars, and the
// second is the one that matters for a correctness verdict.
//
// Four crash points are examined, matching the §7 matrix.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideRecovery, classifyShell, RecoveryClass } from '../../v0/src/core/recovery/index.mjs';
import { makeTools } from '../../v0/src/agent/tools/index.mjs';
import { LocalSandbox } from '../../v0/src/sandbox/local/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(os.tmpdir(), 'crash-probe');

/**
 * After a crash the runtime rebuilds recovery from `pend.args` — exactly what `tool.started`
 * recorded (ADR-011 §2). So what it can conclude is fully determined by the recovery descriptor
 * for those args. That is what is reconstructed here, per crash point.
 */
function reconstruct(cmd) {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  const tools = makeTools(new LocalSandbox(ROOT));
  const rec = tools.bash.recovery({ cmd });
  return { class: rec.class, has_verify: typeof rec.verify === 'function', decision: decideRecovery(rec) };
}

const CMD = `cat > target.py <<'EOF'\nCHANGED\nEOF`;

// The four crash points. In every case the runtime resumes holding only `pend.args`.
const POINTS = [
  { point: 'before effect',
    world: 'file unchanged', note: 'the command never ran' },
  { point: 'after effect, before tool.succeeded',
    world: 'file CHANGED', note: 'the dangerous window -- the effect landed but nothing recorded it' },
  { point: 'after tool.succeeded event',
    world: 'file CHANGED', note: 'the log already says it succeeded; #reconcile has nothing pending' },
  { point: 'after effect, log write itself lost',
    world: 'file CHANGED', note: 'indistinguishable from "before effect" using args alone' },
];

const r = reconstruct(CMD);
const rows = POINTS.map(p => ({
  ...p,
  recovery_class: r.class,
  has_verify: r.has_verify,
  decision: r.decision.decision,
  reason: r.decision.reason,
  // Can the runtime TELL which world it is in? Only a verify() probe could distinguish them.
  can_classify: r.has_verify ? 'yes' : 'no -- UNKNOWN',
  // Is the resulting behaviour safe regardless of not knowing?
  safe: r.decision.decision === 'escalate',
}));

// Contrast: the same crash points for a witnessed `write`.
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'target.py'), 'ORIGINAL\n');
const tools = makeTools(new LocalSandbox(ROOT));
const wArgs = { path: 'target.py', content: 'CHANGED\n' };
const witnessed = { ...wArgs, ...(tools.write.captureWitness(wArgs) || {}) };
const wBefore = decideRecovery(tools.write.recovery(witnessed));       // effect never ran
tools.write.run(witnessed);                                            // effect lands
const wAfter = decideRecovery(tools.write.recovery(witnessed));        // crashed after effect
fs.writeFileSync(path.join(ROOT, 'target.py'), 'THIRD_PARTY\n');       // applied, then changed
const wThird = decideRecovery(tools.write.recovery(witnessed));

const out = {
  at: new Date().toISOString(),
  command: CMD,
  bash: rows,
  bash_verdict: rows.every(x => x.safe)
    ? 'BASH_RECOVERY_UNCERTAIN_BUT_SAFE' : 'BASH_RECOVERY_UNSAFE',
  write_contrast: {
    before_effect: { verified: wBefore.verified, decision: wBefore.decision },
    after_effect: { verified: wAfter.verified, decision: wAfter.decision },
    applied_then_changed: { verified: wThird.verified, decision: wThird.decision, reason: wThird.reason },
  },
};

const dir = path.join(HERE, 'results');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'crash.json'), JSON.stringify(out, null, 2));

console.log('BASH — crash points (runtime resumes holding only pend.args)');
console.log('crash point                              world           classify?      decision   safe');
for (const x of rows)
  console.log(`  ${x.point.padEnd(38)} ${x.world.padEnd(15)} ${x.can_classify.padEnd(14)} ${x.decision.padEnd(10)} ${x.safe}`);
console.log('\n  reason:', rows[0].reason);
console.log('  VERDICT:', out.bash_verdict);

console.log('\nWRITE contrast (witnessed, same scenario)');
for (const [k, v] of Object.entries(out.write_contrast))
  console.log(`  ${k.padEnd(22)} verify=${String(v.verified).padEnd(12)} decision=${v.decision}`);
console.log(`\nwrote ${path.join(dir, 'crash.json')}`);
