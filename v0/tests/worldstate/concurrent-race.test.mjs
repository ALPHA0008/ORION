// Concurrent-modifier race with REAL process kills (brief §9–§11).
//
// The world-state probe showed `write.verify()` reports 'not-applied' for a world that is
// actually "applied then changed". This proves the consequence end-to-end rather than by
// inspection: a real child process performs the mutation, is killed by the PARENT before it can
// append a durable success event, a third actor modifies the file, and recovery then runs.
//
// (Killing from the parent matters: an earlier phase of this project had crash tests whose child
// killed itself on a timer that never fired because its own event loop was blocked.)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { decideRecovery, Decision } from '../../src/core/recovery/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const note = (s) => console.log(`       ${s}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'race-'));

const S0 = 'export function total(items) {\n\tlet t = 0;\n\tfor (const i of items) t += i;\n\treturn t;\n}\n';
const S1 = S0.replace('let t = 0;', 'let t = 1;');
const OLD = 'let t = 0;', NEW = 'let t = 1;';

// A child that mutates the file and then hangs forever, so the PARENT decides when it dies —
// exactly the "effect landed, durable success event never written" window.
const CHILD = `
import fs from 'node:fs';
const [, , file, mode] = process.argv;
const S0 = ${JSON.stringify(S0)};
const S1 = ${JSON.stringify(S1)};
if (mode === 'write') fs.writeFileSync(file, S1);
else fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(${JSON.stringify(OLD)}, ${JSON.stringify(NEW)}));
process.stdout.write('MUTATED\\n');
setInterval(() => {}, 1 << 30);   // hang: never reaches a success event
`;
const childPath = path.join(root, 'child.mjs');
fs.writeFileSync(childPath, CHILD);

/** Run the child, wait for the mutation, kill it from the parent. */
function crashAfterMutation(file, mode) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [childPath, file, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false;
    p.stdout.on('data', (d) => {
      if (done || !String(d).includes('MUTATED')) return;
      done = true;
      const aliveBefore = !p.killed && p.exitCode === null;
      p.kill('SIGKILL');
      p.on('exit', () => resolve({ aliveBefore }));
    });
    p.on('error', reject);
    setTimeout(() => { if (!done) { p.kill('SIGKILL'); reject(new Error('child never mutated')); } }, 20_000);
  });
}

console.log('concurrent-race (real process kills)');

// ── EDIT: applied, killed, then a THIRD actor changes an unrelated line ──
{
  const dir = fs.mkdtempSync(path.join(root, 'e1-'));
  const sandbox = new LocalSandbox(dir);
  const tools = makeTools(sandbox);
  sandbox.write('f.js', S0);
  const file = path.join(dir, 'f.js');

  const { aliveBefore } = await crashAfterMutation(file, 'edit');
  ok('edit child was alive when the parent killed it', aliveBefore);
  ok('  effect landed on disk', fs.readFileSync(file, 'utf8').includes(NEW));

  // Type 1 (§11): a concurrent actor edits an UNRELATED region.
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('return t;', 'return t * 2;'));

  const rec = tools.edit.recovery({ path: 'f.js', old_string: OLD, new_string: NEW });
  const d = decideRecovery(rec);
  note(`edit + unrelated concurrent change -> verify()='${rec.verify()}' decision='${d.decision}'`);
  ok('edit does NOT reissue over the concurrent change', d.decision !== Decision.REISSUE, d.decision);
  ok('  concurrent change survives', fs.readFileSync(file, 'utf8').includes('return t * 2;'));
}

// ── EDIT: concurrent actor changes the SAME region (Type 2) ─────────────
{
  const dir = fs.mkdtempSync(path.join(root, 'e2-'));
  const sandbox = new LocalSandbox(dir);
  const tools = makeTools(sandbox);
  sandbox.write('f.js', S0);
  const file = path.join(dir, 'f.js');

  await crashAfterMutation(file, 'edit');
  // The other actor rewrites the very line the agent edited.
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(NEW, 'let t = 99;'));

  const rec = tools.edit.recovery({ path: 'f.js', old_string: OLD, new_string: NEW });
  const v = rec.verify();
  const d = decideRecovery(rec);
  note(`edit + same-region concurrent change -> verify()='${v}' decision='${d.decision}'`);
  // old_string absent AND new_string absent => genuinely ambiguous; must not claim certainty.
  ok('same-region change yields unknown (not a false not-applied)', v === 'unknown', v);

  // decideRecovery DOES choose REISSUE here, because SELF_VERIFYING is in the auto-reissue set.
  // That looked alarming, so it was tested rather than assumed: for `edit` the reissue is
  // HARMLESS, because the precondition is gone and the replay self-rejects. The safety comes
  // from the primitive, not from the decision.
  note(`decision on unknown is '${d.decision}' — safe here only because edit self-rejects`);
  const before = fs.readFileSync(file, 'utf8');
  let rejected = false;
  if (d.decision === Decision.REISSUE) {
    try { tools.edit.run({ path: 'f.js', old_string: OLD, new_string: NEW }); }
    catch { rejected = true; }
  }
  ok('  reissue of an already-applied edit self-rejects', rejected);
  ok('  world is untouched by the reissue', fs.readFileSync(file, 'utf8') === before);
  ok('  the concurrent same-region change survives',
     fs.readFileSync(file, 'utf8').includes('let t = 99;'));
}

// ── WRITE: applied, killed, then a concurrent change ────────────────────
{
  const dir = fs.mkdtempSync(path.join(root, 'w1-'));
  const sandbox = new LocalSandbox(dir);
  const tools = makeTools(sandbox);
  sandbox.write('f.js', S0);
  const file = path.join(dir, 'f.js');

  const { aliveBefore } = await crashAfterMutation(file, 'write');
  ok('write child was alive when the parent killed it', aliveBefore);
  ok('  effect landed on disk', fs.readFileSync(file, 'utf8') === S1);

  // A concurrent actor appends a legitimate later change.
  const concurrent = S1 + '\nexport const VERSION = 2;\n';
  fs.writeFileSync(file, concurrent);

  const rec = tools.write.recovery({ path: 'f.js', content: S1 });
  const v = rec.verify();
  const d = decideRecovery(rec);
  note(`write + concurrent change -> verify()='${v}' decision='${d.decision}'`);

  // THE DEFECT, demonstrated end to end.
  ok('write reports not-applied for an applied-then-changed world', v === 'not-applied', v);
  ok('  and decideRecovery chooses REISSUE', d.decision === Decision.REISSUE, d.decision);

  // Execute the decision the runtime would take, and measure the damage.
  if (d.decision === Decision.REISSUE) tools.write.run({ path: 'f.js', content: S1 });
  const after = fs.readFileSync(file, 'utf8');
  ok('  REISSUE silently destroys the concurrent change (measured, not fixed)',
     !after.includes('VERSION = 2'),
     'if this ever fails, write gained lost-update protection');
  note('this is a LOST UPDATE: a real effect was redone over a legitimate later change');
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\nconcurrent-race: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
