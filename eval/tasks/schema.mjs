// The evaluation task model.
//
// A task is only admissible if it has an OBJECTIVE success criterion. "The model produced
// plausible text" is not a criterion. The verifier must inspect repository state, run tests,
// or check a structural property — something that is true or false without a judge.

export const DIFFICULTY = Object.freeze(['easy', 'medium', 'hard']);

export const VERIFICATION = Object.freeze([
  'test_command',   // run a command; exit 0 == pass (strongest, preferred)
  'file_state',     // assert file contents / existence / absence
  'ast_property',   // assert a structural property of parsed source
  'cli_contract',   // run the produced CLI and match an output contract
  'diff_invariant', // assert a property of the repository diff
]);

export const OUTCOME = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  TIMEOUT: 'TIMEOUT',
  INFRA_FAILURE: 'INFRA_FAILURE',   // our fault, not the agent's — excluded from success rate
});

/**
 * @typedef {Object} Task
 * @property {string}   task_id
 * @property {string}   description        what the AGENT is told
 * @property {string}   repository         name of the fixture repo under eval/environments/
 * @property {string}   base_commit        fixture version id — fixtures are content-addressed
 * @property {string}   difficulty         easy | medium | hard  (a HYPOTHESIS, measured later)
 * @property {string[]} categories         bug_fix, feature, refactor, test_fix, config, deps,
 *                                         exploration, multi_file, cli, api, edge_case
 * @property {(sandbox)=>void} setup       materialise the repo into a fresh sandbox
 * @property {string[]} allowed_tools
 * @property {number}   timeout_ms
 * @property {number}   max_turns
 * @property {string}   expected_behavior  prose, for humans reading reports
 * @property {Object}   verification       { method, ...method-specific fields }
 */

/** Validate a task definition. Throws on anything that would make a result untrustworthy. */
export function validateTask(t) {
  const errs = [];
  const req = ['task_id', 'description', 'repository', 'base_commit', 'difficulty',
               'categories', 'setup', 'allowed_tools', 'timeout_ms', 'max_turns',
               'expected_behavior', 'verification'];
  for (const k of req) if (t[k] === undefined) errs.push(`missing ${k}`);
  if (t.difficulty && !DIFFICULTY.includes(t.difficulty)) errs.push(`bad difficulty: ${t.difficulty}`);
  if (t.verification && !VERIFICATION.includes(t.verification.method))
    errs.push(`bad verification.method: ${t.verification?.method}`);
  if (typeof t.setup !== 'function') errs.push('setup must be a function');
  if (!Array.isArray(t.allowed_tools) || !t.allowed_tools.length) errs.push('allowed_tools must be non-empty');
  if (!Array.isArray(t.categories) || !t.categories.length) errs.push('categories must be non-empty');

  // The rule that keeps the benchmark honest.
  if (t.verification?.method === 'test_command' && !t.verification.command)
    errs.push('test_command verification needs a command');
  if (t.verification?.method === 'file_state' && !Array.isArray(t.verification.assertions))
    errs.push('file_state verification needs assertions[]');

  if (errs.length) throw new Error(`invalid task ${t.task_id ?? '(unnamed)'}: ${errs.join('; ')}`);
  return t;
}

/** Convenience constructor so task files stay readable. */
export function defineTask(t) { return validateTask({ timeout_ms: 300_000, max_turns: 30, ...t }); }
