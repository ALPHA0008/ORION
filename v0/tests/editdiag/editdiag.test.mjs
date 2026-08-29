// Edit diagnostics (capability experiment 02).
//
// The tool must stay EXACT. These tests exist mostly to prove the diagnostic never becomes a
// fuzzy apply: every no-match case must leave the file byte-identical.
//
// Written before the implementation, per brief §8.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { MSG_CLAMP } from '../../src/core/projection/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editdiag-'));
const sandbox = new LocalSandbox(dir);
const tools = makeTools(sandbox);

/** Attempt an edit; return { ok, error, changed }. */
function attempt(file, content, old_string, new_string) {
  sandbox.write(file, content);
  const before = sandbox.read(file);
  try {
    tools.edit.run({ path: file, old_string, new_string });
    return { ok: true, error: null, changed: sandbox.read(file) !== before, after: sandbox.read(file) };
  } catch (e) {
    return { ok: false, error: String(e.message), changed: sandbox.read(file) !== before,
             after: sandbox.read(file) };
  }
}

// Real shape, from p-limit@df476048 — one tab before `const next`, two before the body.
const PLIMIT = 'const queue = new Queue();\n\tconst next = () => {\n\t\tactiveCount--;\n\t\tresumeNext();\n\t};\n';

console.log('editdiag');

// ── 1. exact match still applies ────────────────────────────────────────
{
  const r = attempt('a.js', PLIMIT, '\t\tactiveCount--;', '\t\tactiveCount++;');
  ok('exact match applies', r.ok && r.changed);
  ok('  applied the intended text', r.after.includes('activeCount++;'));
}

// ── 2. no match: NOTHING is modified (fail closed) ──────────────────────
{
  const r = attempt('b.js', PLIMIT, 'totallyAbsentText()', 'x');
  ok('no match fails', !r.ok);
  ok('  file is byte-identical', !r.changed);
  ok('  error names the tool failure', /old_string not found/.test(r.error), r.error);
}

// ── 3. THE REAL CASE: indentation mismatch ──────────────────────────────
{
  // agent sends two tabs; file has one
  const r = attempt('c.js', PLIMIT, '\t\tconst next = () => {\n\t\t\tactiveCount--;', 'x');
  ok('indentation mismatch fails (no fuzzy apply)', !r.ok);
  ok('  file unmodified', !r.changed);
  ok('  diagnostic identifies whitespace as the cause',
     /whitespace|indent/i.test(r.error), r.error);
  ok('  diagnostic gives a line number', /line \d+/.test(r.error), r.error);
  ok('  diagnostic renders tabs visibly', /→/.test(r.error), r.error);
  ok('  diagnostic shows the actual file text', /const·next|const next/.test(r.error), r.error);
}

// ── 4. tab/space substitution ───────────────────────────────────────────
{
  const spaces = PLIMIT.replace(/\t/g, '  ');
  const r = attempt('d.js', spaces, '\tconst next = () => {', 'x');
  ok('tab-vs-space mismatch fails', !r.ok);
  ok('  file unmodified', !r.changed);
  ok('  diagnostic mentions whitespace', /whitespace|indent/i.test(r.error), r.error);
}

// ── 5. wrong region: say so, do not invent a nearest match ──────────────
{
  const r = attempt('e.js', PLIMIT, 'function nothingLikeThis(zz) {\n  return zz;\n}', 'x');
  ok('wrong region fails', !r.ok);
  ok('  file unmodified', !r.changed);
  ok('  diagnostic does NOT claim a whitespace match',
     !/except for whitespace/i.test(r.error), r.error);
}

// ── 6. ambiguity handling is NOT weakened ───────────────────────────────
{
  const dup = 'const a = 1;\nconst a = 1;\n';
  const r = attempt('f.js', dup, 'const a = 1;', 'const a = 2;');
  ok('ambiguous old_string still fails', !r.ok);
  ok('  file unmodified', !r.changed);
  ok('  error still reports ambiguity and the count',
     /ambiguous/.test(r.error) && /2/.test(r.error), r.error);
}

// ── 7. two similar regions: no silent pick ──────────────────────────────
{
  const two = 'function f() {\n\treturn 1;\n}\n\nfunction g() {\n\t\treturn 1;\n}\n';
  const r = attempt('g.js', two, '\t\t\treturn 1;', '\t\t\treturn 2;');
  ok('similar-but-absent string fails', !r.ok);
  ok('  file unmodified — no ambiguous auto-edit', !r.changed);
}

// ── 8. context budget ───────────────────────────────────────────────────
{
  const big = Array.from({ length: 500 }, (_, i) => `\tline${i} = ${i};`).join('\n');
  const r = attempt('h.js', big, '\t\tline250 = 250;', 'x');
  ok('large file: still fails closed', !r.ok && !r.changed);
  const bytes = Buffer.byteLength(r.error);
  ok(`  diagnostic is bounded (${bytes}b <= MSG_CLAMP ${MSG_CLAMP})`, bytes <= MSG_CLAMP,
     `${bytes} bytes`);
  ok('  diagnostic does not dump the whole file', bytes < Buffer.byteLength(big) / 2,
     `${bytes} vs file ${Buffer.byteLength(big)}`);
}

// ── 9. EOL mismatch ─────────────────────────────────────────────────────
{
  const crlf = 'const a = 1;\r\nconst b = 2;\r\n';
  const r = attempt('i.js', crlf, 'const a = 1;\nconst b = 2;', 'x');
  ok('EOL mismatch fails', !r.ok);
  ok('  file unmodified', !r.changed);
  ok('  diagnostic mentions line endings or whitespace',
     /line ending|EOL|whitespace/i.test(r.error), r.error);
}

// ── 10. the diagnostic must be USABLE: following it produces a match ────
{
  // Simulate the recovery loop: fail, parse the shown text, retry with it.
  sandbox.write('j.js', PLIMIT);
  let err = '';
  try { tools.edit.run({ path: 'j.js', old_string: '\t\tconst next = () => {', new_string: 'x' }); }
  catch (e) { err = String(e.message); }

  // Extract the rendered lines and convert the visible markers back to real whitespace.
  const shown = err.split('\n').filter(l => /^[→·]/.test(l))
                   .map(l => l.replace(/→/g, '\t').replace(/·/g, ' '));
  ok('diagnostic exposes at least one candidate line', shown.length > 0, JSON.stringify(err));
  if (shown.length) {
    const r2 = attempt('j.js', PLIMIT, shown[0], 'RECOVERED');
    ok('  retrying with the diagnostic text SUCCEEDS', r2.ok, r2.error ?? '');
    ok('  and applies the intended change', r2.after?.includes('RECOVERED'));
  }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\neditdiag: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
