// Classify edit mismatches against ACTUAL pinned source bytes (brief §3).
//
// `explain` truncates tool args, so the exact `old_string` the model sent is not recoverable from
// the rendered trajectory. It IS recoverable from the run's event store — but those databases are
// per-run temporaries that no longer exist.
//
// Rather than guess, this reconstructs the mismatch classes from the one case where the exact
// bytes WERE captured in phase 2 (`plimit-active-count`), and then measures how often each class
// is even *possible* by testing the pinned sources of every affected task against the kinds of
// string a model plausibly emits: re-indented, tab-expanded, and EOL-normalised variants.
//
// This is honest about what it is: a characterisation of the mismatch space over real files, not
// a census of what the model actually sent. It changes nothing.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { REPOSITORIES } from '../repositories/index.mjs';
import { classifyMismatch } from './edit-corpus.mjs';

const CACHE = path.join(os.tmpdir(), 'harness-real-eval', '_cache');

function pinned(repoId, rel) {
  const repo = REPOSITORIES[repoId];
  return execFileSync('git', ['--git-dir', path.join(CACHE, `${repoId}.git`),
                              'show', `${repo.commit}:${rel}`],
                      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// The affected files, from the corpus.
const TARGETS = [
  ['p-limit', 'index.js'],
  ['camelcase', 'index.js'],
  ['slugify', 'index.js'],
];

// The one exactly-captured real failure (phase 2, plimit-active-count).
const CAPTURED = {
  repo: 'p-limit', file: 'index.js',
  old_string: '\t\tconst next = () => {\n\t\t\tactiveCount--;',
  note: 'exact bytes recovered from the phase-2 trajectory',
};

console.log('=== the one exactly-captured failure ===');
{
  const src = pinned(CAPTURED.repo, CAPTURED.file);
  const c = classifyMismatch(src, CAPTURED.old_string);
  console.log(`  ${CAPTURED.repo}/${CAPTURED.file}`);
  console.log(`  sent:  ${JSON.stringify(CAPTURED.old_string)}`);
  const i = src.indexOf('const next');
  console.log(`  file:  ${JSON.stringify(src.slice(i - 4, i + 40))}`);
  console.log(`  => ${c.kind}: ${c.detail}`);
}

// How reachable is each mismatch class over the real files? Take genuine snippets from each
// file and perturb them the way a model plausibly would.
console.log('\n=== mismatch-class reachability over the affected real files ===');
const PERTURB = {
  INDENTATION_MISMATCH: (s) => s.split('\n').map(l => l.replace(/^(\s*)/, '$1\t')).join('\n'),
  TAB_SPACE_MISMATCH:   (s) => s.replace(/\t/g, '  '),
  EOL_MISMATCH:         (s) => s.replace(/\n/g, '\r\n'),
  WHITESPACE_MISMATCH:  (s) => s.replace(/ = /g, '='),
  WRONG_REGION:         () => 'function thisDoesNotExistAnywhere(qqq) {\n  return qqq;\n}',
};

const tally = {};
for (const [repo, file] of TARGETS) {
  const src = pinned(repo, file);
  const lines = src.split('\n');
  // a representative multi-line snippet from the middle of the file
  const start = Math.floor(lines.length * 0.4);
  const snippet = lines.slice(start, start + 3).join('\n');
  if (!src.includes(snippet)) continue;
  for (const [want, fn] of Object.entries(PERTURB)) {
    const got = classifyMismatch(src, fn(snippet));
    tally[got.kind] = (tally[got.kind] ?? 0) + 1;
    const mark = got.kind === want ? 'ok  ' : 'note';
    console.log(`  ${mark} ${repo}/${file}  perturb=${want.padEnd(22)} -> ${got.kind}`);
  }
}
console.log('\nclassifier output distribution:', JSON.stringify(tally));
