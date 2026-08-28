// Real-repository task schema.
//
// Extends the synthetic task model rather than inventing a second evaluation philosophy.
// The additions are what real repositories force on us:
//
//   repository   — id into repositories/index.mjs (pins url + commit + install + test command)
//   mutate       — how the defect is introduced into the pinned checkout
//   solution     — a KNOWN-GOOD patch, used ONLY for oracle bracketing, never shown to the agent
//
// BRACKETING (mandatory, section 7 of the brief). Every task must satisfy:
//   preflight-negative : on the mutated-but-unfixed repo, verify() must FAIL
//   oracle-positive    : after applying `solution`, verify() must PASS
// A task failing either bracket is EXCLUDED from scoring, never counted as an agent failure.
// Without both, a "failure" might mean the task is impossible or the verifier is broken.
//
// WHY MUTATION RATHER THAN HISTORICAL COMMITS
// SWE-bench-style tasks reconstruct a real bug from a repo's own history. That needs each
// project's issue/PR linkage and per-commit environment resolution, which is not reliably
// reproducible here. Instead, defects are injected into a PINNED real commit of a REAL
// repository, and verified by that repository's OWN test suite. The agent must therefore read
// and reason about genuine third-party source. This is honestly weaker than historical tasks
// and is recorded as such in research/eval-real/methodology.md.

export const OUTCOME = Object.freeze({
  PASS: 'PASS', FAIL: 'FAIL', TIMEOUT: 'TIMEOUT', INFRA_FAILURE: 'INFRA_FAILURE',
});

export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

export const VERIFICATION_METHODS = Object.freeze([
  'test_command',      // the repository's own suite must pass
  'file_state',        // assertions about file contents
  'repo_invariant',    // structural property of the working tree
  'hidden_test',       // a test written by US, injected only at verification time
  'composite',         // several of the above, all must hold
]);

export function validateRealTask(t) {
  const req = ['task_id', 'repository', 'description', 'difficulty', 'categories', 'verification'];
  for (const f of req) if (t[f] == null) throw new Error(`task ${t.task_id ?? '?'}: missing ${f}`);
  if (!DIFFICULTIES.includes(t.difficulty))
    throw new Error(`task ${t.task_id}: bad difficulty ${t.difficulty}`);
  if (!VERIFICATION_METHODS.includes(t.verification.method))
    throw new Error(`task ${t.task_id}: bad verification method ${t.verification.method}`);
  if (typeof t.mutate !== 'function')
    throw new Error(`task ${t.task_id}: mutate() is required (introduces the defect)`);
  if (typeof t.solution !== 'function')
    throw new Error(`task ${t.task_id}: solution() is required for oracle bracketing`);
  if (!Array.isArray(t.categories) || t.categories.length === 0)
    throw new Error(`task ${t.task_id}: categories must be a non-empty array`);
  return t;
}

export function defineRealTask(t) {
  return validateRealTask({
    timeout_ms: 600_000,
    max_turns: 40,
    allowed_tools: ['read', 'grep', 'write', 'edit', 'bash'],
    ...t,
  });
}
