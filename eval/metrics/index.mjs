// Metrics derived from the event log.
//
// The point of §11 of the brief: because every Run is a durable trajectory, behavioural metrics
// come from the log itself rather than from ad-hoc instrumentation. Nothing here is estimated.

import { project, stableDigest } from '../../v0/src/core/projection/index.mjs';

export function trajectoryMetrics(store, runId, { wallMs = 0 } = {}) {
  const ev = store.events(runId);
  const st = project(store, runId, { useSnapshot: false });
  const n = (t) => ev.filter(e => e.type === t).length;

  const modelResponses = ev.filter(e => e.type === 'model.responded');
  const tokens = modelResponses.reduce((a, e) => ({
    in: a.in + (e.payload.input_tokens || 0),
    out: a.out + (e.payload.output_tokens || 0),
    cache: a.cache + (e.payload.cache_read_tokens || 0),
    cost: a.cost + (e.payload.cost_usd || 0),
  }), { in: 0, out: 0, cache: 0, cost: 0 });

  // ── tool efficiency ────────────────────────────────────────────────
  const started = ev.filter(e => e.type === 'tool.started');
  const succeeded = ev.filter(e => e.type === 'tool.succeeded');
  const failed = ev.filter(e => e.type === 'tool.failed');
  const denied = ev.filter(e => e.type === 'tool.denied');

  // duplicate actions: the same (tool, args) issued more than once
  const seen = new Map();
  let duplicates = 0;
  for (const e of started) {
    const k = `${e.payload.name}:${stableDigest(e.payload.args)}`;
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    if (c > 1) duplicates++;
  }

  // per-tool breakdown — which tools does the agent actually reach for?
  const byTool = {};
  for (const e of started) {
    const t = (byTool[e.payload.name] ??= { started: 0, succeeded: 0, failed: 0 });
    t.started++;
  }
  for (const e of succeeded) if (byTool[e.payload.name]) byTool[e.payload.name].succeeded++;
  for (const e of failed) if (byTool[e.payload.name]) byTool[e.payload.name].failed++;

  // ── time distribution ──────────────────────────────────────────────
  let toolMs = 0, modelMs = 0;
  const openTool = new Map();
  const openModel = new Map();
  for (const e of ev) {
    if (e.type === 'tool.started') openTool.set(e.payload.tool_call_id, e.at);
    if (['tool.succeeded', 'tool.failed', 'tool.timed_out'].includes(e.type)) {
      const t0 = openTool.get(e.payload.tool_call_id);
      if (t0 != null) { toolMs += e.at - t0; openTool.delete(e.payload.tool_call_id); }
    }
    if (e.type === 'model.requested') openModel.set('m', e.at);
    if (['model.responded', 'model.failed'].includes(e.type)) {
      const t0 = openModel.get('m');
      if (t0 != null) { modelMs += e.at - t0; openModel.delete('m'); }
    }
  }

  // ── recovery ───────────────────────────────────────────────────────
  const recoveries = ev.filter(e => e.type === 'tool.recovery_decided');
  const recoveryByDecision = {};
  for (const r of recoveries) recoveryByDecision[r.payload.decision] = (recoveryByDecision[r.payload.decision] ?? 0) + 1;

  // failures the agent RECOVERED from: a failure followed later by a success
  const firstFailIdx = ev.findIndex(e => e.type === 'tool.failed');
  const recoveredFromFailure = firstFailIdx >= 0 &&
    ev.slice(firstFailIdx).some(e => e.type === 'tool.succeeded');

  // ── files touched ──────────────────────────────────────────────────
  const filesTouched = new Set();
  let edits = 0, writes = 0, testRuns = 0, failedTestRuns = 0;
  for (const e of started) {
    const p = e.payload?.args?.path;
    if (p) filesTouched.add(p);
    if (e.payload.name === 'edit') edits++;
    if (e.payload.name === 'write') writes++;
    if (e.payload.name === 'bash' && /node .*test|npm test|\btest\b/.test(e.payload?.args?.cmd ?? '')) testRuns++;
  }
  for (const e of failed) if (e.payload.name === 'bash' && /test/.test(String(e.payload.error))) failedTestRuns++;

  return {
    // volume
    events: ev.length,
    turns: st.budget.turns,
    model_calls: n('model.requested'),
    model_failures: n('model.failed'),
    tool_calls: started.length,
    tool_succeeded: succeeded.length,
    tool_failed: failed.length,
    tool_denied: denied.length,

    // efficiency
    duplicate_action_count: duplicates,
    duplicate_action_rate: started.length ? +(duplicates / started.length).toFixed(3) : 0,
    tool_success_rate: started.length ? +(succeeded.length / started.length).toFixed(3) : 0,
    failure_density: ev.length ? +((failed.length + n('model.failed')) / ev.length).toFixed(4) : 0,
    tools_used: byTool,

    // work done
    files_touched: filesTouched.size,
    file_list: [...filesTouched],
    edits, writes, test_runs: testRuns, failed_test_runs: failedTestRuns,

    // recovery / safety
    recovery_decisions: recoveries.length,
    recovery_by_decision: recoveryByDecision,
    recovered_from_tool_failure: recoveredFromFailure,
    authorization_events: n('tool.authorized') + n('tool.denied') + n('tool.escalated'),
    escalations: n('tool.escalated'),
    human_requests: n('human.requested'),
    degraded: n('degraded'),
    degraded_subsystems: [...new Set(ev.filter(e => e.type === 'degraded').map(e => e.payload?.subsystem))],

    // context
    context_compactions: n('context.compacted'),
    messages_elided: ev.filter(e => e.type === 'context.compacted').reduce((a, e) => a + (e.payload?.elided || 0), 0),
    compaction_bytes_saved: ev.filter(e => e.type === 'context.compacted').reduce((a, e) => a + (e.payload?.bytes_saved || 0), 0),
    messages_total: st.message_count,
    messages_hot: st.recent_messages.length,
    messages_dropped: st.dropped_message_count,
    projection_bytes: Buffer.byteLength(JSON.stringify(st)),

    // cost
    input_tokens: tokens.in,
    output_tokens: tokens.out,
    cache_read_tokens: tokens.cache,
    cost_usd: +tokens.cost.toFixed(6),

    // time
    wall_ms: wallMs,
    model_ms: modelMs,
    tool_ms: toolMs,
    other_ms: Math.max(0, wallMs - modelMs - toolMs),

    // terminal
    status: st.status,
    exit_reason: st.exit_reason,
  };
}

