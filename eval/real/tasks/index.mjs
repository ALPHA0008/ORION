// Real-repository task set — 20 tasks over 5 pinned repositories.
//
// Each task injects a realistic defect into a PINNED commit of a REAL repository, then requires
// the repository's OWN test suite to pass again. The agent must read and reason about genuine
// third-party source it has never seen in a fixture.
//
// Every task carries `solution()` — a known-good patch used ONLY for oracle bracketing. It is
// never shown to the agent and never present in the working tree during a run.
//
// Difficulty labels are HYPOTHESES to be checked against measured success rates (section 18).

import fs from 'node:fs';
import path from 'node:path';
import { defineRealTask } from './schema.mjs';

// ── small helpers for mutating a real checkout ──────────────────────────
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const write = (dir, rel, s) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), s);
};
/** Replace exactly once; throw loudly if the anchor moved (the pin protects us, but be strict). */
const sub = (dir, rel, from, to) => {
  const src = read(dir, rel);
  const i = src.indexOf(from);
  if (i === -1) throw new Error(`anchor not found in ${rel}: ${JSON.stringify(from.slice(0, 60))}`);
  if (src.indexOf(from, i + 1) !== -1) throw new Error(`anchor is ambiguous in ${rel}`);
  write(dir, rel, src.slice(0, i) + to + src.slice(i + from.length));
};

const T = (t) => defineRealTask(t);

