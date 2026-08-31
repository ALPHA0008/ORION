// World-state verification experiment (phase 4, brief §4–§12).
//
// QUESTION: after an uncertain mutation, can verify() distinguish
//   S0  never applied
//   S1  applied
//   S2  applied, then the world changed
//   ??  genuinely unknown
//
// This is FORENSIC. It changes no production behaviour; it characterises what the existing
// contract can and cannot observe, and where the boundary is information-theoretic rather than
// an implementation gap.
//
// The stakes are in decideRecovery(): `verify() === 'not-applied'` maps to REISSUE. So any
// world state that is really "applied then changed" but reports not-applied causes a RETRY of an
// effect that already happened — silently overwriting whatever changed it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { decideRecovery, Decision, RecoveryClass } from '../../src/core/recovery/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const note = (s) => console.log(`       ${s}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wstate-'));
const sandbox = new LocalSandbox(dir);
const tools = makeTools(sandbox);
const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);

// ── the deterministic world states (§5) ──────────────────────────────────
const S0 = 'export function total(items) {\n\tlet t = 0;\n\tfor (const i of items) t += i;\n\treturn t;\n}\n';
const S1 = S0.replace('let t = 0;', 'let t = 1;');                 // the agent's intended mutation
const S2 = S1.replace('return t;', 'return t * 2;');               // a LATER, unrelated change
const OLD = 'let t = 0;', NEW = 'let t = 1;';

console.log(`world states: H0=${h(S0)} H1=${h(S1)} H2=${h(S2)}`);

/** Put the file into a given state, then ask the ORIGINAL operation's verify() what it sees. */
function probeEdit(state) {
  sandbox.write('f.js', state);
  const rec = tools.edit.recovery({ path: 'f.js', old_string: OLD, new_string: NEW });
  return { verified: rec.verify(), decision: decideRecovery(rec) };
}
function probeWrite(state) {
  sandbox.write('f.js', state);
  const rec = tools.write.recovery({ path: 'f.js', content: S1 });
  return { verified: rec.verify(), decision: decideRecovery(rec) };
}

// ═══════════════════════════════════════════════ edit (§7)
console.log('\n── edit: what can verify() see? ──');
{
  const a = probeEdit(S0);
  ok('edit S0 (never applied) -> not-applied', a.verified === 'not-applied', a.verified);
  ok('  decision REISSUE (correct — nothing happened)', a.decision.decision === Decision.REISSUE);

  const b = probeEdit(S1);
  ok('edit S1 (applied) -> applied', b.verified === 'applied', b.verified);
  ok('  decision SKIP (correct — do not redo it)', b.decision.decision === Decision.SKIP);

  // THE CASE UNDER TEST: applied, then someone changed an UNRELATED part of the file.
  const c = probeEdit(S2);
  note(`edit S2 (applied then changed) -> verify()='${c.verified}' decision='${c.decision.decision}'`);
  ok('edit S2 is NOT misreported as not-applied', c.verified !== 'not-applied',
     `got '${c.verified}' -> would REISSUE and clobber the later change`);
  ok('  decision is not a blind REISSUE', c.decision.decision !== Decision.REISSUE,
     c.decision.decision);
}

// Type 3 (§11): an external actor reverts the file to the ORIGINAL bytes.
{
  const r = probeEdit(S0);
  note(`edit revert-to-original -> verify()='${r.verified}' (indistinguishable from never-applied)`);
  ok('revert-to-original is genuinely indistinguishable from never-applied',
     r.verified === 'not-applied',
     'this is an information limit, not a bug — see information-limit.md');
}

// Type 4 (§11): another actor independently produced the SAME final bytes.
{
  const r = probeEdit(S1);
  ok('equivalent-content change reports applied', r.verified === 'applied', r.verified);
  note('correct by content-addressing: the world matches the intended post-state');
}

