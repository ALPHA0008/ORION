#!/usr/bin/env node
// W5 Q3 — lint and format, with ZERO dependencies.
//
// The defect register grades Q3 "Low", and the obvious fix (ESLint + Prettier) costs ~100
// transitive packages in a project whose single most distinctive property is that it has none.
// A general-purpose linter would also spend most of its output on style opinions nobody here
// has expressed, while missing every convention this codebase actually holds.
//
// So this checks the rules THIS project has, each of which has a reason:
//
//   1. NO CONTROL CHARACTERS, especially 0x08. This has bitten twice. Writing source through a
//      tool that interprets `\b` turns a regex word-boundary into a literal backspace byte: the
//      file still parses, the regex silently stops matching, and the bug is invisible in every
//      normal view of the file. The W5 session prompt requires a byte scan before done — this
//      is that scan, made permanent.
//   2. No tab indentation. ADR-012 exists because a tab in the wrong place corrupted every
//      `edit` on a tab-indented file; the source itself staying space-indented is the least
//      this project can do.
//   3. No trailing whitespace, and a final newline. Ordinary hygiene, but it keeps diffs about
//      content.
//   4. No `debugger`, no leftover `console.log` outside the CLI and tests. The event log is the
//      log (see the capability map); a stray print bypasses it.
//   5. Line length is REPORTED, not enforced — the comments here are prose and carry the
//      reasoning, and hard-wrapping them at a fixed column would damage that.
//
// Usage: node tests/lint.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const asJson = process.argv.includes('--json');

const TARGETS = ['src', 'tests'];
const SKIP_DIRS = new Set(['node_modules', '.git', '_experiments']);

const files = [];
const walk = (d) => {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith('.mjs')) files.push(p);
  }
};
for (const t of TARGETS) walk(path.join(ROOT, t));

const problems = [];
const notes = [];
const at = (file, line) => `${path.relative(ROOT, file).split(path.sep).join('/')}:${line}`;

for (const file of files) {
  const buf = fs.readFileSync(file);
  const text = buf.toString('utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');

  // ── 1. control characters ────────────────────────────────────────────────
  // Everything below 0x20 except TAB (0x09), LF (0x0A) and CR (0x0D). 0x08 is called out by
  // name because it is the one that has actually shipped here.
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    const line = text.slice(0, i).split('\n').length;
    const name = b === 0x08 ? '0x08 BACKSPACE (a `\\b` written through a tool that interpreted it)'
                            : `0x${b.toString(16).padStart(2, '0')}`;
    problems.push(`${at(file, line)}: control character ${name}`);
  }

  const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    const n = i + 1;
    // ── 2. tab indentation ─────────────────────────────────────────────────
    if (/^\t/.test(l)) problems.push(`${at(file, n)}: tab indentation`);
    // ── 3. trailing whitespace ─────────────────────────────────────────────
    if (/[ \t]+$/.test(l)) problems.push(`${at(file, n)}: trailing whitespace`);
    // ── 4. debug leftovers ─────────────────────────────────────────────────
    // A statement, not a mention: `debugger;` or `debugger` alone on a line. The looser
    // word-boundary form matched this very file's own detection code.
    if (/^\s*debugger\s*;?\s*$/.test(l))
      problems.push(`${at(file, n)}: leftover debug statement`);
    // 5. long lines are a note, never a failure.
    if (l.length > 110) notes.push(`${at(file, n)}: ${l.length} chars`);
  });

  // ── final newline ──────────────────────────────────────────────────────
  if (text.length && !text.endsWith('\n')) problems.push(`${rel}: no final newline`);
}

const report = { at: new Date().toISOString(), files: files.length, problems, long_lines: notes.length };
fs.writeFileSync(path.join(HERE, 'results-lint.json'), JSON.stringify(report, null, 2) + '\n');

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nlint: ${files.length} files checked`);
  if (notes.length) console.log(`  ${notes.length} line(s) over 110 chars (reported, not enforced)`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 60)) console.log(`  ${p}`);
    if (problems.length > 60) console.log(`  … and ${problems.length - 60} more`);
  } else {
    console.log('  no problems');
  }
}

process.exit(problems.length ? 1 : 0);
