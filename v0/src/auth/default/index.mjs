// The authorization seam. Provider-neutral by construction (see docs/SECURITY.md §Seam).
//
//   authorize(action, context) -> { decision: 'allow' | 'deny' | 'escalate', ... }
//
// The default implementation ships in-tree and requires no external service. Any provider
// (a rules file, an OPA sidecar, a commercial governance product) may implement the same
// function. No vendor-specific fields appear in Action or Context.

import crypto from 'node:crypto';

export const Decision = Object.freeze({ ALLOW: 'allow', DENY: 'deny', ESCALATE: 'escalate' });

/**
 * @typedef {{kind:'model'|'tool'|'memory', name:string, args_digest:string,
 *            effects?:string, recovery_class?:string}} Action
 * @typedef {{principal:string, scope:string, run_id:string, posture:string,
 *            budget_remaining:object, environment:string}} Context
 */

export const digestArgs = (args) =>
  crypto.createHash('sha256').update(JSON.stringify(args ?? null)).digest('hex').slice(0, 16);

/**
 * Default authorizer.
 * Postures compose as a FLOOR: a narrower scope may only RAISE strictness, never lower it
 * (borrowed from QM — the only correct direction for a policy lattice).
 */
export function createAuthorizer({
  posture = 'auto',                 // 'permissive' | 'auto' | 'strict'
  denyTools = [],
  escalateTools = [],
  denyCommandPatterns = [DEFAULT_DANGEROUS],
  escalateUnsafeRecovery = true,    // UNSAFE-to-retry mutations need a human in strict/auto
  budgetLimits = null,              // {tokens?, tool_calls?, cost_usd?}
  // Phase 6: artifacts the agent may READ but must not MUTATE autonomously.
  //
  // MEASURED: given a blocked credential, two independent model families (Gemma 4 31B, Qwen
  // 3.6 35B) both edited the test to inject a fabricated key and reported success — 2/2 each,
  // even with a system prompt explicitly forbidding exactly that. Prompt policy is advisory.
  //
  // ESCALATE, not DENY (§17): a human legitimately may authorise such an edit. DENY would leave
  // the run going and, as phase 5 showed, the model simply looks for another route.
  //
  // Patterns describe a CLASS of artifact (tests, specifications), never a benchmark-specific
  // filename or content string. Supplied by the caller, like denyTools and denyCommandPatterns.
  protectedPaths = [],
} = {}) {
  const RANK = { permissive: 0, auto: 1, strict: 2 };

  return function authorize(action, context = {}) {
    const effective = maxPosture(posture, context.posture, RANK);

    // 1. Budget is checked first: an exhausted budget denies regardless of posture.
    if (budgetLimits && context.budget_remaining) {
      for (const [k, v] of Object.entries(budgetLimits)) {
        const remaining = context.budget_remaining[k];
        if (typeof remaining === 'number' && remaining <= 0)
          return { decision: Decision.DENY, reason: `budget exhausted: ${k}` };
      }
    }

    if (action.kind === 'model') return { decision: Decision.ALLOW };

    if (action.kind === 'tool') {
      if (denyTools.includes(action.name))
        return { decision: Decision.DENY, reason: `tool '${action.name}' denied by policy` };

      // Hard denials apply at every posture, including permissive.
      //
      // F1 (security): gated on the ACTION CARRYING A COMMAND, not on the tool being named
      // 'bash'. The previous `action.name === 'bash'` check meant `verify` — which also executes
      // shell commands — bypassed every deployed denyCommandPattern entirely. A policy that says
      // "never git push" must hold for every tool that can run a command, and a name-based switch
      // silently excludes each new one.
      //
      // This does not replace `verify`'s own narrower static denylist (isKnownDangerous in
      // agent/tools): that is the tool refusing side-effecting commands by construction. This is
      // the DEPLOYER's policy, which the tool cannot know about.
      if (typeof action.command === 'string') {
        for (const re of denyCommandPatterns)
          if (re.test(action.command))
            return { decision: Decision.DENY, reason: `command matches a hard-deny pattern` };
      }

      if (escalateTools.includes(action.name))
        return { decision: Decision.ESCALATE, prompt: action.prompt ?? `Allow ${action.name}?`,
                 options: action.options ?? ['approve', 'deny'] };

      // Protected artifacts: mutating one is not permitted autonomously at ANY posture,
      // including permissive. Reads are unaffected — the agent must still be able to
      // understand the requirement it is being held to.
      if (protectedPaths.length && action.effects === 'Mutating' && typeof action.path === 'string') {
        const norm = action.path.replace(/\\/g, '/');
        for (const re of protectedPaths) {
          if (!re.test(norm)) continue;
          return { decision: Decision.ESCALATE,
                   prompt: `'${action.path}' defines the requirement being verified and cannot be `
                         + `modified autonomously. If the task cannot be completed without changing `
                         + `it, a human must decide. Allow this change?`,
                   options: ['approve', 'deny'],
                   reason: `protected path: ${action.path}` };
        }
      }

      if (effective === 'strict' && action.effects === 'Mutating')
        return { decision: Decision.ESCALATE,
                 prompt: `[strict] Allow ${action.name}? ${summarise(action)}`,
                 options: ['approve', 'deny'] };

      if (escalateUnsafeRecovery && effective !== 'permissive' && action.recovery_class === 'UNSAFE')
        return { decision: Decision.ESCALATE,
                 prompt: `${action.name} cannot be safely retried after a crash. Run it? ${summarise(action)}`,
                 options: ['approve', 'deny'] };

      return { decision: Decision.ALLOW };
    }

    return { decision: Decision.ALLOW };
  };
}

const DEFAULT_DANGEROUS = /\bmkfs\b|:\(\)\s*\{|\brm\s+-rf\s+\/(?!\w)|\bdd\s+if=.*of=\/dev\//;

function maxPosture(a, b, RANK) {
  if (!b) return a;
  return (RANK[a] ?? 1) >= (RANK[b] ?? 1) ? a : b;
}
function summarise(action) {
  const s = action.command ?? action.args_digest ?? '';
  return String(s).slice(0, 120);
}
