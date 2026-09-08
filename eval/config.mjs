// W5 E3 — the configuration the evaluation actually measures.
//
// THE DEFECT THIS FIXES
//
// The eval runners hard-coded `compactContext: process.env.HARNESS_COMPACT === '1'`, i.e. OFF
// by default. The shipped Worker default has been ON since Wave 3. So every unlabelled report
// in `eval/reports/` measured a configuration NO USER RUNS, and said nothing about it. A number
// produced under settings the product does not ship is not a measurement of the product.
//
// Two things are needed, and neither is sufficient alone:
//
//   1. The default must BE the shipped default, so the headline number describes what a user
//      gets. Deviating is still allowed — it is how an A/B is run — but it must be deliberate.
//   2. Every report must carry the configuration it was produced under, so a stored result
//      stays interpretable after the defaults move again. `describeConfig()` is embedded in
//      report output for exactly that reason.
//
// `DEVIATIONS` is derived, never hand-maintained: it compares the resolved config against
// SHIPPED_DEFAULTS at runtime, so a future divergence cannot be introduced silently.

/**
 * The defaults a user actually gets from `new Worker(store, {...})`.
 *
 * Mirrored here rather than imported because the point is to DETECT drift: if the Worker's
 * defaults change and this table is not updated, `configDrift()` reports it instead of the
 * eval silently tracking the change and invalidating comparisons against older reports.
 */
export const SHIPPED_DEFAULTS = Object.freeze({
  compactContext: true,
  contextBudgetBytes: 24_000,
  stream: false,
  temperature: 0,
  maxTokens: 2_048,
  maxRepeatedCalls: 3,
  maxTurnsWithoutProgress: 5,
});

/**
 * Resolve the configuration for an eval run.
 *
 * `HARNESS_COMPACT` remains an explicit override so the compaction A/B is still runnable — but
 * it now overrides a SHIPPED default rather than silently establishing a different one:
 *   unset  → shipped default (ON)
 *   '1'    → forced on
 *   '0'    → forced off (the old implicit default, now something you have to ask for)
 */
export function resolveConfig(overrides = {}) {
  const env = process.env.HARNESS_COMPACT;
  const compactContext = env === undefined || env === ''
    ? SHIPPED_DEFAULTS.compactContext
    : env === '1';

  return { ...SHIPPED_DEFAULTS, compactContext, ...overrides };
}

/** Fields where the resolved config departs from what the product ships. */
export function configDrift(cfg) {
  const out = {};
  for (const [k, shipped] of Object.entries(SHIPPED_DEFAULTS)) {
    if (cfg[k] !== shipped) out[k] = { shipped, measured: cfg[k] };
  }
  return out;
}

/**
 * The label every report carries. Embedded as structured data (not prose) so `compare` can
 * refuse to compare two reports produced under different configurations.
 */
export function describeConfig(cfg, extra = {}) {
  const drift = configDrift(cfg);
  return {
    config: { ...cfg },
    shipped_defaults: { ...SHIPPED_DEFAULTS },
    deviations: drift,
    matches_shipped_defaults: Object.keys(drift).length === 0,
    ...extra,
  };
}

/** One-line human summary for console output and report headers. */
export function configLine(cfg) {
  const drift = configDrift(cfg);
  const keys = Object.keys(drift);
  return keys.length === 0
    ? 'config: SHIPPED DEFAULTS'
    : `config: shipped defaults EXCEPT ${keys.map(k => `${k}=${JSON.stringify(drift[k].measured)} (ships ${JSON.stringify(drift[k].shipped)})`).join(', ')}`;
}
