// Task bracketing (section 7).
//
// Every task must pass BOTH brackets or it is excluded from scoring:
//
//   preflight-negative : mutated repo, no fix        -> verify() must FAIL
//   oracle-positive    : mutated repo + solution()   -> verify() must PASS
//
// Why both matter:
//   - a task that passes WITHOUT a fix measures nothing (the defect never landed);
//   - a task that fails even WITH the known-good fix is either impossible or has a broken
//     verifier — scoring an agent against it would manufacture a fake capability gap.
//
// A task failing either bracket is excluded and reported as such. It is never silently counted
// as an agent failure. This is the same discipline that caught the `cold-cache-crash` verifier
// bug in the synthetic phase.

import { RealEnvironment, InfraFailure } from '../environments/index.mjs';
import { getRepo } from '../repositories/index.mjs';
import { verifyReal, snapshotTestFiles } from '../evaluators/index.mjs';
import { OUTCOME } from '../tasks/schema.mjs';

/**
 * Bracket ONE task.
 * @returns {{task_id, valid, preflight, oracle, excluded_reason}}
 */
export async function bracketTask(task, { root, keep = false } = {}) {
  const repo = getRepo(task.repository);
  const env = new RealEnvironment(repo, { root });
  const out = { task_id: task.task_id, repository: repo.id, valid: false,
                preflight: null, oracle: null, excluded_reason: null };

  // ── preflight-negative ────────────────────────────────────────────────
  try {
    const dir = env.provision(`bracket-neg-${task.task_id}`);
    task.mutate(dir);
    const guard = snapshotTestFiles(dir);
    const v = verifyReal(task, repo, { dir, testFileGuard: guard });
    out.preflight = { outcome: v.outcome, detail: v.detail };
    if (v.outcome === OUTCOME.INFRA_FAILURE) {
      out.excluded_reason = `preflight infra failure: ${v.detail}`;
      return out;
    }
    if (v.outcome === OUTCOME.PASS) {
      out.excluded_reason = 'preflight-negative FAILED: task verifies as PASS without any fix';
      return out;
    }
  } catch (e) {
    out.excluded_reason = e instanceof InfraFailure
      ? `infrastructure: ${e.message}` : `mutate() threw: ${String(e.message).slice(0, 300)}`;
    return out;
  } finally { if (!keep) env.destroy(); }

  // ── oracle-positive ───────────────────────────────────────────────────
  const env2 = new RealEnvironment(repo, { root });
  try {
    const dir = env2.provision(`bracket-pos-${task.task_id}`);
    task.mutate(dir);
    task.solution(dir);
    const guard = snapshotTestFiles(dir);
    const v = verifyReal(task, repo, { dir, testFileGuard: guard });
    out.oracle = { outcome: v.outcome, detail: v.detail, evidence: (v.evidence ?? '').slice(-500) };
    if (v.outcome !== OUTCOME.PASS) {
      out.excluded_reason = `oracle-positive FAILED (${v.outcome}): known-good solution does not verify — ${v.detail}`;
      return out;
    }
  } catch (e) {
    out.excluded_reason = e instanceof InfraFailure
      ? `infrastructure: ${e.message}` : `solution() threw: ${String(e.message).slice(0, 300)}`;
    return out;
  } finally { if (!keep) env2.destroy(); }

  out.valid = true;
  return out;
}
