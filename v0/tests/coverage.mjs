#!/usr/bin/env node
// W5 Q2 — coverage, with ZERO dependencies.
//
// The runtime ships no dependencies and adds none for tooling, so this reads V8's own coverage
// output (`NODE_V8_COVERAGE`) rather than pulling in c8/nyc. Node's `--experimental-test-coverage`
// is not usable here: it only instruments `node:test`, and this project uses its own harness.
//
// WHAT IT REPORTS, AND WHY THAT SHAPE
//
// Per-file BYTE coverage over `src/`, derived from V8's ranges. Byte coverage is what V8 gives
// directly and needs no source mapping or AST parsing to be truthful. It is not line coverage
// and is not claimed to be — a large comment block or a long string literal counts as covered
// bytes, so absolute numbers read slightly high. What it is good for is the comparison this
// wave cares about: which modules are exercised by the suite and which are not, and whether
// that changes.
//
// Coverage is REPORTED, not gated on a percentage. A threshold invites tests written to move a
// number; this project's standard is that a test must fail against the unfixed code (see
// `eval/selfcheck.mjs` and the W5 falsification checks). The useful signal is a module at or
// near zero, which means a whole capability is untested.
//
// Usage:
//   node tests/coverage.mjs            run the suite under coverage and report
//   node tests/coverage.mjs --json     machine-readable

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'src');
const asJson = process.argv.includes('--json');

const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-cov-'));
const res = spawnSync(process.execPath, [path.join(HERE, 'run-all.mjs')], {
  cwd: ROOT,
  env: { ...process.env, NODE_V8_COVERAGE: covDir },
  stdio: asJson ? 'ignore' : 'inherit',
});

// Merge every process's coverage: the suite spawns child processes per suite file, and each
// writes its own report. A file exercised only by a child would otherwise look untouched.
/** @type {Map<string, {covered: Set<number>, total: number}>} */
const byFile = new Map();

for (const name of fs.readdirSync(covDir)) {
  if (!name.endsWith('.json')) continue;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(path.join(covDir, name), 'utf8')); }
  catch { continue; }                        // a torn report from a killed process
  for (const script of doc.result ?? []) {
    if (!script.url?.startsWith('file:')) continue;
    let file;
    try { file = fileURLToPath(script.url); } catch { continue; }
    if (!file.startsWith(SRC)) continue;     // src/ only — not tests, not node internals

    let entry = byFile.get(file);
    if (!entry) {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { continue; }
      entry = { covered: new Set(), total: size };
      byFile.set(file, entry);
    }
    // V8 reports nested ranges: an inner range with count 0 carves a hole out of a covered
    // outer one. Mark covered bytes first, then subtract the uncovered inner ranges, or a
    // function that never ran would be counted as covered because its file-level range was.
    for (const fn of script.functions ?? []) {
      for (const r of fn.ranges ?? []) {
        if (r.count === 0) continue;
        for (let i = r.startOffset; i < r.endOffset; i++) entry.covered.add(i);
      }
    }
    for (const fn of script.functions ?? []) {
      for (const r of fn.ranges ?? []) {
        if (r.count !== 0) continue;
        for (let i = r.startOffset; i < r.endOffset; i++) entry.covered.delete(i);
      }
    }
  }
}

fs.rmSync(covDir, { recursive: true, force: true });

// Every source file, including ones the suite never loaded at all — those are the finding.
const allSrc = [];
const walk = (d) => {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith('.mjs')) allSrc.push(p);
  }
};
walk(SRC);

const rows = allSrc.map((file) => {
  const e = byFile.get(file);
  const total = e?.total ?? fs.statSync(file).size;
  const covered = e?.covered.size ?? 0;
  return {
    file: path.relative(ROOT, file).split(path.sep).join('/'),
    covered, total,
    pct: total ? +(covered / total * 100).toFixed(1) : 0,
  };
}).sort((a, b) => a.pct - b.pct);

const totals = rows.reduce((a, r) => ({ covered: a.covered + r.covered, total: a.total + r.total }),
  { covered: 0, total: 0 });
const overall = totals.total ? +(totals.covered / totals.total * 100).toFixed(1) : 0;

const report = { at: new Date().toISOString(), suite_exit_code: res.status, overall_pct: overall, files: rows };
fs.writeFileSync(path.join(HERE, 'results-coverage.json'), JSON.stringify(report, null, 2) + '\n');

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('\n' + '─'.repeat(72));
  console.log('COVERAGE (V8 byte coverage over src/ — see the header for what this does and does not mean)');
  console.log('─'.repeat(72));
  for (const r of rows) {
    const bar = '█'.repeat(Math.round(r.pct / 5)).padEnd(20, '·');
    const flag = r.pct === 0 ? '  ← never exercised' : r.pct < 40 ? '  ← thin' : '';
    console.log(`${String(r.pct).padStart(6)}%  ${bar}  ${r.file}${flag}`);
  }
  console.log('─'.repeat(72));
  console.log(`overall ${overall}%  (${totals.covered.toLocaleString()} / ${totals.total.toLocaleString()} bytes)`);
  const dead = rows.filter(r => r.pct === 0);
  if (dead.length) console.log(`\n${dead.length} file(s) never exercised: ${dead.map(r => r.file).join(', ')}`);
}

process.exit(res.status === 0 ? 0 : 1);
