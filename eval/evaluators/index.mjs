// Verification. Deterministic wherever possible; no LLM judge anywhere in this file.
//
// The brief's rule: "If LLM-as-judge is used, it must not be the only evaluator for coding
// correctness." No judge is used at all — every verifier here inspects real state.

import { OUTCOME } from '../tasks/schema.mjs';

/**
 * @returns {{outcome:string, detail:string, evidence?:string}}
 */
export async function verify(task, ctx) {
  const v = task.verification;
  try {
    switch (v.method) {
      case 'test_command': {
        let out, failed = false;
        try { out = ctx.sandbox.exec(v.command); }
        catch (e) { failed = true; out = e.message; }
        const pass = !failed;
        return {
          outcome: pass ? OUTCOME.PASS : OUTCOME.FAIL,
          detail: pass ? `${v.command} exited 0` : `${v.command} failed`,
          evidence: String(out).slice(-600),
        };
      }

      case 'file_state': {
        const misses = [];
        for (const a of v.assertions) {
          const exists = ctx.sandbox.exists(a.path);
          if (a.absent) { if (exists) misses.push(`${a.path} should be absent`); continue; }
          if (!exists) { misses.push(`${a.path} missing`); continue; }
          const content = ctx.sandbox.read(a.path);
          if (a.contains && !content.includes(a.contains)) misses.push(`${a.path} lacks ${JSON.stringify(a.contains)}`);
          if (a.notContains && content.includes(a.notContains)) misses.push(`${a.path} still has ${JSON.stringify(a.notContains)}`);
          if (a.matches && !new RegExp(a.matches).test(content)) misses.push(`${a.path} !~ ${a.matches}`);
        }
        return { outcome: misses.length ? OUTCOME.FAIL : OUTCOME.PASS,
                 detail: misses.length ? misses.join('; ') : 'all file assertions held' };
      }

      case 'ast_property':
      case 'cli_contract':
      case 'diff_invariant': {
        const r = await v.check(ctx);
        return { outcome: r.pass ? OUTCOME.PASS : OUTCOME.FAIL, detail: r.detail ?? '' };
      }

      default:
        return { outcome: OUTCOME.INFRA_FAILURE, detail: `unknown verification method ${v.method}` };
    }
  } catch (e) {
    // A crash in OUR verifier is our fault, not the agent's.
    return { outcome: OUTCOME.INFRA_FAILURE, detail: `verifier threw: ${String(e.message).slice(0, 200)}` };
  }
}