// ═══════════════════════════════════════════════ write (§8)
console.log('\n── write: what can verify() see? ──');
{
  const a = probeWrite(S0);
  ok('write S0 (never applied) -> not-applied', a.verified === 'not-applied', a.verified);

  const b = probeWrite(S1);
  ok('write S1 (applied) -> applied', b.verified === 'applied', b.verified);

  // MEASURED, not asserted-as-desired: write reports not-applied for a world that is really
  // "applied then changed", so decideRecovery chooses REISSUE and the later change is lost.
  // This is the defect this phase exists to characterise; §11 says measure it, do not fix it.
  const c = probeWrite(S2);
  note(`write S2 (applied then changed) -> verify()='${c.verified}' decision='${c.decision.decision}'`);
  ok('write MISCLASSIFIES applied-then-changed as not-applied (defect, measured)',
     c.verified === 'not-applied', `got '${c.verified}'`);
  ok('  and decideRecovery therefore chooses REISSUE',
     c.decision.decision === Decision.REISSUE, c.decision.decision);
  note('a reissue here overwrites the later change — see concurrent-race.test.mjs for the end-to-end proof');
}

// ═══════════════════════════════════════════════ the asymmetry
console.log('\n── why edit and write differ ──');
{
  sandbox.write('f.js', S2);
  const e = tools.edit.recovery({ path: 'f.js', old_string: OLD, new_string: NEW });
  const w = tools.write.recovery({ path: 'f.js', content: S1 });
  note(`same world (S2): edit says '${e.verify()}', write says '${w.verify()}'`);
  ok('edit and write disagree on the SAME world state',
     e.verify() !== w.verify(),
     `edit='${e.verify()}' write='${w.verify()}'`);
  note('edit checks the PRE-state (old_string absent => it ran). write checks only the POST-state.');
}

// ═══════════════════════════════════════════════ information limit (§12)
console.log('\n── information-theoretic limit ──');
{
  // Two histories, identical durable evidence, identical final world.
  //   History A: mutation NEVER happened; an external actor wrote S2.
  //   History B: mutation happened (S1); an external actor then wrote S2.
  // For WRITE, the only evidence is "current === intended?" — both give false.
  sandbox.write('f.js', S2);
  const wA = tools.write.recovery({ path: 'f.js', content: S1 }).verify();
  sandbox.write('f.js', S2);
  const wB = tools.write.recovery({ path: 'f.js', content: S1 }).verify();
  ok('write cannot distinguish History A from History B', wA === wB,
     `${wA} vs ${wB}`);
  note(`both report '${wA}' — the durable history and world state are identical in both`);

  // For EDIT the pre-state acts as a witness, but only while the old text stays absent.
  sandbox.write('f.js', S2);
  const eKeeps = tools.edit.recovery({ path: 'f.js', old_string: OLD, new_string: NEW }).verify();
  const S2WithOldBack = S2.replace('let t = 1;', 'let t = 0;');   // actor restores the old text
  sandbox.write('f.js', S2WithOldBack);
  const eLost = tools.edit.recovery({ path: 'f.js', old_string: OLD, new_string: NEW }).verify();
  note(`edit with old text absent: '${eKeeps}'   with old text restored: '${eLost}'`);
  ok('edit loses its witness when the old text is restored', eLost === 'not-applied', eLost);
  note('=> even edit is only as strong as the persistence of its precondition');
}

// ═══════════════════════════════════════════════ the dangerous path (§15, §21)
console.log('\n── does an uncertain mutation ever get silently retried? ──');
{
  // UNSAFE with no verify(): must escalate rather than guess.
  const d = decideRecovery({ class: RecoveryClass.UNSAFE });
  ok('UNSAFE without verify() escalates', d.decision === Decision.ESCALATE, d.decision);

  // verify() throwing must escalate, not default to retry.
  const t = decideRecovery({ class: RecoveryClass.SELF_VERIFYING, verify: () => { throw new Error('probe failed'); } });
  ok('verify() that throws escalates', t.decision === Decision.ESCALATE, t.decision);

  // 'unknown' + a re-issuable class currently REISSUES.
  const u = decideRecovery({ class: RecoveryClass.SAFE_RETRY, verify: () => 'unknown' });
  note(`SAFE_RETRY + unknown -> ${u.decision} (${u.reason})`);
  ok('unknown + SAFE_RETRY currently reissues', u.decision === Decision.REISSUE, u.decision);

  const u2 = decideRecovery({ class: RecoveryClass.UNSAFE, verify: () => 'unknown' });
  ok('unknown + UNSAFE escalates', u2.decision === Decision.ESCALATE, u2.decision);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nworldstate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
