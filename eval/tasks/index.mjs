// The task set.
//
// Every task has an objective verifier. Difficulty is a HYPOTHESIS recorded up front so it can
// be checked against measured success rates later (§7 of the brief: do not assume difficulty).

import { defineTask } from './schema.mjs';
import { FIXTURES, materialise, fixtureHash } from '../environments/fixtures.mjs';
import { HARD_TASKS } from './hard.mjs';

const F = FIXTURES;
const ALL_TOOLS = ['read', 'grep', 'write', 'edit', 'bash'];
const RO_TOOLS = ['read', 'grep'];

/** Materialise a fixture, optionally mutating it first. */
const setupFrom = (fixture, mutate) => (sandbox) => {
  const files = mutate ? mutate({ ...fixture }) : fixture;
  materialise(sandbox, files);
};

const CORE_TASKS = [

  // ══════════════════════════════════════════════════════ EASY (single file, obvious locus)
  defineTask({
    task_id: 'calc-add-bug',
    description: 'The test suite fails. Run `node test/math.test.mjs`, find the bug, fix it, and make the suite pass.',
    repository: 'calc-lib', base_commit: fixtureHash(F.CALC_LIB),
    difficulty: 'easy', categories: ['bug_fix'],
    setup: setupFrom(F.CALC_LIB), allowed_tools: ALL_TOOLS,
    timeout_ms: 180_000, max_turns: 20,
    expected_behavior: 'add() should return a + b; the whole suite passes.',
    verification: { method: 'test_command', command: 'node test/math.test.mjs' },
  }),

  defineTask({
    task_id: 'calc-add-bug-noshell',
    description: 'src/math.js has a bug in add(): it subtracts instead of adding. Fix it.',
    repository: 'calc-lib', base_commit: fixtureHash(F.CALC_LIB),
    difficulty: 'easy', categories: ['bug_fix'],
    // No bash: can the agent work purely from read/edit without running anything?
    setup: setupFrom(F.CALC_LIB), allowed_tools: ['read', 'grep', 'write', 'edit'],
    timeout_ms: 180_000, max_turns: 15,
    expected_behavior: 'add() returns a + b.',
    verification: { method: 'test_command', command: 'node test/math.test.mjs' },
  }),

  defineTask({
    task_id: 'explore-find-tax-rate',
    description: 'Somewhere in this repository a sales-tax rate constant is defined. Find it and report the exact file path and the current numeric value. Reply with the path and value in your final message.',
    repository: 'deep-tree', base_commit: fixtureHash(F.DEEP_TREE),
    difficulty: 'easy', categories: ['exploration'],
    setup: setupFrom(F.DEEP_TREE), allowed_tools: RO_TOOLS,
    timeout_ms: 180_000, max_turns: 20,
    expected_behavior: 'Reports src/billing/rates/legacy/taxRate.js and 0.0625.',
    verification: {
      method: 'cli_contract',
      // graded on the agent's final text, checked mechanically for both facts
      check: (ctx) => {
        const t = String(ctx.result ?? '');
        const hasPath = /taxRate\.js/.test(t);
        const hasVal = /0\.0625|6\.25\s*%/.test(t);
        return { pass: hasPath && hasVal,
                 detail: `path=${hasPath} value=${hasVal}` };
      },
    },
  }),

  defineTask({
    task_id: 'broken-import-path',
    description: 'Running `node test/greet.test.mjs` fails with a module resolution error. Diagnose and fix it.',
    repository: 'broken-deps', base_commit: fixtureHash(F.BROKEN_DEPS),
    difficulty: 'easy', categories: ['deps', 'bug_fix'],
    setup: setupFrom(F.BROKEN_DEPS), allowed_tools: ALL_TOOLS,
    timeout_ms: 180_000, max_turns: 20,
    expected_behavior: 'Import path corrected (or file renamed); suite passes.',
    verification: { method: 'test_command', command: 'node test/greet.test.mjs' },
  }),

  defineTask({
    task_id: 'cli-help-flag',
    description: 'Add a --help flag to src/cli.js. `node src/cli.js --help` must print usage text containing the word "sum" to stdout and exit with code 0. Do not break the existing `sum` command.',
    repository: 'cli-tool', base_commit: fixtureHash(F.CLI_TOOL),
    difficulty: 'easy', categories: ['feature', 'cli'],
    setup: setupFrom(F.CLI_TOOL), allowed_tools: ALL_TOOLS,
    timeout_ms: 180_000, max_turns: 20,
    expected_behavior: '--help exits 0 and mentions sum; sum still works.',
    verification: {
      method: 'cli_contract',
      check: (ctx) => {
        let help, sum;
        try { help = ctx.sandbox.exec('node src/cli.js --help'); } catch (e) { return { pass: false, detail: `--help failed: ${e.message.slice(0,80)}` }; }
        try { sum = ctx.sandbox.exec('node src/cli.js sum 1 2 3'); } catch (e) { return { pass: false, detail: `sum regressed: ${e.message.slice(0,80)}` }; }
        const okHelp = /sum/i.test(help);
        const okSum = String(sum).trim() === '6';
        return { pass: okHelp && okSum, detail: `help_mentions_sum=${okHelp} sum_still_6=${okSum}` };
      },
    },
  }),

  // ══════════════════════════════════════════════════════ MEDIUM (several files / real reasoning)
  defineTask({
    task_id: 'config-precedence',
    description: 'The config test suite fails: environment variables are supposed to override file config, but they do not. Run `node test/config.test.mjs`, find the cause, and fix it so the documented precedence (defaults < file < env) holds.',
    repository: 'config-app', base_commit: fixtureHash(F.CONFIG_APP),
    difficulty: 'medium', categories: ['bug_fix', 'multi_file'],
    setup: setupFrom(F.CONFIG_APP), allowed_tools: ALL_TOOLS,
    timeout_ms: 240_000, max_turns: 25,
    expected_behavior: 'Spread order corrected so env wins; all 5 assertions pass.',
    verification: { method: 'test_command', command: 'node test/config.test.mjs' },
  }),

  defineTask({
    task_id: 'implement-truncate',
    description: 'test/index.test.mjs imports a truncate() function that does not exist yet. Read SPEC.md for its exact contract, implement it in src/index.js, and make the suite pass.',
    repository: 'string-utils', base_commit: fixtureHash(F.STRING_UTILS),
    difficulty: 'medium', categories: ['feature', 'api'],
    setup: setupFrom(F.STRING_UTILS), allowed_tools: ALL_TOOLS,
    timeout_ms: 240_000, max_turns: 25,
    expected_behavior: 'truncate implemented per SPEC (result always exactly maxLength when truncating).',
    verification: { method: 'test_command', command: 'node test/index.test.mjs' },
  }),

  defineTask({
    task_id: 'deep-tree-tax-fix',
    description: 'The invoice test fails. `node test/invoice.test.mjs` expects 8.25% sales tax but the code applies an older rate. Locate the constant in this large repository and update it, then make the test pass.',
    repository: 'deep-tree', base_commit: fixtureHash(F.DEEP_TREE),
    difficulty: 'medium', categories: ['bug_fix', 'exploration'],
    setup: setupFrom(F.DEEP_TREE), allowed_tools: ALL_TOOLS,
    timeout_ms: 300_000, max_turns: 30,
    expected_behavior: 'TAX_RATE changed 0.0625 -> 0.0825 in the nested module; test passes.',
    verification: { method: 'test_command', command: 'node test/invoice.test.mjs' },
  }),

  defineTask({
    task_id: 'cli-max-command',
    description: 'Add a `max` subcommand to src/cli.js. `node src/cli.js max 4 9 2` must print 9 and exit 0. `node src/cli.js max` with no numbers must exit with a non-zero code. Do not break the existing `sum` command.',
    repository: 'cli-tool', base_commit: fixtureHash(F.CLI_TOOL),
    difficulty: 'medium', categories: ['feature', 'cli', 'edge_case'],
    setup: setupFrom(F.CLI_TOOL), allowed_tools: ALL_TOOLS,
    timeout_ms: 240_000, max_turns: 25,
    expected_behavior: 'max works, empty max errors, sum unaffected.',
    verification: {
      method: 'cli_contract',
      check: (ctx) => {
        let maxOut, sumOut, emptyFailed = false;
        try { maxOut = ctx.sandbox.exec('node src/cli.js max 4 9 2'); } catch (e) { return { pass: false, detail: `max failed: ${e.message.slice(0,70)}` }; }
        try { ctx.sandbox.exec('node src/cli.js max'); } catch { emptyFailed = true; }
        try { sumOut = ctx.sandbox.exec('node src/cli.js sum 1 2 3'); } catch (e) { return { pass: false, detail: `sum regressed: ${e.message.slice(0,70)}` }; }
        const okMax = String(maxOut).trim() === '9';
        const okSum = String(sumOut).trim() === '6';
        return { pass: okMax && emptyFailed && okSum,
                 detail: `max=9:${okMax} empty_errors:${emptyFailed} sum=6:${okSum}` };
      },
    },
  }),

  defineTask({
    task_id: 'multi-file-refactor',
    description: 'src/orders.js, src/quotes.js and src/invoices.js each contain an identical total-calculation loop. Extract that logic into a single shared module (src/total.js) and have all three import it. `node test/totals.test.mjs` must still pass, and none of the three files may still contain its own copy of the loop.',
    repository: 'refactor-dup', base_commit: fixtureHash(F.REFACTOR_DUP),
    difficulty: 'medium', categories: ['refactor', 'multi_file'],
    setup: setupFrom(F.REFACTOR_DUP), allowed_tools: ALL_TOOLS,
    timeout_ms: 300_000, max_turns: 30,
    expected_behavior: 'Shared module created, all three import it, behaviour preserved.',
    verification: {
      method: 'diff_invariant',
      check: (ctx) => {
        const sb = ctx.sandbox;
        let tests;
        try { tests = sb.exec('node test/totals.test.mjs'); } catch (e) { return { pass: false, detail: `tests fail: ${e.message.slice(0,70)}` }; }
        if (!/ALL PASS/.test(tests)) return { pass: false, detail: 'tests did not report ALL PASS' };
        const shared = ['src/total.js', 'src/totals.js', 'src/shared.js', 'src/util.js', 'src/utils.js']
          .find(p => sb.exists(p));
        if (!shared) return { pass: false, detail: 'no shared module created' };
        const stillDuplicated = ['src/orders.js', 'src/quotes.js', 'src/invoices.js']
          .filter(p => { try { return /for\s*\(const\s+i\s+of\s+items\)/.test(sb.read(p)); } catch { return false; } });
        return { pass: stillDuplicated.length === 0,
                 detail: `shared=${shared} still_duplicated=[${stillDuplicated.join(',')}]` };
      },
    },
  }),

  // ══════════════════════════════════════════════════════ HARD (judgement, not just location)
  defineTask({
    task_id: 'wrong-test-discrimination',
    description: 'Running `node test/list.test.mjs` fails. SPEC.md is the authoritative specification for this library. Investigate and make the suite pass WITHOUT violating SPEC.md.',
    repository: 'failing-suite', base_commit: fixtureHash(F.FAILING_SUITE),
    difficulty: 'hard', categories: ['test_fix', 'edge_case'],
    setup: setupFrom(F.FAILING_SUITE), allowed_tools: ALL_TOOLS,
    timeout_ms: 300_000, max_turns: 30,
    expected_behavior: 'Recognises the TEST is wrong (not flatten) and fixes the test expectation. Source flatten must remain fully recursive.',
    verification: {
      method: 'ast_property',
      // HIDDEN verifier: checks SPEC conformance, not the visible suite. An agent that
      // "fixes" flatten to satisfy the faulty test makes the suite green and still fails.
      check: async (ctx) => {
        const sb = ctx.sandbox;
        sb.write('__verify.mjs',
          `import { flatten, chunk } from './src/list.js';\n` +
          `const a = JSON.stringify(flatten([1,[2,[3,[4]]]]));\n` +
          `const b = JSON.stringify(chunk([1,2,3,4,5],2));\n` +
          `console.log(a === '[1,2,3,4]' && b === '[[1,2],[3,4],[5]]' ? 'SPEC_OK' : 'SPEC_VIOLATED ' + a + ' ' + b);\n`);
        let specOut = '';
        try { specOut = sb.exec('node __verify.mjs'); } catch (e) { return { pass: false, detail: `spec check crashed: ${e.message.slice(0,70)}` }; }
        const specOk = /SPEC_OK/.test(specOut);
        let suiteOk = false;
        try { suiteOk = /ALL PASS/.test(sb.exec('node test/list.test.mjs')); } catch { suiteOk = false; }
        return { pass: specOk && suiteOk,
                 detail: `spec_conformant=${specOk} suite_passes=${suiteOk} (${specOut.trim().slice(0,50)})` };
      },
    },
  }),

  defineTask({
    task_id: 'multi-bug-calc',
    description: 'src/math.js has MORE THAN ONE defect. Run `node test/math.test.mjs`, fix every failure, and make the entire suite pass. Do not change the tests.',
    repository: 'calc-lib', base_commit: 'mutated',
    difficulty: 'hard', categories: ['bug_fix', 'multi_file', 'edge_case'],
    setup: setupFrom(F.CALC_LIB, (files) => ({
      ...files,
      // two independent defects: add subtracts, multiply mishandles negatives
      'src/math.js': `export function add(a, b) {
  return a - b;
}

export function multiply(a, b) {
  let out = 0;
  for (let i = 0; i < b; i++) out += a;
  return out;
}

export function divide(a, b) {
  return a / b;
}
`,
      'test/math.test.mjs': `import { add, multiply, divide } from '../src/math.js';
let fails = 0;
const eq = (name, got, want) => {
  if (got !== want) { console.log(\`FAIL \${name}: got \${got} want \${want}\`); fails++; }
  else console.log(\`ok   \${name}\`);
};
eq('add(2,3)', add(2, 3), 5);
eq('multiply(3,4)', multiply(3, 4), 12);
eq('multiply(3,-2) NEGATIVE', multiply(3, -2), -6);
eq('divide(10,2)', divide(10, 2), 5);
if (fails) { console.log(\`\\n\${fails} FAILED\`); process.exit(1); }
console.log('\\nALL PASS');
`,
    })),
    allowed_tools: ALL_TOOLS, timeout_ms: 300_000, max_turns: 30,
    expected_behavior: 'Both add and multiply fixed; multiply handles negative multipliers.',
    verification: { method: 'test_command', command: 'node test/math.test.mjs' },
  }),

];

export const TASKS = [...CORE_TASKS, ...HARD_TASKS];

export const TASK_BY_ID = Object.fromEntries(TASKS.map(t => [t.task_id, t]));

export function selectTasks({ ids = null, difficulty = null, category = null } = {}) {
  let out = TASKS;
  if (ids?.length) out = out.filter(t => ids.includes(t.task_id));
  if (difficulty) out = out.filter(t => t.difficulty === difficulty);
  if (category) out = out.filter(t => t.categories.includes(category));
  return out;
}
