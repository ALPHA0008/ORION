// Pinned real repositories.
//
// EVERY field here is pinned. A moving main branch is not a benchmark: if the code under test
// changes, a score from last week and a score from today measure different things.
//
// Selection criteria (see research/eval-real/repository-selection.md):
//   - public and MIT-licensed (legally usable for evaluation)
//   - small enough that `npm install` is reliable, not a source of INFRA_FAILURE
//   - a deterministic test runner that is NOT a linter
//   - real, meaningful source code an agent must actually read
//
// TEST RUNNER vs LINT: several of these declare `"test": "xo && ava"`. `xo` is a linter and
// would fail a task for unrelated style opinions, turning a correct fix into a FAIL. Every
// task therefore invokes the TEST runner directly (`npx ava`, `npx mocha`) and never `npm test`.
// This is a deliberate, documented deviation from the repo's own script.

export const REPOSITORIES = {
  'is-number': {
    id: 'is-number',
    url: 'https://github.com/jonschlinkert/is-number.git',
    commit: '98e8ff1da1a89f93d1397a24d7413ed15421c139',
    license: 'MIT',
    language: 'javascript',
    runtime: 'node',
    module_system: 'commonjs',
    install: 'npm install --no-audit --no-fund --loglevel=error',
    test_command: 'npx mocha',
    test_runner: 'mocha',
    // measured during selection, used to size timeouts
    install_seconds: 19,
    baseline_tests: 111,
    notes: 'Small CJS utility. Fast install, large assertion count, no linter in the test path.',
  },

  slugify: {
    id: 'slugify',
    url: 'https://github.com/sindresorhus/slugify.git',
    commit: '7c318bd1aa4b4affab29761f15a9604323fe2a3b',
    license: 'MIT',
    language: 'javascript',
    runtime: 'node',
    module_system: 'esm',
    install: 'npm install --no-audit --no-fund --loglevel=error',
    test_command: 'npx ava',
    test_runner: 'ava',
    install_seconds: 46,
    baseline_tests: 22,
    notes: 'ESM. Real string-processing logic with option handling and a separate counter module.',
  },

  'p-limit': {
    id: 'p-limit',
    url: 'https://github.com/sindresorhus/p-limit.git',
    commit: 'df476048d023ff868cd45b35ee47f5fb0ca2b25a',
    license: 'MIT',
    language: 'javascript',
    runtime: 'node',
    module_system: 'esm',
    install: 'npm install --no-audit --no-fund --loglevel=error',
    test_command: 'npx ava',
    test_runner: 'ava',
    install_seconds: 49,
    baseline_tests: 22,
    notes: 'Concurrency primitive. Async control flow — genuinely harder to reason about.',
  },

  'ansi-styles': {
    id: 'ansi-styles',
    url: 'https://github.com/chalk/ansi-styles.git',
    commit: 'c1c3dd4e017a2938807aaff0d361f46d086aeab7',
    license: 'MIT',
    language: 'javascript',
    runtime: 'node',
    module_system: 'esm',
    install: 'npm install --no-audit --no-fund --loglevel=error',
    test_command: 'npx ava',
    test_runner: 'ava',
    install_seconds: 51,
    baseline_tests: 10,
    notes: 'Colour conversion maths (rgb/hex/ansi256). Dense numeric code.',
  },

  camelcase: {
    id: 'camelcase',
    url: 'https://github.com/sindresorhus/camelcase.git',
    commit: '3146708d5ffcd91a8cbc483e4a2585a39545da48',
    license: 'MIT',
    language: 'javascript',
    runtime: 'node',
    module_system: 'esm',
    install: 'npm install --no-audit --no-fund --loglevel=error',
    test_command: 'npx ava',
    test_runner: 'ava',
    install_seconds: 42,
    baseline_tests: 20,
    notes: 'String casing with many edge cases (locale, preserveConsecutiveUppercase).',
  },
};

export const REPO_LIST = Object.values(REPOSITORIES);

export function getRepo(id) {
  const r = REPOSITORIES[id];
  if (!r) throw new Error(`unknown repository: ${id}`);
  return r;
}