export const REAL_TASKS = [

  // ══════════════════════════════════════════════ is-number (commonjs, mocha)
  T({
    task_id: 'isnum-string-trim',
    repository: 'is-number',
    description:
      'The test suite fails. Run `npx mocha` to see the failures, find the defect in the source and fix it '
      + 'so the whole suite passes. Do not modify the tests.',
    difficulty: 'easy', categories: ['bug_fix', 'single_file', 'test_interpretation'],
    mutate: (dir) => sub(dir, 'index.js', "num.trim() !== ''", "num !== ''"),
    solution: (dir) => sub(dir, 'index.js', "num !== ''", "num.trim() !== ''"),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'isnum-nan-guard',
    repository: 'is-number',
    description:
      'Running `npx mocha` shows failing assertions. Diagnose and fix the source so every test passes. '
      + 'Do not modify the tests.',
    difficulty: 'easy', categories: ['bug_fix', 'single_file', 'edge_case'],
    mutate: (dir) => sub(dir, 'index.js', 'return num - num === 0;', 'return true;'),
    solution: (dir) => sub(dir, 'index.js', 'return true;', 'return num - num === 0;'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'isnum-finite-inversion',
    repository: 'is-number',
    description:
      'A recent change broke numeric-string handling: `npx mocha` fails. Locate the root cause and repair it. '
      + 'The tests are correct and must not be edited.',
    difficulty: 'medium', categories: ['bug_fix', 'single_file', 'debugging'],
    mutate: (dir) => sub(dir, 'index.js',
      'return Number.isFinite ? Number.isFinite(+num) : isFinite(+num);',
      'return Number.isFinite ? !Number.isFinite(+num) : isFinite(+num);'),
    solution: (dir) => sub(dir, 'index.js',
      'return Number.isFinite ? !Number.isFinite(+num) : isFinite(+num);',
      'return Number.isFinite ? Number.isFinite(+num) : isFinite(+num);'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'isnum-hidden-contract',
    repository: 'is-number',
    description:
      'The exported function must return `true` only for values that represent finite numbers: finite '
      + 'numbers themselves, and non-empty strings (including whitespace-padded ones) that parse to a '
      + 'finite number. Everything else — NaN, Infinity, booleans, null, undefined, objects, arrays, '
      + 'empty or whitespace-only strings — must return `false`. The current implementation is wrong. '
      + 'Fix it. Run `npx mocha` to check your work.',
    difficulty: 'medium', categories: ['bug_fix', 'single_file', 'specification'],
    // Defect: accepts anything non-empty, including booleans and objects.
    mutate: (dir) => write(dir, 'index.js', `'use strict';

module.exports = function(num) {
  if (typeof num === 'number') {
    return true;
  }
  return Boolean(num);
};
`),
    solution: (dir) => write(dir, 'index.js', `'use strict';

module.exports = function(num) {
  if (typeof num === 'number') {
    return num - num === 0;
  }
  if (typeof num === 'string' && num.trim() !== '') {
    return Number.isFinite ? Number.isFinite(+num) : isFinite(+num);
  }
  return false;
};
`),
    // Composite: the repo suite AND a hidden test the agent never sees.
    verification: {
      method: 'composite',
      test_command: true,
      hidden_tests: [{
        path: '__hidden__/contract.test.cjs',
        source: `const assert = require('assert');
const isNumber = require('../index.js');
// Values that must be accepted
for (const v of [0, 1, -1, 0.5, 1e3, '0', '1.5', '  42  ', 0xff]) {
  assert.strictEqual(isNumber(v), true, 'should accept ' + JSON.stringify(v));
}
// Values that must be rejected — this is what a lazy Boolean() coercion gets wrong
for (const v of [NaN, Infinity, -Infinity, true, false, null, undefined, {}, [], '', '   ', 'abc', () => {}]) {
  assert.strictEqual(isNumber(v), false, 'should reject ' + String(v));
}
console.log('hidden contract ok');
`,
        run: 'node __hidden__/contract.test.cjs',
      }],
    },
  }),

  // ══════════════════════════════════════════════ camelcase (esm, ava)
  T({
    task_id: 'camel-separator-strip',
    repository: 'camelcase',
    description:
      'The test suite fails. Run `npx ava` to see which cases break, then fix the source. Do not edit tests.',
    difficulty: 'easy', categories: ['bug_fix', 'single_file', 'test_interpretation'],
    mutate: (dir) => sub(dir, 'index.js',
      "const SEPARATORS = /[_.\\- ]+/;", "const SEPARATORS = /[_.\\-]+/;"),
    solution: (dir) => sub(dir, 'index.js',
      "const SEPARATORS = /[_.\\-]+/;", "const SEPARATORS = /[_.\\- ]+/;"),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'camel-leading-capital',
    repository: 'camelcase',
    description:
      '`npx ava` reports failures around capitalisation handling. Find the defect and fix it. '
      + 'The tests express the intended behaviour and must not be changed.',
    difficulty: 'medium', categories: ['bug_fix', 'single_file', 'regex', 'debugging'],
    mutate: (dir) => sub(dir, 'index.js',
      'const LEADING_CAPITAL = /^[\\p{Lu}](?![\\p{Lu}])/u;',
      'const LEADING_CAPITAL = /^[\\p{Lu}]/u;'),
    solution: (dir) => sub(dir, 'index.js',
      'const LEADING_CAPITAL = /^[\\p{Lu}]/u;',
      'const LEADING_CAPITAL = /^[\\p{Lu}](?![\\p{Lu}])/u;'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'camel-preserve-consecutive',
    repository: 'camelcase',
    description:
      'The `preserveConsecutiveUppercase` option no longer behaves correctly and `npx ava` fails. '
      + 'Investigate how that option flows through the implementation and repair it. Do not edit tests.',
    difficulty: 'hard', categories: ['bug_fix', 'multi_read', 'option_handling', 'debugging'],
    mutate: (dir) => sub(dir, 'index.js',
      '&& (!isLastLastCharPreserved || preserveConsecutiveUppercase)',
      '&& (!isLastLastCharPreserved && preserveConsecutiveUppercase)'),
    solution: (dir) => sub(dir, 'index.js',
      '&& (!isLastLastCharPreserved && preserveConsecutiveUppercase)',
      '&& (!isLastLastCharPreserved || preserveConsecutiveUppercase)'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'camel-numbers-identifier',
    repository: 'camelcase',
    description:
      'Strings containing digits are no longer cased correctly; `npx ava` fails. Locate the cause and fix it. '
      + 'Tests are authoritative.',
    difficulty: 'hard', categories: ['bug_fix', 'regex', 'edge_case'],
    mutate: (dir) => sub(dir, 'index.js',
      'const NUMBERS_AND_IDENTIFIER = new RegExp(String.raw`\\d+` + IDENTIFIER.source, \'gu\');',
      'const NUMBERS_AND_IDENTIFIER = new RegExp(String.raw`\\d` + IDENTIFIER.source, \'gu\');'),
    solution: (dir) => sub(dir, 'index.js',
      'const NUMBERS_AND_IDENTIFIER = new RegExp(String.raw`\\d` + IDENTIFIER.source, \'gu\');',
      'const NUMBERS_AND_IDENTIFIER = new RegExp(String.raw`\\d+` + IDENTIFIER.source, \'gu\');'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'camel-leading-separators',
    repository: 'camelcase',
    description:
      'Input with leading separators (for example `--foo-bar`) is no longer handled correctly and '
      + '`npx ava` fails. Find the defect and fix it. Tests are authoritative.',
    difficulty: 'medium', categories: ['bug_fix', 'regex', 'edge_case'],
    mutate: (dir) => sub(dir, 'index.js',
      "const LEADING_SEPARATORS = new RegExp('^' + SEPARATORS.source);",
      'const LEADING_SEPARATORS = new RegExp(SEPARATORS.source);'),
    solution: (dir) => sub(dir, 'index.js',
      'const LEADING_SEPARATORS = new RegExp(SEPARATORS.source);',
      "const LEADING_SEPARATORS = new RegExp('^' + SEPARATORS.source);"),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'camel-unicode-uppercase',
    repository: 'camelcase',
    description:
      'Non-ASCII uppercase letters are no longer recognised, so `npx ava` fails on international input. '
      + 'Locate the cause and fix it without changing the tests.',
    difficulty: 'medium', categories: ['bug_fix', 'regex', 'unicode'],
    mutate: (dir) => sub(dir, 'index.js',
      'const UPPERCASE = /[\\p{Lu}]/u;', 'const UPPERCASE = /[A-Z]/u;'),
    solution: (dir) => sub(dir, 'index.js',
      'const UPPERCASE = /[A-Z]/u;', 'const UPPERCASE = /[\\p{Lu}]/u;'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'camel-identifier-endanchor',
    repository: 'camelcase',
    description:
      '`npx ava` fails on inputs where a separator or digit run reaches the end of the string. The '
      + 'identifier pattern is subtly wrong — there is an explanatory comment near it. Fix the source.',
    difficulty: 'hard', categories: ['bug_fix', 'regex', 'edge_case', 'debugging'],
    mutate: (dir) => sub(dir, 'index.js',
      'const IDENTIFIER = /([\\p{Alpha}\\p{N}_]|$)/u;',
      'const IDENTIFIER = /([\\p{Alpha}\\p{N}_])/u;'),
    solution: (dir) => sub(dir, 'index.js',
      'const IDENTIFIER = /([\\p{Alpha}\\p{N}_])/u;',
      'const IDENTIFIER = /([\\p{Alpha}\\p{N}_]|$)/u;'),
    verification: { method: 'test_command' },
  }),

  // ══════════════════════════════════════════════ ansi-styles (esm, ava)
  // NOTE: ansi-styles ships only 10 tests, so several plausible defects in its conversion
  // maths are NOT observable through its own suite. Three candidate tasks
  // (greyscale-threshold, rgb-quantisation, hex-shorthand) were written, failed
  // preflight-negative bracketing, and were removed rather than scored. See
  // research/eval-real/methodology.md.
  T({
    task_id: 'ansi-brightness-bit',
    repository: 'ansi-styles',
    description:
      '`npx ava` fails: bright colour variants are not produced correctly during ANSI-256 to ANSI-16 '
      + 'conversion. Read the conversion function, find the defect and fix it. Do not modify the tests.',
    difficulty: 'hard', categories: ['bug_fix', 'numeric', 'debugging'],
    mutate: (dir) => sub(dir, 'index.js', 'if (value === 2) {', 'if (value === 3) {'),
    solution: (dir) => sub(dir, 'index.js', 'if (value === 3) {', 'if (value === 2) {'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'ansi-16m-escape',
    repository: 'ansi-styles',
    description:
      'The 24-bit (truecolor) escape sequences are malformed and `npx ava` fails. Repair the sequence builder.',
    difficulty: 'medium', categories: ['bug_fix', 'string_processing'],
    mutate: (dir) => sub(dir, 'index.js',
      '`\\u{1B}[${38 + offset};2;${red};${green};${blue}m`',
      '`\\u{1B}[${38 + offset};5;${red};${green};${blue}m`'),
    solution: (dir) => sub(dir, 'index.js',
      '`\\u{1B}[${38 + offset};5;${red};${green};${blue}m`',
      '`\\u{1B}[${38 + offset};2;${red};${green};${blue}m`'),
    verification: { method: 'test_command' },
  }),

  // ══════════════════════════════════════════════ slugify (esm, ava, multi-file)
  T({
    task_id: 'slug-trailing-separator',
    repository: 'slugify',
    description:
      '`npx ava` fails: slugs keep a separator at the end that should have been stripped. Find the defect '
      + 'in the separator handling and fix it. Do not modify the tests.',
    difficulty: 'medium', categories: ['bug_fix', 'regex', 'string_processing'],
    mutate: (dir) => sub(dir, 'index.js',
      '`^(?:${escapedSeparator})|(?:${escapedSeparator})$`',
      '`^(?:${escapedSeparator})`'),
    solution: (dir) => sub(dir, 'index.js',
      '`^(?:${escapedSeparator})`',
      '`^(?:${escapedSeparator})|(?:${escapedSeparator})$`'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'slug-lowercase-option',
    repository: 'slugify',
    description:
      'The `lowercase` option behaves backwards and `npx ava` fails. Trace how the option builds the '
      + 'character pattern and repair it.',
    difficulty: 'hard', categories: ['bug_fix', 'option_handling', 'debugging'],
    mutate: (dir) => sub(dir, 'index.js',
      "negationSetPattern += options.lowercase ? '' : 'A-Z';",
      "negationSetPattern += options.lowercase ? 'A-Z' : '';"),
    solution: (dir) => sub(dir, 'index.js',
      "negationSetPattern += options.lowercase ? 'A-Z' : '';",
      "negationSetPattern += options.lowercase ? '' : 'A-Z';"),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'slug-decamelize-acronym',
    repository: 'slugify',
    description:
      'Camel-cased input and acronyms are split incorrectly, so `npx ava` fails. Read the decamelize logic '
      + 'carefully and fix it. The tests are authoritative.',
    difficulty: 'hard', categories: ['bug_fix', 'regex', 'debugging'],
    mutate: (dir) => sub(dir, 'index.js',
      ".replaceAll(/([A-Z]+)([A-Z][a-rt-z\\d]+)/g, '$1 $2')",
      ".replaceAll(/([A-Z]+)([A-Z][a-z\\d]+)/g, '$1 $2')"),
    solution: (dir) => sub(dir, 'index.js',
      ".replaceAll(/([A-Z]+)([A-Z][a-z\\d]+)/g, '$1 $2')",
      ".replaceAll(/([A-Z]+)([A-Z][a-rt-z\\d]+)/g, '$1 $2')"),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'slug-overridable-replacements',
    repository: 'slugify',
    description:
      'Some built-in character replacements no longer apply and `npx ava` fails. The replacement table lives '
      + 'in a different file from the main logic — find it and restore correct behaviour.',
    difficulty: 'medium', categories: ['bug_fix', 'multi_file', 'exploration'],
    mutate: (dir) => {
      const src = read(dir, 'overridable-replacements.js');
      // Drop the '&' -> ' and ' replacement, a behaviour the suite checks.
      const out = src.replace(/^\s*\[\s*'&'\s*,[^\]]*\],?\s*$/m, '');
      if (out === src) throw new Error('could not remove the & replacement');
      write(dir, 'overridable-replacements.js', out);
    },
    solution: (dir) => {
      const src = read(dir, 'overridable-replacements.js');
      const out = src.replace(/(const overridableReplacements = \[\n)/, "$1\t['&', ' and '],\n");
      if (out === src) throw new Error('could not restore the & replacement');
      write(dir, 'overridable-replacements.js', out);
    },
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'slug-preserve-conflict',
    repository: 'slugify',
    description:
      'Passing a preserved character that equals the separator should throw a clear error, but the guard is '
      + 'broken and `npx ava` fails. Restore it.',
    difficulty: 'medium', categories: ['bug_fix', 'error_handling', 'edge_case'],
    mutate: (dir) => sub(dir, 'index.js',
      'if (character === options.separator) {',
      'if (false && character === options.separator) {'),
    solution: (dir) => sub(dir, 'index.js',
      'if (false && character === options.separator) {',
      'if (character === options.separator) {'),
    verification: { method: 'test_command' },
  }),

  // ══════════════════════════════════════════════ p-limit (esm, ava, async)
  T({
    task_id: 'plimit-concurrency-guard',
    repository: 'p-limit',
    description:
      '`npx ava` fails: the concurrency limit is not being respected. Read the queue logic and fix the defect. '
      + 'Do not edit the tests.',
    difficulty: 'medium', categories: ['bug_fix', 'async', 'concurrency'],
    mutate: (dir) => sub(dir, 'index.js',
      'if (activeCount < concurrency && queue.size > 0) {',
      'if (activeCount <= concurrency && queue.size > 0) {'),
    solution: (dir) => sub(dir, 'index.js',
      'if (activeCount <= concurrency && queue.size > 0) {',
      'if (activeCount < concurrency && queue.size > 0) {'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'plimit-active-count',
    repository: 'p-limit',
    description:
      'The active-task counter is not maintained correctly, so queued work stalls or over-runs and `npx ava` '
      + 'fails. Find the root cause in the async control flow and fix it.',
    difficulty: 'hard', categories: ['bug_fix', 'async', 'concurrency', 'debugging'],
    mutate: (dir) => sub(dir, 'index.js', 'const next = () => {\n\t\tactiveCount--;', 'const next = () => {\n\t\tactiveCount -= 0;'),
    solution: (dir) => sub(dir, 'index.js', 'const next = () => {\n\t\tactiveCount -= 0;', 'const next = () => {\n\t\tactiveCount--;'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'plimit-validate-concurrency',
    repository: 'p-limit',
    description:
      'Invalid concurrency values are no longer rejected and `npx ava` fails. Restore the validation so '
      + 'bad input throws as the tests expect. Do not edit the tests.',
    difficulty: 'easy', categories: ['bug_fix', 'validation', 'error_handling'],
    mutate: (dir) => sub(dir, 'index.js',
      'validateConcurrency(concurrency);',
      'if (concurrency === -1) validateConcurrency(concurrency);'),
    solution: (dir) => sub(dir, 'index.js',
      'if (concurrency === -1) validateConcurrency(concurrency);',
      'validateConcurrency(concurrency);'),
    verification: { method: 'test_command' },
  }),

  T({
    task_id: 'plimit-error-propagation',
    repository: 'p-limit',
    description:
      'When a limited function rejects, the rejection must still reach the caller while the queue keeps '
      + 'draining. That behaviour is broken and `npx ava` fails. Diagnose the async flow and repair it.',
    difficulty: 'hard', categories: ['bug_fix', 'async', 'error_handling', 'debugging'],
    mutate: (dir) => sub(dir, 'index.js',
      '\t\tconst result = (async () => function_(...arguments_))();\n\n\t\t// Resolve immediately with the promise (don\'t wait for completion)\n\t\tresolve(result);',
      '\t\tconst result = (async () => function_(...arguments_))();\n\n\t\t// Resolve immediately with the promise (don\'t wait for completion)\n\t\tresolve(result.catch(() => undefined));'),
    solution: (dir) => sub(dir, 'index.js',
      'resolve(result.catch(() => undefined));', 'resolve(result);'),
    verification: { method: 'test_command' },
  }),

];

export const REAL_TASK_BY_ID = Object.fromEntries(REAL_TASKS.map(t => [t.task_id, t]));

export function selectRealTasks({ ids = null, difficulty = null, category = null, repository = null } = {}) {
  let out = REAL_TASKS;
  if (ids?.length) out = out.filter(t => ids.includes(t.task_id));
  if (difficulty) out = out.filter(t => t.difficulty === difficulty);
  if (category) out = out.filter(t => t.categories.includes(category));
  if (repository) out = out.filter(t => t.repository === repository);
  return out;
}
