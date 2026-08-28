// Failure attribution.
//
// The brief's starting taxonomy, used as-is. Categories are NOT expanded speculatively — a new
// one is added only after reading real trajectories and finding repeated evidence that an
// existing label is wrong. Anything that does not clearly match becomes `unclassified`, and a
// growing `unclassified` count is a signal to go read trajectories, not to invent labels.

export const FAILURE_CLASSES = Object.freeze([
  'environment_failure',    // INFRA: repo/deps/toolchain — excluded from the capability score
  'runtime_failure',        // the harness itself threw or lost its lease
  'model_failure',          // provider unavailable / repeatedly failing
  'authorization_blocked',  // a required action was denied
  'no_progress',            // ADR-006 detector fired
  'timeout',                // wall-clock exceeded
  'budget_exhausted',       // token/tool/cost budget hit
  'tool_usage_failure',     // high tool-failure density; the agent could not drive its tools
  'gave_up_early',          // finished cleanly, few turns, but the world is still broken
  'no_edits_made',          // claimed completion without touching a single file
  'incorrect_solution',     // real attempt, real edits, still wrong
  'unclassified',
]);

/**
 * Classify one failed run. Order matters: the most specific, most defensible signal wins.
 *
 * @param {{outcome, detail, metrics, status, reason, runError}} r
 */
export function classifyFailure(r) {
  const m = r.metrics ?? {};
  const reason = String(r.reason ?? '');

  if (r.outcome === 'INFRA_FAILURE') return 'environment_failure';
  if (r.outcome === 'TIMEOUT' || r.status === 'timeout') return 'timeout';
  if (r.runError) return 'runtime_failure';

  // Explicit runtime exit reasons are authoritative — they come from the event log.
  if (/lease_lost/i.test(reason)) return 'runtime_failure';
  if (/model_unavailable/i.test(reason)) return 'model_failure';
  if (/no_progress/i.test(reason)) return 'no_progress';
  if (/budget/i.test(reason)) return 'budget_exhausted';
  if (/max_turns/i.test(reason)) return 'budget_exhausted';
  if (/denied/i.test(reason) || (m.escalations ?? 0) > 0) return 'authorization_blocked';

  // Anti-gaming guard tripped: the agent edited or deleted the repository's tests.
  if (/modified test file|deleted test file/i.test(String(r.detail ?? ''))) return 'incorrect_solution';

  // Did the agent actually change anything?
  const edits = (m.edits ?? 0) + (m.writes ?? 0);
  if (edits === 0) return 'no_edits_made';

  // Could it drive its tools at all?
  const toolCalls = m.tool_calls ?? 0;
  if (toolCalls > 0 && (m.tool_success_rate ?? 1) < 0.5) return 'tool_usage_failure';

  // Finished cleanly and quickly, but the world is still wrong.
  if (r.status === 'completed' && (m.model_calls ?? 0) <= 4) return 'gave_up_early';

  if (r.status === 'completed') return 'incorrect_solution';
  return 'unclassified';
}

/** Tally failure classes across a result set. */
export function failureBreakdown(results) {
  const out = {};
  for (const r of results) {
    if (r.outcome === 'PASS') continue;
    const c = r.failure_class ?? 'unclassified';
    out[c] = (out[c] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}
