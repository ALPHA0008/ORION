// ADR-002/003 — per-INVOCATION recovery.
// Experiment 2 refuted per-tool `idempotency`: bash("echo x >> f") duplicates on re-issue,
// bash("mkdir -p a/b") does not. Same tool, opposite safety. So the tool computes its
// recovery contract FROM ITS ARGUMENTS.

export const RecoveryClass = Object.freeze({
  READ_ONLY:            'READ_ONLY',            // no world effect
  SAFE_RETRY:           'SAFE_RETRY',           // f(f(x)) == f(x) for THESE args
  SELF_VERIFYING:       'SELF_VERIFYING',       // carries a precondition the effect invalidates
  EXTERNALLY_DEDUPED:   'EXTERNALLY_DEDUPED',   // remote honours dedup_key
  TRANSACTIONAL:        'TRANSACTIONAL',        // effect + marker commit atomically
  UNSAFE:               'UNSAFE',               // duplicates on re-issue
});

const AUTO_REISSUE = new Set([
  RecoveryClass.READ_ONLY, RecoveryClass.SAFE_RETRY,
  RecoveryClass.SELF_VERIFYING, RecoveryClass.TRANSACTIONAL,
]);

export const Decision = Object.freeze({ REISSUE: 'reissue', SKIP: 'skip', ESCALATE: 'escalate' });

/**
 * Decide what to do about an orphaned invocation: `tool.started` with no terminal event.
 * Never guesses. When the outcome is genuinely unknowable, escalates.
 *
 * @returns {{decision:string, reason:string, class:string, verified:string|null}}
 */
export function decideRecovery(recovery) {
  const rec = recovery ?? { class: RecoveryClass.UNSAFE };
  const cls = rec.class ?? RecoveryClass.UNSAFE;

  // A verify() probe is the strongest signal available — prefer it over the class.
  if (typeof rec.verify === 'function') {
    let v;
    try { v = rec.verify(); }
    catch (err) {
      return { decision: Decision.ESCALATE, class: cls, verified: 'error',
               reason: `verify() threw: ${err?.message ?? err}` };
    }
    if (v === 'applied')     return { decision: Decision.SKIP,     class: cls, verified: v, reason: 'verify(): effect already applied' };
    if (v === 'not-applied') return { decision: Decision.REISSUE,  class: cls, verified: v, reason: 'verify(): effect not applied' };
    // 'unknown' falls through to class-based reasoning
    // ADR-011: the class alone does NOT license a re-issue under uncertainty.
    //
    // `AUTO_REISSUE` membership was standing in for a safety proof it does not actually
    // establish. For `edit` a re-issue IS harmless: its precondition is consumed, so the replay
    // self-rejects and the world is untouched (measured, phase 4). For `write` the same decision
    // re-applies the effect and silently destroys whatever changed the file — a lost update,
    // reproduced with a real SIGKILL and on real repository bytes.
    //
    // So an operation may declare that an unknown outcome must not be retried. Nothing else
    // changes: no new recovery state, no new decision, no class renaming.
    if (rec.escalateOnUnknown)
      return { decision: Decision.ESCALATE, class: cls, verified: v,
               reason: `verify() unknown and re-issuing ${cls} could overwrite a concurrent change` };
    if (AUTO_REISSUE.has(cls))
      return { decision: Decision.REISSUE, class: cls, verified: v, reason: `verify() unknown, but ${cls} is safe to re-issue` };
    return { decision: Decision.ESCALATE, class: cls, verified: v, reason: `verify() unknown and ${cls} is not safe to re-issue` };
  }

  if (AUTO_REISSUE.has(cls))
    return { decision: Decision.REISSUE, class: cls, verified: null, reason: `${cls} is safe to re-issue` };

  if (cls === RecoveryClass.EXTERNALLY_DEDUPED) {
    return rec.dedup_key
      ? { decision: Decision.REISSUE, class: cls, verified: null, reason: 'remote dedups on key' }
      : { decision: Decision.ESCALATE, class: cls, verified: null, reason: 'EXTERNALLY_DEDUPED without a dedup_key' };
  }

  return { decision: Decision.ESCALATE, class: cls, verified: null,
           reason: 'UNSAFE with no verify() — cannot determine whether the effect landed' };
}

/**
 * Conservative shell classifier (V0). Deliberately NOT a static analyser — Phase E says
 * avoid building one. Anything not provably safe defaults to UNSAFE, i.e. escalate.
 */
const SHELL_SAFE = [
  /^\s*mkdir\s+-p\s+\S+\s*$/,
  /^\s*ls(\s+[^;&|><`$]*)?$/,
  /^\s*cat\s+[^;&|><`$]+$/,
  /^\s*pwd\s*$/,
  /^\s*true\s*$/,
  /^\s*echo\s+[^;&|><`$]*$/,
  /^\s*test\s+[^;&|><`$]+$/,
  /^\s*which\s+\S+\s*$/,
  /^\s*grep\s+[^;&|><`$]+$/,
  /^\s*wc\s+[^;&|><`$]+$/,
  /^\s*head\s+[^;&|><`$]+$/,
  /^\s*tail\s+[^;&|><`$]+$/,
  /^\s*stat\s+[^;&|><`$]+$/,
];
const SHELL_UNSAFE = [
  />>/, /\bgit\s+push\b/, /\bcurl\b[^|]*-X\s*(POST|PUT|DELETE|PATCH)/i,
  /\brm\s+-[rf]/, /\bnpm\s+publish\b/, /\bmail\b/, /\bsendmail\b/,
  /\bdocker\s+(run|rm|push)\b/, /\bkubectl\s+(apply|delete)\b/, /\bterraform\s+apply\b/,
];

export function classifyShell(cmd) {
  const c = String(cmd ?? '');
  if (SHELL_UNSAFE.some(re => re.test(c))) return RecoveryClass.UNSAFE;
  if (SHELL_SAFE.some(re => re.test(c)))   return RecoveryClass.SAFE_RETRY;
  return RecoveryClass.UNSAFE;   // default deny: escalate rather than guess
}