// ── aggregation across a run set ─────────────────────────────────────
export function aggregate(results) {
  const scored = results.filter(r => r.outcome !== 'INFRA_FAILURE');
  const passed = scored.filter(r => r.outcome === 'PASS');
  const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : 0);

  const durations = scored.map(r => r.metrics.wall_ms).sort((a, b) => a - b);
  const p = (q) => durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * q))] : 0;

  const byDifficulty = {};
  for (const r of scored) {
    const d = (byDifficulty[r.difficulty] ??= { total: 0, pass: 0 });
    d.total++; if (r.outcome === 'PASS') d.pass++;
  }
  for (const d of Object.values(byDifficulty)) d.rate = pct(d.pass, d.total);

  const byCategory = {};
  for (const r of scored) for (const c of r.categories) {
    const x = (byCategory[c] ??= { total: 0, pass: 0 });
    x.total++; if (r.outcome === 'PASS') x.pass++;
  }
  for (const x of Object.values(byCategory)) x.rate = pct(x.pass, x.total);

  const sum = (f, rs = scored) => rs.reduce((a, r) => a + (f(r) || 0), 0);
  const avg = (f, rs = scored) => (rs.length ? +(sum(f, rs) / rs.length).toFixed(2) : 0);

  return {
    tasks_total: results.length,
    tasks_scored: scored.length,
    infra_failures: results.length - scored.length,
    passed: passed.length,
    failed: scored.filter(r => r.outcome === 'FAIL').length,
    timeouts: scored.filter(r => r.outcome === 'TIMEOUT').length,
    success_rate: pct(passed.length, scored.length),
    by_difficulty: byDifficulty,
    by_category: byCategory,

    avg_wall_ms: avg(r => r.metrics.wall_ms),
    p50_wall_ms: p(0.5),
    p95_wall_ms: p(0.95),

    model_calls_per_success: passed.length ? +(sum(r => r.metrics.model_calls, passed) / passed.length).toFixed(2) : 0,
    tool_calls_per_success: passed.length ? +(sum(r => r.metrics.tool_calls, passed) / passed.length).toFixed(2) : 0,
    tokens_per_success: passed.length ? Math.round(sum(r => r.metrics.input_tokens + r.metrics.output_tokens, passed) / passed.length) : 0,
    cost_per_success: passed.length ? +(sum(r => r.metrics.cost_usd, passed) / passed.length).toFixed(6) : 0,

    total_input_tokens: sum(r => r.metrics.input_tokens),
    total_output_tokens: sum(r => r.metrics.output_tokens),
    total_cost_usd: +sum(r => r.metrics.cost_usd).toFixed(6),

    avg_duplicate_rate: avg(r => r.metrics.duplicate_action_rate),
    avg_tool_success_rate: avg(r => r.metrics.tool_success_rate),
    total_degraded: sum(r => r.metrics.degraded),
    total_escalations: sum(r => r.metrics.escalations),
    runs_with_recovery: scored.filter(r => r.metrics.recovery_decisions > 0).length,
  };
}
