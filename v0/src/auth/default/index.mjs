// The authorization seam. Provider-neutral by construction (see docs/SECURITY.md §Seam).
//
//   authorize(action, context) -> { decision: 'allow' | 'deny' | 'escalate', ... }
//
// The default implementation ships in-tree and requires no external service. Any provider
// (a rules file, an OPA sidecar, a commercial governance product) may implement the same
// function. No vendor-specific fields appear in Action or Context.

import crypto from 'node:crypto';
// W6 M: remembered approvals. The fold lives in core/projection, like every other derived view.
import { findGrant } from '../../core/projection/grant.mjs';

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
  /**
   * W6 M/K — approval memory.
   *
   * A function returning the grant events in scope, or null for "no memory" (the pre-W6
   * behaviour, which every existing caller keeps by default). It is a function rather than an
   * array because grants are read at DECISION time: an approval given three turns ago must be
   * visible to the check happening now, and a snapshot taken at construction would not be.
   *
   * A grant can only ever turn an ESCALATE into an ALLOW. It cannot touch a DENY, and it is
   * consulted AFTER every hard denial has already been evaluated — see the ordering below. That
   * ordering is the entire safety argument: remembered approvals make autonomy usable, and they
   * must not become a way to remember your way past a hard denial.
   */
  grants = null,
} = {}) {
  const RANK = { permissive: 0, auto: 1, strict: 2 };

  /**
   * Would a remembered approval cover this escalation?
   * Returns an ALLOW carrying its provenance, or null.
   */
  const grantedAllow = (action, context) => {
    if (typeof grants !== 'function') return null;
    let events;
    try { events = grants(action, context); } catch { return null; }
    if (!events?.length) return null;
    const g = findGrant(events, action, {
      run_id: context.run_id,
      project: context.project,
      resource_id: context.resource_id,
    });
    if (!g) return null;
    return {
      decision: Decision.ALLOW,
      reason: `covered by a remembered approval (${g.scope})`,
      // Provenance travels with the decision so the trajectory can answer "who allowed this?"
      // without re-deriving it. Invariant 6.
      grant_id: g.grant_id,
      granted_by: g.decided_by,
      grant_scope: g.scope,
    };
  };

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
        return grantedAllow(action, context)
            ?? { decision: Decision.ESCALATE, prompt: action.prompt ?? `Allow ${action.name}?`,
                 options: action.options ?? ['approve', 'deny'] };

      // Protected artifacts: mutating one is not permitted autonomously at ANY posture,
      // including permissive. Reads are unaffected — the agent must still be able to
      // understand the requirement it is being held to.
      //
      // W6 M: this escalation is deliberately NOT grant-overridable, and the asymmetry is the
      // point. It exists because of a measured behaviour — given a blocked credential, two
      // independent model families edited the test to fabricate a key and reported success, 2/2
      // each, against a prompt forbidding exactly that. A project-scoped grant covering "edit
      // the spec" would switch that protection off permanently, for every future run in the
      // directory, from a single approval. So a human may still approve any individual such
      // edit, and no remembered approval can pre-approve the class.
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
        return grantedAllow(action, context)
            ?? { decision: Decision.ESCALATE,
                 prompt: `[strict] Allow ${action.name}? ${summarise(action)}`,
                 options: ['approve', 'deny'] };

      // THE escalation users actually meet: `classifyShell` is default-deny, so every ordinary
      // `npm test` lands here. W6 gives it two honest ways out — an isolated backend (G makes
      // `effective` permissive) or a remembered approval (M) — instead of the dishonest one,
      // which was turning the policy down.
      if (escalateUnsafeRecovery && effective !== 'permissive' && action.recovery_class === 'UNSAFE')
        return grantedAllow(action, context)
            ?? { decision: Decision.ESCALATE,
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
