// Build the edit-failure corpus (brief §3).
//
// Extracts every observed `old_string not found` from the committed real-repository trajectories
// and classifies each against the ACTUAL source bytes at the pinned commit. Classification is
// evidence-driven: a category is assigned only when the bytes support it, otherwise UNKNOWN.
//
// This reads reports; it changes nothing.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPOSITORIES } from '../repositories/index.mjs';
import { REAL_TASK_BY_ID } from '../tasks/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.join(HERE, '..', 'reports');
const CACHE = path.join(os.tmpdir(), 'harness-real-eval', '_cache');

/** Pinned file content, straight out of the bare mirror. */
const fileCache = new Map();
function pinnedFile(repoId, rel) {
  const key = `${repoId}:${rel}`;
  if (fileCache.has(key)) return fileCache.get(key);
  const repo = REPOSITORIES[repoId];
  let out = null;
  try {
    out = execFileSync('git', ['--git-dir', path.join(CACHE, `${repoId}.git`),
                               'show', `${repo.commit}:${rel}`],
                       { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { /* file may not exist at the pin */ }
  fileCache.set(key, out);
  return out;
}

const norm = {
  ws:     (s) => s.replace(/[ \t]+/g, ' '),          // collapse runs of spaces/tabs
  all:    (s) => s.replace(/\s+/g, ''),              // ignore all whitespace
  indent: (s) => s.split('\n').map(l => l.replace(/^[ \t]+/, '')).join('\n'),
  tabs:   (s) => s.replace(/\t/g, '  '),             // tabs -> 2 spaces
  eol:    (s) => s.replace(/\r\n/g, '\n'),
};

/**
 * Classify why `old` did not match `src`. Order matters: the most specific
 * evidence-supported explanation wins.
 */
export function classifyMismatch(src, old) {
  if (src == null) return { kind: 'WRONG_FILE', detail: 'file does not exist at the pinned commit' };
  if (src.includes(old)) return { kind: 'UNKNOWN', detail: 'string IS present — mismatch not reproducible from the pin' };

  // Line-ending only
  if (norm.eol(src).includes(norm.eol(old))) return { kind: 'EOL_MISMATCH', detail: 'differs only in line endings' };

  // Indentation only (leading whitespace per line)
  if (norm.indent(src).includes(norm.indent(old)))
    return { kind: 'INDENTATION_MISMATCH', detail: 'identical once leading indentation is stripped' };

  // Tab/space substitution
  if (norm.tabs(src).includes(norm.tabs(old)))
    return { kind: 'TAB_SPACE_MISMATCH', detail: 'identical once tabs are expanded to spaces' };

  // Any interior whitespace run difference
  if (norm.ws(src).includes(norm.ws(old)))
    return { kind: 'WHITESPACE_MISMATCH', detail: 'identical once whitespace runs are collapsed' };

  // Whitespace-insensitive entirely
  if (norm.all(src).includes(norm.all(old)))
    return { kind: 'WHITESPACE_MISMATCH', detail: 'identical once all whitespace is ignored' };

  // Is the region even present? Use the longest single line as a probe.
  const lines = old.split('\n').map(l => l.trim()).filter(l => l.length > 8);
  const anchored = lines.filter(l => norm.all(src).includes(norm.all(l)));
  if (anchored.length === 0)
    return { kind: 'WRONG_REGION', detail: 'no line of old_string appears anywhere in the file' };
  if (anchored.length < lines.length)
    return { kind: 'NEARBY_CONTEXT_MISMATCH',
             detail: `${anchored.length}/${lines.length} lines present; surrounding context differs` };

  return { kind: 'EXACT_TEXT_MISMATCH', detail: 'all lines present individually but not as a contiguous block' };
}

/** Pull edit attempts out of a run's event history. */
function editAttempts(explain) {
  // `explain` renders args truncated; the corpus therefore reports what is recoverable from it.
  const out = [];
  const re = /· edit (\{.*?)\n/g;
  let m;
  while ((m = re.exec(explain)) !== null) out.push(m[1]);
  return out;
}

const rows = [];
for (const file of fs.readdirSync(REPORTS).filter(f => f.endsWith('.json'))) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(REPORTS, file), 'utf8')); } catch { continue; }
  if (!Array.isArray(d.results)) continue;
  for (const r of d.results) {
    const ex = r.explain ?? '';
    const nf = (ex.match(/old_string not found/g) ?? []).length;
    if (!nf) continue;
    const task = REAL_TASK_BY_ID[r.task_id];
    rows.push({
      report: file, task_id: r.task_id, repository: r.repository ?? task?.repository,
      repeat: r.repeat, outcome: r.outcome,
      not_found_count: nf,
      ambiguous_count: (ex.match(/is ambiguous in/g) ?? []).length,
      recovered: r.outcome === 'PASS',
      retried: nf > 1,
      model_calls: r.metrics?.model_calls ?? null,
      failure_class: r.failure_class ?? null,
      attempts_seen: editAttempts(ex).length,
      // what the agent did immediately after the first failure
      next_action: (() => {
        const i = ex.indexOf('old_string not found');
        const after = [...ex.slice(i).matchAll(/· (\w+) \{/g)].map(x => x[1]);
        return after.slice(0, 3).join(' -> ') || '(none)';
      })(),
    });
  }
}

const byOutcome = { PASS: 0, FAIL: 0, other: 0 };
for (const r of rows) byOutcome[r.outcome === 'PASS' ? 'PASS' : r.outcome === 'FAIL' ? 'FAIL' : 'other']++;

const out = {
  at: new Date().toISOString(),
  runs_with_edit_failure: rows.length,
  by_outcome: byOutcome,
  total_not_found: rows.reduce((a, r) => a + r.not_found_count, 0),
  total_ambiguous: rows.reduce((a, r) => a + r.ambiguous_count, 0),
  rows,
};
fs.writeFileSync(path.join(REPORTS, 'edit-failure-corpus.json'), JSON.stringify(out, null, 2));

console.log(`runs containing old_string-not-found: ${rows.length}`);
console.log(`  PASS (recovered): ${byOutcome.PASS}   FAIL: ${byOutcome.FAIL}`);
console.log(`  total not-found errors: ${out.total_not_found}`);
console.log(`  total AMBIGUITY errors: ${out.total_ambiguous}`);
console.log('\nby task:');
const byTask = {};
for (const r of rows) {
  const t = (byTask[r.task_id] ??= { runs: 0, pass: 0, nf: 0 });
  t.runs++; if (r.outcome === 'PASS') t.pass++; t.nf += r.not_found_count;
}
for (const [k, v] of Object.entries(byTask).sort((a, b) => b[1].nf - a[1].nf))
  console.log(`  ${k.padEnd(30)} runs=${v.runs} recovered=${v.pass} not_found=${v.nf}`);
console.log(`\nwrote ${path.join(REPORTS, 'edit-failure-corpus.json')}`);
