// Paged `read` (capability iteration 01).
//
// The failure this fixes: an agent re-issuing an identical read of a large file forever, because
// every result was clamped to the same first 2,000 bytes. The properties that matter are
// therefore (a) the whole file is reachable, and (b) a page always says how to get the next one.

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readpage-'));
const sandbox = new LocalSandbox(dir);
const tools = makeTools(sandbox);
const read = (args) => tools.read.run(args);

// A file comfortably larger than MSG_CLAMP, like the real camelcase/index.js (7,527 B).
const BIG_LINES = 400;
const big = Array.from({ length: BIG_LINES }, (_, i) => `line ${i + 1}: ${'x'.repeat(20)}`).join('\n');
sandbox.write('big.js', big);
sandbox.write('small.js', 'alpha\nbeta\ngamma\n');
sandbox.write('oneline.js', 'y'.repeat(9000));

// ── 1. a single page fits inside the projection clamp ───────────────────
{
  const page = read({ path: 'big.js' });
  ok('one page stays under MSG_CLAMP', page.length <= MSG_CLAMP,
     `page=${page.length} clamp=${MSG_CLAMP}`);
  ok('page is non-trivial', page.split('\n').length > 5);
}

// ── 2. the page tells the agent how to continue ─────────────────────────
{
  const page = read({ path: 'big.js' });
  ok('footer reports remaining lines', /more lines/.test(page), page.slice(-120));
  ok('footer names the exact next offset', /offset=\d+/.test(page), page.slice(-120));
  ok('footer repeats the path', page.includes('path="big.js"'));
}

// ── 3. THE CORE PROPERTY: the whole file is reachable by paging ─────────
{
  const seen = [];
  let offset = 1, guard = 0;
  for (;;) {
    if (++guard > 200) break;                       // never loop forever in a test
    const page = read({ path: 'big.js', offset });
    for (const line of page.split('\n')) {
      const m = /^\s*(\d+)\|(.*)$/.exec(line);
      if (m) seen[Number(m[1]) - 1] = m[2];
    }
    const next = /offset=(\d+)/.exec(page);
    if (!next) break;
    offset = Number(next[1]);
  }
  ok('every line of the file is reachable', seen.filter(Boolean).length === BIG_LINES,
     `got ${seen.filter(Boolean).length}/${BIG_LINES}`);
  ok('reconstructed content matches the file exactly', seen.join('\n') === big);
  ok('paging terminates in a sane number of pages', guard < 20, `pages=${guard}`);
}

// ── 4. successive pages DIFFER (a repeated read must not loop) ──────────
{
  const p1 = read({ path: 'big.js', offset: 1 });
  const next = Number(/offset=(\d+)/.exec(p1)[1]);
  const p2 = read({ path: 'big.js', offset: next });
  ok('page 2 differs from page 1', p1 !== p2);
  ok('page 2 is labelled with its range', /lines \d+-\d+ of \d+/.test(p2), p2.slice(0, 60));
}

// ── 5. small files are unchanged in spirit: whole file, no footer noise ─
{
  const page = read({ path: 'small.js' });
  ok('small file returns all lines', /alpha/.test(page) && /gamma/.test(page));
  ok('small file has no continuation footer', !/more lines/.test(page), page);
}

// ── 6. explicit limit is honoured ───────────────────────────────────────
{
  const page = read({ path: 'big.js', offset: 10, limit: 3 });
  const nums = [...page.matchAll(/^\s*(\d+)\|/gm)].map(m => Number(m[1]));
  ok('limit returns exactly that many lines', nums.length === 3, JSON.stringify(nums));
  ok('offset positions the window', nums[0] === 10, JSON.stringify(nums));
}

// ── 7. degenerate inputs must not hang or throw ─────────────────────────
{
  ok('offset past EOF is reported, not thrown', /past the end/.test(read({ path: 'big.js', offset: 99999 })));
  let threw = false;
  try { read({ path: 'oneline.js' }); } catch { threw = true; }
  ok('a single over-long line still returns', !threw);
  ok('over-long single line is not silently empty', read({ path: 'oneline.js' }).includes('yyy'));
  ok('offset 0 is clamped to the first line', /^\s*1\|/m.test(read({ path: 'big.js', offset: 0 })));
}

// ── 8. line numbers must not leak into edits ────────────────────────────
{
  // `edit` matches raw file content, so a numbered display must not corrupt it.
  sandbox.write('edit-me.js', 'const A = 1;\nconst B = 2;\n');
  tools.edit.run({ path: 'edit-me.js', old_string: 'const B = 2;', new_string: 'const B = 3;' });
  ok('edit still matches raw content after paged read',
     sandbox.read('edit-me.js').includes('const B = 3;'));
  ok('no line-number prefix written into the file',
     !/^\s*\d+\|/m.test(sandbox.read('edit-me.js')));
}

// ── 9. the sandbox's own hard truncation stays visible on every page ────
{
  // The sandbox clamps very large files at MAX_OUTPUT_BYTES independently of paging. That
  // marker must never be paged out of sight, or the agent cannot tell the file is unreadable
  // in full — the exact silent-invisibility failure this iteration removes.
  sandbox.write('huge.txt', 'A'.repeat(300_000));
  const first = read({ path: 'huge.txt' });
  ok('sandbox truncation announced on first page', /truncated/.test(first), first.slice(-160));
  const next = /offset=(\d+)/.exec(first);
  if (next) {
    const later = read({ path: 'huge.txt', offset: Number(next[1]) });
    ok('sandbox truncation still announced on a later page', /truncated/.test(later),
       later.slice(-160));
  } else {
    ok('sandbox truncation still announced on a later page', true, '(single page)');
  }
}


// ── 10. integer schema must accept JSON numbers ─────────────────────────
{
  // JSON has no integer type: 2 arrives as a `number`. Declaring `integer` must not make the
  // parameter unsatisfiable. This regressed once and silently disabled paging entirely — every
  // paged call was rejected and the run died on no_progress.
  const { validateArgs } = await import('../../src/agent/tools/index.mjs');
  ok('integer schema accepts a whole number',
     validateArgs(tools.read, { path: 'big.js', offset: 2 }).length === 0,
     JSON.stringify(validateArgs(tools.read, { path: 'big.js', offset: 2 })));
  ok('integer schema accepts offset AND limit together',
     validateArgs(tools.read, { path: 'big.js', offset: 2, limit: 10 }).length === 0);
  ok('integer schema rejects a fractional number',
     validateArgs(tools.read, { path: 'big.js', offset: 2.5 }).length === 1);
  ok('integer schema rejects a string',
     validateArgs(tools.read, { path: 'big.js', offset: '2' }).length === 1);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nreadpaging: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
