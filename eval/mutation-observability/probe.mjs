// Part A — what guarantees does a bash-mediated file mutation actually carry?
//
// Four questions kept deliberately separate, because they have different answers:
//   observability  — can the EVALUATOR see the change?
//   authorization  — did the runtime authorize it?
//   recoverability — after a crash, can the runtime decide APPLIED / NOT_APPLIED / UNKNOWN?
//   attribution    — can a specific bash call be tied to a specific filesystem diff?
//
// This probes the REAL stack (makeTools + LocalSandbox + decideRecovery). Nothing is simulated,
// and nothing under v0/src is modified.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTools } from '../../v0/src/agent/tools/index.mjs';
import { LocalSandbox } from '../../v0/src/sandbox/local/index.mjs';
import { decideRecovery, classifyShell } from '../../v0/src/core/recovery/index.mjs';

const ROOT = path.join(os.tmpdir(), 'mutation-probe');
const git = (a, o = {}) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });

/** A deterministic git-backed fixture, so `git diff` is a meaningful observability channel. */
function fixture() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  git(['init', '-q'], { cwd: ROOT });
  git(['config', 'user.email', 'probe@local'], { cwd: ROOT });
  git(['config', 'user.name', 'probe'], { cwd: ROOT });
  git(['config', 'core.autocrlf', 'false'], { cwd: ROOT });
  fs.writeFileSync(path.join(ROOT, 'target.py'), 'ORIGINAL\n');
  git(['add', '-A'], { cwd: ROOT });
  git(['commit', '-qm', 'base'], { cwd: ROOT });
  return git(['rev-parse', 'HEAD'], { cwd: ROOT }).trim();
}

const sha = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return '(missing)'; } };

// The mutation forms named in §4. No shell parser is built; these establish the boundary.
const FORMS = [
  ['heredoc',        `cat > target.py <<'EOF'\nCHANGED_heredoc\nEOF`],
  ['echo redirect',  `echo CHANGED_echo > target.py`],
  ['printf redirect', `printf 'CHANGED_printf\\n' > target.py`],
  ['append',         `echo APPENDED >> target.py`],
  ['sed -i',         `sed -i 's/ORIGINAL/CHANGED_sed/' target.py`],
  ['python write',   `python -c "open('target.py','w').write('CHANGED_py\\n')"`],
  ['node write',     `node -e "require('fs').writeFileSync('target.py','CHANGED_node\\n')"`],
  ['cp',             `cp target.py copy.py`],
  ['mv',             `mv target.py moved.py`],
];

const rows = [];
for (const [name, cmd] of FORMS) {
  const base = fixture();
  const sandbox = new LocalSandbox(ROOT);
  const tools = makeTools(sandbox);
  const before = sha(path.join(ROOT, 'target.py'));

  // Q2 — authorization/recovery class, from the REAL classifier the worker consults.
  const cls = classifyShell(cmd);
  const rec = tools.bash.recovery({ cmd });
  const decision = decideRecovery(rec);

  // Q3 — does the tool layer capture any pre-state witness for bash? (write does; bash?)
  const hasWitness = typeof tools.bash.captureWitness === 'function';

  let ran = true, err = null;
  try { tools.bash.run({ cmd }); } catch (e) { ran = false; err = String(e.message).slice(0, 80); }

  const after = sha(path.join(ROOT, 'target.py'));
  // Q1 — evaluator-level observability, the same channel report-baseline.mjs uses.
  const tracked = git(['-C', ROOT, 'diff', '--stat', base]).trim();
  const untracked = git(['-C', ROOT, 'status', '--porcelain']).trim();
  const observable = !!(tracked || untracked);

  rows.push({
    form: name, cmd: cmd.split('\n')[0].slice(0, 46),
    ran, err,
    changed: before !== after || /copy\.py|moved\.py/.test(untracked),
    observable_via_git: observable,
    recovery_class: cls,
    recovery_decision: decision.decision,
    recovery_reason: decision.reason,
    bash_captures_witness: hasWitness,
    has_verify: typeof rec.verify === 'function',
  });
}

// Contrast: what `write` carries, for the same file.
const base = fixture();
const sandbox = new LocalSandbox(ROOT);
const tools = makeTools(sandbox);
const wRec = tools.write.recovery({ path: 'target.py', content: 'X\n' });
const writeContrast = {
  captures_witness: typeof tools.write.captureWitness === 'function',
  has_verify: typeof wRec.verify === 'function',
  class: wRec.class,
  escalateOnUnknown: !!wRec.escalateOnUnknown,
};
const eRec = tools.edit.recovery({ path: 'target.py', old_string: 'ORIGINAL', new_string: 'X' });
const editContrast = { has_verify: typeof eRec.verify === 'function', class: eRec.class };

const out = { at: new Date().toISOString(), rows, writeContrast, editContrast };
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'deterministic.json'), JSON.stringify(out, null, 2));

console.log('form               ran  changed  git-visible  class       decision   verify  witness');
for (const r of rows)
  console.log(`${r.form.padEnd(18)} ${String(r.ran).padEnd(4)} ${String(r.changed).padEnd(8)} `
    + `${String(r.observable_via_git).padEnd(12)} ${r.recovery_class.padEnd(11)} ${r.recovery_decision.padEnd(10)} `
    + `${String(r.has_verify).padEnd(7)} ${r.bash_captures_witness}`);
console.log('\nwrite contrast:', JSON.stringify(writeContrast));
console.log('edit  contrast:', JSON.stringify(editContrast));
console.log(`\nwrote ${path.join(dir, 'deterministic.json')}`);
