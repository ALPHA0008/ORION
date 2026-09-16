// W10 — quotas: the part that makes "parallelism designed, not assumed" concrete.
//
// The plan rejects "just start more processes" by name, for two specific reasons, and this file
// answers both:
//
//   STORE CONTENTION. The event store is one SQLite file. It runs in WAL mode with a 5s busy
//   timeout, so concurrent writers are safe but not free — every extra writer is another
//   contender for the write lock, and a parent blocked behind ten chattering children is a parent
//   that looks hung. `MAX_LIVE_CHILDREN` is small on purpose: the bound exists to keep the store
//   responsive, not to be generous.
//
//   RESOURCE CONTENTION. Children share the parent's workspace and container (scope §4). Ten
//   children running `bash` in one container fight over the same CPU and PID limits W6 set for a
//   single run. The cgroup caps the container, so unbounded children do not threaten the host —
//   they starve each other and the parent, which is a correctness problem rather than a safety one
//   and is exactly what a quota is for.
//
// TOKENS ARE THE THIRD AXIS, AND THE EASIEST TO GET WRONG
//
// Without an AGGREGATE cap, delegation is a way to spend without limit: a parent with a 500k
// budget could spawn ten children at 100k each and spend 1.5M while its own counter reads almost
// nothing. So the parent's budget is charged for its children's tokens, folded from the log
// (`childTokens`) rather than tracked in memory — which means it survives a crash and is correct
// on resume.

import { projectLineage } from '../projection/lineage.mjs';

/**
 * How many children may be live at once for one parent.
 *
 * TWO, deliberately. One is not parallelism; ten is a thundering herd against a single-file store
 * and a single container's CPU quota. Two delivers the actual win — overlapping a slow read-only
 * investigation with other work — while keeping the write-lock contenders countable. Raise it in
 * config when there is evidence, not by default.
 */
export const MAX_LIVE_CHILDREN = 2;

/** Depth ceiling: a child may spawn a grandchild, but the tree cannot run away. */
export const MAX_CHILD_DEPTH = 2;

/** Total children one parent may spawn across its whole run, live or finished. */
export const MAX_CHILDREN_PER_RUN = 8;

/** Default per-child ceilings. Smaller than a parent's: a child is a bounded sub-task. */
export const DEFAULT_CHILD_BUDGET = Object.freeze({
  tokens: 120_000,
  tool_calls: 60,
  cost_usd: 1,
});

/** Wall clock for one child before the parent stops waiting and cancels it. */
export const CHILD_TIMEOUT_MS = 10 * 60_000;

/** Turn ceiling inside a child — lower than a parent's 40; a sub-task that long is mis-scoped. */
export const CHILD_MAX_TURNS = 20;

export class QuotaError extends Error {
  /** @param {string} message @param {{ kind: string }} info */
  constructor(message, { kind }) {
    super(message);
    this.name = 'QuotaError';
    this.kind = kind;
  }
}

/** Reasons a spawn is refused, so the parent can be told which wall it hit. */
export const QuotaKind = Object.freeze({
  TOO_MANY_LIVE: 'too_many_live_children',
  TOO_MANY_TOTAL: 'too_many_children',
  TOO_DEEP: 'max_depth',
  BUDGET: 'budget_exhausted',
});

/**
 * Resolve the effective quota from config, never above the shipped ceilings.
 *
 * Config may only make these SMALLER. A config file that could raise `maxLiveChildren` to 50 would
 * be a way to reintroduce the thundering herd the design rejected — the same "rules may only raise
 * strictness" discipline W8 established for permissions, applied to concurrency.
 */
export function resolveQuota(cfg = {}) {
  const clamp = (v, ceiling) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return ceiling;
    return Math.min(Math.floor(n), ceiling);
  };
  const b = cfg.budget ?? {};
  return Object.freeze({
    maxLive: clamp(cfg.maxLiveChildren, MAX_LIVE_CHILDREN),
    maxTotal: clamp(cfg.maxChildren, MAX_CHILDREN_PER_RUN),
    maxDepth: clamp(cfg.maxDepth, MAX_CHILD_DEPTH),
    timeoutMs: clamp(cfg.timeoutMs, CHILD_TIMEOUT_MS),
    maxTurns: clamp(cfg.maxTurns, CHILD_MAX_TURNS),
    budget: Object.freeze({
      tokens: clamp(b.tokens, DEFAULT_CHILD_BUDGET.tokens),
      tool_calls: clamp(b.tool_calls, DEFAULT_CHILD_BUDGET.tool_calls),
      cost_usd: Number(b.cost_usd) > 0
        ? Math.min(Number(b.cost_usd), DEFAULT_CHILD_BUDGET.cost_usd)
        : DEFAULT_CHILD_BUDGET.cost_usd,
    }),
  });
}

/**
 * May this parent spawn another child right now?
 *
 * Answered from the LOG (`projectLineage`), never from a counter, so it is correct in a process
 * that just resumed a run it did not start — the same reason W9 read prior MCP bindings from the
 * log rather than a field.
 *
 * @param {any[]} events
 * @param {{ quota: any, depth?: number, parentBudget?: any, parentTokens?: number }} opts
 * @returns {{ ok: boolean, kind?: string, reason?: string }}
 */
export function canSpawn(events, { quota, depth = 1, parentBudget = null, parentTokens = 0 }) {
  if (depth > quota.maxDepth)
    return { ok: false, kind: QuotaKind.TOO_DEEP,
      reason: `delegation is limited to ${quota.maxDepth} level${quota.maxDepth === 1 ? '' : 's'}; `
            + `this would be level ${depth}` };

  const lineage = projectLineage(events);
  if (lineage.spawned >= quota.maxTotal)
    return { ok: false, kind: QuotaKind.TOO_MANY_TOTAL,
      reason: `this run has already spawned ${lineage.spawned} children (limit ${quota.maxTotal})` };

  if (lineage.running.length >= quota.maxLive)
    return { ok: false, kind: QuotaKind.TOO_MANY_LIVE,
      reason: `${lineage.running.length} child${lineage.running.length === 1 ? ' is' : 'ren are'} `
            + `already running (limit ${quota.maxLive}); wait for one to finish` };

  // The aggregate check. Delegated spend counts against the parent, or delegation becomes an
  // unmetered budget.
  if (parentBudget?.tokens) {
    const spent = parentTokens + lineage.tokens;
    if (spent + quota.budget.tokens > parentBudget.tokens)
      return { ok: false, kind: QuotaKind.BUDGET,
        reason: `the run has spent ${spent} tokens (its own plus ${lineage.tokens} delegated) and a `
              + `child may need ${quota.budget.tokens} more, which would exceed the run budget of `
              + `${parentBudget.tokens}` };
  }

  return { ok: true };
}
