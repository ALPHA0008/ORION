// Fixture repositories.
//
// Each fixture is a plain object of path -> content, materialised fresh into an isolated
// workspace for every run. Content-addressed: `base_commit` is a hash of the file map, so a
// result is always attributable to an exact repository state.
//
// WHY NOT REAL REPOS (yet): real historical tasks (SWE-bench style) need network, package
// installs and language toolchains that are not available or deterministic in this environment.
// These fixtures are hand-built to exercise the SAME capabilities — repository exploration,
// multi-file edits, dependency reasoning, test-driven debugging — with deterministic verifiers
// that run on Node alone. `benchmark-methodology.md` states this limitation plainly.

import crypto from 'node:crypto';

export function fixtureHash(files) {
  const h = crypto.createHash('sha256');
  for (const k of Object.keys(files).sort()) h.update(k).update('\0').update(files[k]).update('\0');
  return h.digest('hex').slice(0, 12);
}

export function materialise(sandbox, files) {
  for (const [p, content] of Object.entries(files)) sandbox.write(p, content);
}

// ─────────────────────────────────────────────────────────── calc-lib
// Small library with tests. Exercises: single-file fix, test interpretation.
export const CALC_LIB = {
  'package.json': JSON.stringify({ name: 'calc-lib', type: 'module', version: '1.0.0' }, null, 2) + '\n',
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
eq('add(-1,1)', add(-1, 1), 0);
eq('multiply(3,4)', multiply(3, 4), 12);
eq('divide(10,2)', divide(10, 2), 5);
if (fails) { console.log(\`\\n\${fails} FAILED\`); process.exit(1); }
console.log('\\nALL PASS');
`,
  'README.md': '# calc-lib\n\nA tiny maths library.\n\nRun tests: `node test/math.test.mjs`\n',
};

// ─────────────────────────────────────────────────────── config-app
// Config precedence bug across several files. Exercises: multi-file, tracing behaviour.
export const CONFIG_APP = {
  'package.json': JSON.stringify({ name: 'config-app', type: 'module' }, null, 2) + '\n',
  'src/defaults.js': `export const DEFAULTS = {
  host: 'localhost',
  port: 8080,
  debug: false,
  retries: 3,
};
`,
  'src/loadConfig.js': `import { DEFAULTS } from './defaults.js';

// Precedence should be: defaults < file < env  (env wins).
export function loadConfig({ fileConfig = {}, env = {} } = {}) {
  const fromEnv = {};
  if (env.APP_HOST !== undefined) fromEnv.host = env.APP_HOST;
  if (env.APP_PORT !== undefined) fromEnv.port = Number(env.APP_PORT);
  if (env.APP_DEBUG !== undefined) fromEnv.debug = env.APP_DEBUG === 'true';

  return { ...DEFAULTS, ...fromEnv, ...fileConfig };
}
`,
  'test/config.test.mjs': `import { loadConfig } from '../src/loadConfig.js';
let fails = 0;
const eq = (name, got, want) => {
  if (got !== want) { console.log(\`FAIL \${name}: got \${JSON.stringify(got)} want \${JSON.stringify(want)}\`); fails++; }
  else console.log(\`ok   \${name}\`);
};
eq('defaults apply', loadConfig().port, 8080);
eq('file overrides defaults', loadConfig({ fileConfig: { port: 9090 } }).port, 9090);
eq('ENV BEATS FILE', loadConfig({ fileConfig: { port: 9090 }, env: { APP_PORT: '7070' } }).port, 7070);
eq('env beats defaults', loadConfig({ env: { APP_HOST: 'example.com' } }).host, 'example.com');
eq('untouched key survives', loadConfig({ env: { APP_PORT: '1' } }).retries, 3);
if (fails) { console.log(\`\\n\${fails} FAILED\`); process.exit(1); }
console.log('\\nALL PASS');
`,
  'README.md': '# config-app\n\nConfiguration precedence: defaults < file < environment.\n',
};

// ────────────────────────────────────────────────────── string-utils
// Feature addition against a spec expressed as tests. Exercises: writing new code to a contract.
export const STRING_UTILS = {
  'package.json': JSON.stringify({ name: 'string-utils', type: 'module' }, null, 2) + '\n',
  'src/index.js': `export function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
`,
  'test/index.test.mjs': `import { slugify, truncate } from '../src/index.js';
let fails = 0;
const eq = (name, got, want) => {
  if (got !== want) { console.log(\`FAIL \${name}: got \${JSON.stringify(got)} want \${JSON.stringify(want)}\`); fails++; }
  else console.log(\`ok   \${name}\`);
};
eq('slugify basic', slugify('Hello World'), 'hello-world');
eq('truncate short string unchanged', truncate('hi', 10), 'hi');
eq('truncate exact length unchanged', truncate('abcde', 5), 'abcde');
eq('truncate adds ellipsis', truncate('abcdefghij', 5), 'abcd…');
eq('truncate handles empty', truncate('', 5), '');
if (fails) { console.log(\`\\n\${fails} FAILED\`); process.exit(1); }
console.log('\\nALL PASS');
`,
  'SPEC.md': `# string-utils

## slugify(s)
Lowercase, non-alphanumerics to single hyphens, trim hyphens from both ends.

## truncate(s, maxLength)
Return \`s\` unchanged when \`s.length <= maxLength\`.
Otherwise return the first \`maxLength - 1\` characters followed by the single character \`…\`
(U+2026), so the result is always exactly \`maxLength\` characters.
`,
};

// ─────────────────────────────────────────────────────────── deep-tree
// A wide/deep repository where the target is NOT obvious. Exercises: search, exploration.
export const DEEP_TREE = (() => {
  const files = {
    'package.json': JSON.stringify({ name: 'deep-tree', type: 'module' }, null, 2) + '\n',
    'README.md': '# deep-tree\n\nA service with a deliberately non-obvious layout.\n',
  };
  // noise: many plausible-looking modules
  const areas = ['auth', 'billing', 'notify', 'report', 'search', 'sync', 'user', 'admin'];
  for (const a of areas) {
    for (let i = 0; i < 4; i++) {
      files[`src/${a}/${a}${i}.js`] =
        `// ${a} module ${i}\nexport function ${a}${i}(x) {\n  return x;\n}\n`;
    }
  }
  // the needle: one module with a wrong constant, three levels deep
  files['src/billing/rates/legacy/taxRate.js'] =
    `// Sales tax applied to every invoice line.\n` +
    `// NOTE: the statutory rate changed to 8.25% but this was never updated.\n` +
    `export const TAX_RATE = 0.0625;\n`;
  files['src/billing/invoice.js'] =
    `import { TAX_RATE } from './rates/legacy/taxRate.js';\n\n` +
    `export function lineTotal(amount) {\n  return Number((amount * (1 + TAX_RATE)).toFixed(4));\n}\n`;
  files['test/invoice.test.mjs'] =
    `import { lineTotal } from '../src/billing/invoice.js';\n` +
    `let fails = 0;\n` +
    `const eq = (n, got, want) => { if (got !== want) { console.log(\`FAIL \${n}: got \${got} want \${want}\`); fails++; } else console.log(\`ok   \${n}\`); };\n` +
    `eq('lineTotal(100) uses 8.25% tax', lineTotal(100), 108.25);\n` +
    `eq('lineTotal(0)', lineTotal(0), 0);\n` +
    `if (fails) { console.log(\`\\n\${fails} FAILED\`); process.exit(1); }\n` +
    `console.log('\\nALL PASS');\n`;
  return files;
})();

// ──────────────────────────────────────────────────────────── cli-tool
// A CLI whose observable contract is the evaluator. Exercises: CLI behaviour, argv handling.
export const CLI_TOOL = {
  'package.json': JSON.stringify({ name: 'cli-tool', type: 'module' }, null, 2) + '\n',
  'src/cli.js': `#!/usr/bin/env node
const args = process.argv.slice(2);

if (args[0] === 'sum') {
  const nums = args.slice(1).map(Number);
  console.log(nums.reduce((a, b) => a + b, 0));
  process.exit(0);
}

console.error('unknown command');
process.exit(1);
`,
  'README.md': `# cli-tool

    node src/cli.js sum 1 2 3      -> 6

Planned:

    node src/cli.js max 4 9 2      -> 9
    node src/cli.js --help         -> usage text on stdout, exit 0
`,
};

// ─────────────────────────────────────────────────────── broken-deps
// An import that does not resolve. Exercises: dependency/module-resolution reasoning.
export const BROKEN_DEPS = {
  'package.json': JSON.stringify({ name: 'broken-deps', type: 'module' }, null, 2) + '\n',
  'src/greet.js': `import { formatName } from './helpers/format.js';

export function greet(first, last) {
  return \`Hello, \${formatName(first, last)}!\`;
}
`,
  'src/helpers/formatting.js': `export function formatName(first, last) {
  return \`\${String(first).trim()} \${String(last).trim()}\`.trim();
}
`,
  'test/greet.test.mjs': `import { greet } from '../src/greet.js';
let fails = 0;
const eq = (n, got, want) => { if (got !== want) { console.log(\`FAIL \${n}: got \${got} want \${want}\`); fails++; } else console.log(\`ok   \${n}\`); };
eq('greet', greet('Ada', 'Lovelace'), 'Hello, Ada Lovelace!');
eq('greet trims', greet('  Alan ', ' Turing '), 'Hello, Alan Turing!');
if (fails) { console.log(\`\\n\${fails} FAILED\`); process.exit(1); }
console.log('\\nALL PASS');
`,
};

// ──────────────────────────────────────────────────── refactor-dup
// Duplicated logic across modules. Exercises: multi-file refactor preserving behaviour.
export const REFACTOR_DUP = {
  'package.json': JSON.stringify({ name: 'refactor-dup', type: 'module' }, null, 2) + '\n',
  'src/orders.js': `export function orderTotal(items) {
  let t = 0;
  for (const i of items) t += i.price * i.qty;
  return Math.round(t * 100) / 100;
}
`,
  'src/quotes.js': `export function quoteTotal(items) {
  let t = 0;
  for (const i of items) t += i.price * i.qty;
  return Math.round(t * 100) / 100;
}
`,
  'src/invoices.js': `export function invoiceTotal(items) {
  let t = 0;
  for (const i of items) t += i.price * i.qty;
  return Math.round(t * 100) / 100;
}
`,
  'test/totals.test.mjs': `import { orderTotal } from '../src/orders.js';
import { quoteTotal } from '../src/quotes.js';
import { invoiceTotal } from '../src/invoices.js';
let fails = 0;
const eq = (n, got, want) => { if (got !== want) { console.log(\`FAIL \${n}: got \${got} want \${want}\`); fails++; } else console.log(\`ok   \${n}\`); };
const items = [{ price: 1.005, qty: 2 }, { price: 3.33, qty: 3 }];
eq('orderTotal', orderTotal(items), 12.0);
eq('quoteTotal', quoteTotal(items), 12.0);
eq('invoiceTotal', invoiceTotal(items), 12.0);
if (fails) { console.log(\`\\n\${fails} FAILED\`); process.exit(1); }
console.log('\\nALL PASS');
`,
};

// ─────────────────────────────────────────────────── failing-suite
// A suite where the TEST is wrong, not the source. SPEC.md is authoritative.
// Exercises: test interpretation, and resisting the urge to "fix" correct code.
//
// Scored by a HIDDEN verifier that checks SPEC conformance. An agent that edits the source to
// satisfy the faulty test will turn the visible suite green and still FAIL the task — which is
// exactly the discrimination we want to measure.
const FS_TEST = [
  `import { chunk, flatten } from '../src/list.js';`,
  `let fails = 0;`,
  `const eq = (n, got, want) => {`,
  `  const g = JSON.stringify(got), w = JSON.stringify(want);`,
  '  if (g !== w) { console.log(`FAIL ${n}: got ${g} want ${w}`); fails++; } else console.log(`ok   ${n}`);',
  `};`,
  `eq('chunk', chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);`,
  `// This expectation CONTRADICTS SPEC.md: flatten is specified as fully recursive,`,
  `// but this asserts a single-level flatten. The TEST is the bug, not the source.`,
  `eq('flatten', flatten([1, [2, [3, [4]]]]), [1, 2, [3, [4]]]);`,
  'if (fails) { console.log(`${fails} FAILED`); process.exit(1); }',
  `console.log('ALL PASS');`,
].join('\n') + '\n';

export const FAILING_SUITE = {
  'package.json': JSON.stringify({ name: 'failing-suite', type: 'module' }, null, 2) + '\n',
  'SPEC.md': [
    '# list utils — authoritative specification',
    '',
    '## flatten(xs)',
    'Flattens **completely**, to any depth.',
    '`flatten([1, [2, [3, [4]]]])` -> `[1, 2, 3, 4]`',
    '',
    '## chunk(xs, n)',
    'Splits into consecutive groups of at most `n`. The final group may be shorter.',
    '`chunk([1,2,3,4,5], 2)` -> `[[1,2],[3,4],[5]]`',
    '',
    'If a test disagrees with this document, the document wins.',
  ].join('\n') + '\n',
  'src/list.js': [
    `export function chunk(xs, n) {`,
    `  if (n <= 0) throw new RangeError('chunk size must be positive');`,
    `  const out = [];`,
    `  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));`,
    `  return out;`,
    `}`,
    ``,
    `export function flatten(xs) {`,
    `  return xs.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);`,
    `}`,
  ].join('\n') + '\n',
  'test/list.test.mjs': FS_TEST,
  'README.md': '# failing-suite\n\n`node test/list.test.mjs` should pass, and SPEC.md is authoritative.\n',
};

export const FIXTURES = {
  CALC_LIB, CONFIG_APP, STRING_UTILS, DEEP_TREE, CLI_TOOL,
  BROKEN_DEPS, REFACTOR_DUP, FAILING_SUITE,
};
