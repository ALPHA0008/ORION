// read representation fidelity (ADR-012, phase 8).
//
// The line-number separator was a TAB, so it merged with source indentation and a model copying
// the visible whitespace emitted one tab too many. Measured A/B (phase 3): TAB 2/10 correct with
// 48 `old_string not found`; pipe 10/10 with 0. That produced a FALSE diagnosis that the `edit`
// primitive was weak.
//
// These tests assert the representation contract at BYTE level, not by inspection.

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
const note = (s) => console.log(`       ${s}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfid-'));
const sandbox = new LocalSandbox(dir);
const tools = makeTools(sandbox);
const read = (a) => tools.read.run(a);

/** Contract: everything after the FIRST '|' on a rendered line is the source line, verbatim. */
const body = (rendered) => rendered.slice(rendered.indexOf('|') + 1);
/** Reconstruct source from a full (unpaged) rendering. */
const reconstruct = (out) => out.split('\n').map(body).join('\n');

console.log('readfidelity');

// ── 1. THE HISTORICAL DEFECT: tab counts must be exact ──────────────────
{
  const SRC = 'function f() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n';
  sandbox.write('tabs.js', SRC);
  const out = read({ path: 'tabs.js' });
  const lines = out.split('\n');

  const shown = (i) => (body(lines[i]).match(/\t/g) ?? []).length;
  const actual = (i) => (SRC.split('\n')[i].match(/\t/g) ?? []).length;

  ok('1 tab renders as 1 tab', shown(1) === actual(1), `${shown(1)} vs ${actual(1)}`);
  ok('2 tabs render as 2 tabs', shown(2) === actual(2), `${shown(2)} vs ${actual(2)}`);
  ok('separator is not a tab', !/^\s*\d+\t/.test(lines[0]), JSON.stringify(lines[0]));
  note(`line 3 renders as ${JSON.stringify(lines[2])}`);
}

// ── 2. §8 byte round-trip ───────────────────────────────────────────────
{
  const cases = {
    'spaces.js': 'a\n  b\n    c\n',
    'tabs.js': 'a\n\tb\n\t\tc\n\t\t\t\t\td\n',
    'mixed.js': '\t  tabThenSpace\n  \tspaceThenTab\n',
    'trailing.js': 'a   \nb\t\nc\n',
    'blank.js': 'a\n\n\nb\n',
    'single.js': 'only one line\n',
    'unicode.js': 'const π = 3.14;\nconst 変数 = "日本語";\nconst e = "café";\n// ✓ ☃ 𝟘\n',
    'nonl.js': 'no trailing newline',
  };
  for (const [f, src] of Object.entries(cases)) {
    sandbox.write(f, src);
    const back = reconstruct(read({ path: f }));
    const expect = src.endsWith('\n') ? src.slice(0, -1) : src;
    ok(`round-trip EXACT: ${f}`, back === expect,
       `${JSON.stringify(back).slice(0, 60)} vs ${JSON.stringify(expect).slice(0, 60)}`);
  }
}

// ── 3. §12 adversarial whitespace, rendered unambiguously ───────────────
{
  const SRC = [
    'zero',
    '\tone',
    '\t\ttwo',
    '\t\t\t\t\tfive',
    '\t  tabThenSpaces',
    '  \tspacesThenTab',
    'trailing   ',
    '',
    'end',
  ].join('\n') + '\n';
  sandbox.write('ws.js', SRC);
  const out = read({ path: 'ws.js' });
  const lines = out.split('\n');
  const srcLines = SRC.split('\n').slice(0, -1);

  let allExact = true;
  for (let i = 0; i < srcLines.length; i++) if (body(lines[i]) !== srcLines[i]) allExact = false;
  ok('every adversarial whitespace line is byte-exact', allExact);

  ok('  five tabs render as five tabs', (body(lines[3]).match(/\t/g) ?? []).length === 5);
  ok('  tab-then-spaces preserved', body(lines[4]) === '\t  tabThenSpaces');
  ok('  spaces-then-tab preserved', body(lines[5]) === '  \tspacesThenTab');
  ok('  trailing spaces preserved', body(lines[6]) === 'trailing   ');
  ok('  blank line renders as number + delimiter only', body(lines[7]) === '');
  ok('  blank line still has its number', /^\s*8\|$/.test(lines[7]), JSON.stringify(lines[7]));
}

// ── 4. CRLF is preserved, not normalised ────────────────────────────────
{
  sandbox.write('crlf.js', 'a\r\nb\r\nc\r\n');
  const out = read({ path: 'crlf.js' });
  ok('CRLF: \\r is preserved on the line', body(out.split('\n')[0]) === 'a\r',
     JSON.stringify(body(out.split('\n')[0])));
  note('read never rewrites line endings — normalising would break exact editing on CRLF files');
}

// ── 5. empty file ───────────────────────────────────────────────────────
{
  sandbox.write('empty.js', '');
  let threw = false, out = '';
  try { out = read({ path: 'empty.js' }); } catch { threw = true; }
  ok('empty file does not throw', !threw);
  note(`empty file renders as ${JSON.stringify(out)}`);
}

// ── 6. §14 a line longer than the page budget ───────────────────────────
{
  const LONG = 'x'.repeat(5000);
  sandbox.write('long.js', `short\n${LONG}\nafter\n`);
  const page = read({ path: 'long.js', offset: 2, limit: 1 });
  ok('over-long line is returned, not dropped', page.includes('xxx'));
  ok('  it is still attributed to its line number', /^\s*2\|/m.test(page), page.slice(0, 40));
  note(`over-long line page is ${Buffer.byteLength(page)} bytes`);
}

// ── 7. §11 the context bound is still enforced ──────────────────────────
{
  const big = Array.from({ length: 400 }, (_, i) => `\t\tline ${i + 1}`).join('\n');
  sandbox.write('big.js', big);
  const page = read({ path: 'big.js' });
  ok('a page still fits inside MSG_CLAMP', Buffer.byteLength(page) <= MSG_CLAMP,
     `${Buffer.byteLength(page)} > ${MSG_CLAMP}`);
  ok('  and still advertises the next offset', /offset=\d+/.test(page));
}

// ── 8. §15 THE INTEGRATION: read -> edit on tab-indented source ─────────
{
  const SRC = 'export default function pLimit(concurrency) {\n'
            + '\tconst queue = new Queue();\n'
            + '\tconst next = () => {\n'
            + '\t\tactiveCount--;\n'
            + '\t\tresumeNext();\n'
            + '\t};\n'
            + '}\n';
  sandbox.write('plimit.js', SRC);
  const out = read({ path: 'plimit.js' });

  // Copy the rendered content VERBATIM, exactly as a model would.
  const target = body(out.split('\n')[3]);          // "\t\tactiveCount--;"
  ok('copied line is byte-identical to source', target === '\t\tactiveCount--;',
     JSON.stringify(target));

  let threw = false;
  try { tools.edit.run({ path: 'plimit.js', old_string: target, new_string: '\t\tactiveCount -= 1;' }); }
  catch { threw = true; }
  ok('edit with the copied text SUCCEEDS', !threw);
  ok('  the change landed', sandbox.read('plimit.js').includes('activeCount -= 1;'));

  // Multi-line copy, the harder case.
  sandbox.write('plimit2.js', SRC);
  const out2 = read({ path: 'plimit2.js' });
  const multi = [2, 3, 4].map(i => body(out2.split('\n')[i])).join('\n');
  let threw2 = false;
  try { tools.edit.run({ path: 'plimit2.js', old_string: multi, new_string: '\tconst next = () => {};' }); }
  catch { threw2 = true; }
  ok('multi-line copied block also matches exactly', !threw2);
}

// ── 9. the OLD format would have failed the same edit ───────────────────
{
  // Demonstrates the defect is real, not hypothetical: reproduce the old rendering and show that
  // copying from it produces a byte-inequivalent string.
  const SRC = 'a\n\t\treturn 1;\n';
  sandbox.write('old.js', SRC);
  const oldRendered = SRC.split('\n').slice(0, -1).map((l, i) => `${i + 1}\t${l}`);
  const oldCopied = oldRendered[1].replace(/^\d+/, '');   // a model strips the number
  ok('OLD format copy is byte-INEQUIVALENT to source', oldCopied !== '\t\treturn 1;',
     JSON.stringify(oldCopied));
  note(`old copy = ${JSON.stringify(oldCopied)} (3 tabs) vs source ${JSON.stringify('\t\treturn 1;')} (2 tabs)`);

  const newRendered = read({ path: 'old.js' });
  ok('NEW format copy IS byte-equivalent', body(newRendered.split('\n')[1]) === '\t\treturn 1;');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nreadfidelity: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
