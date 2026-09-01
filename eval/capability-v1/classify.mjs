// Classify each baseline outcome, then find the FIRST WRONG TURN in the trajectory.
//
// §24 asks for a failure class; §25 asks for the mechanism behind it. Both are derived from the
// durable event log, not from the final score and not from asking a model what happened. The
// ordering below matters: a cause that is not the agent's fault must be claimed BEFORE any class
// that blames the agent, or infrastructure noise is silently scored as incapability.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../v0/src/core/run/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Ordered most-exculpatory first. The first rule that matches wins. */
function classify(r, ev) {
  const has = (t) => ev.some(e => e.type === t);
  const count = (t) => ev.filter(e => e.type === t).length;

  if (r.outcome === 'INFRA' || r.run_error) return ['INFRA', r.infra ?? r.run_error];
  if (r.verifier_error) return ['VERIFIER', r.verifier_error];
  if (r.outcome === 'TASK') return ['TASK', r.infra];
  if (r.timed_out) return ['TIMEOUT', `wall ${(r.wall_ms / 1000).toFixed(0)}s`];
  if (/budget/i.test(r.reason ?? '')) return ['BUDGET_EXHAUSTED', r.reason];

  // A model that never produced a usable call is a MODEL failure even though it looks like a stall.
  if (count('model.failed') > 0 && count('model.responded') === 0)
    return ['MODEL', 'no usable model response'];

  // HARNESS: the agent was trying to act and the runtime would not let it land.
  const failed = count('tool.failed');
  const denied = count('tool.denied');
  const started = count('tool.started') || 1;
  if (denied > 0) return ['HARNESS', `${denied} tool call(s) denied`];
  if (has('run.paused')) return ['HARNESS', 'run paused awaiting a human'];
  if (failed / started > 0.5 && failed >= 3)
    return ['HARNESS', `${failed}/${started} tool calls failed`];

  // MODEL: the runtime did its job; the agent stopped or edited wrongly.
  if (/no_progress/.test(r.reason ?? '')) return ['MODEL', 'no_progress'];
  if (/max_turns/.test(r.reason ?? '')) return ['MODEL', 'exhausted turns without a fix'];
  if ((r.mutations ?? 0) === 0 && /finished/.test(r.reason ?? ''))
    return ['MODEL', 'declared completion with an unchanged world'];
  return ['MODEL', r.reason ?? 'wrong or incomplete edit'];
}

/**
 * The first wrong turn — §26.
 *
 * The final score says a task failed; it does not say where the run stopped being recoverable.
 * These are the earliest observable divergences, cheapest signal first.
 */
function firstWrongTurn(ev) {
  const out = [];
  const started = ev.filter(e => e.type === 'tool.started');

  const firstFail = ev.find(e => e.type === 'tool.failed');
  if (firstFail) out.push({ at: firstFail.at, what: `first tool failure: ${firstFail.payload.name}`,
                            detail: String(firstFail.payload.error ?? '').slice(0, 200) });

  // Repeating an identical call is the clearest sign the agent is not learning from the result.
  const seen = new Map();
  for (const e of started) {
    const k = `${e.payload.name}:${JSON.stringify(e.payload.args)}`;
    if (seen.has(k)) { out.push({ at: e.at, what: `repeated identical call: ${e.payload.name}` }); break; }
    seen.set(k, e.at);
  }

  // A run that only ever reads never attempted the task at all.
  const mutating = started.filter(e => ['write', 'edit'].includes(e.payload.name));
  if (started.length >= 3 && mutating.length === 0)
    out.push({ at: started.at(-1).at, what: `${started.length} tool calls, none mutating -- investigation only` });
  else if (mutating.length) out.push({ at: mutating[0].at, what: `first mutation: ${mutating[0].payload.name} ${mutating[0].payload.args?.path ?? ''}` });

  const empty = ev.find(e => e.type === 'model.responded'
    && !e.payload.tool_calls?.length && !String(e.payload.content ?? '').trim());
  if (empty) out.push({ at: empty.at, what: 'empty model response (no text, no tool calls)' });

  return out.sort((a, b) => a.at - b.at);
}

// ── main ─────────────────────────────────────────────────────────────────────
const runFile = process.env.RUN ?? path.join(HERE, 'runs', 'qwen3.6_35b.json');
const data = JSON.parse(fs.readFileSync(runFile, 'utf8'));

const rows = [];
for (const r of data.results) {
  let ev = [];
  if (r.db && fs.existsSync(r.db)) {
    try { const s = new Store(r.db); ev = s.events(r.run_id); s.close(); } catch { /* unreadable */ }
  }
  const [cls, mech] = r.task_success ? ['PASS', null] : classify(r, ev);
  rows.push({
    task_id: r.task_id, repository: r.repository,
    success: !!r.task_success, klass: cls, mechanism: mech,
    status: r.status, reason: r.reason, wall_s: r.wall_ms ? Math.round(r.wall_ms / 1000) : null,
    events: ev.length,
    tool_calls: ev.filter(e => e.type === 'tool.started').length,
    tool_failed: ev.filter(e => e.type === 'tool.failed').length,
    mutations: ev.filter(e => e.type === 'tool.succeeded' && ['write', 'edit'].includes(e.payload.name)).length,
    model_calls: ev.filter(e => e.type === 'model.responded').length,
    f2p: r.fail_to_pass_now_passes ?? null,
    p2p: r.pass_to_pass_still_passes ?? null,
    diff_stat: r.diff_stat ?? '',
    first_wrong_turn: firstWrongTurn(ev).slice(0, 4),
  });
}

const outDir = path.join(HERE, 'reports');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, path.basename(runFile).replace(/\.json$/, '-taxonomy.json'));
fs.writeFileSync(outFile, JSON.stringify({ model: data.model, at: new Date().toISOString(), rows }, null, 2));

const tally = {};
for (const r of rows) tally[r.klass] = (tally[r.klass] ?? 0) + 1;
console.log(`${rows.length} runs · ${rows.filter(r => r.success).length} passed`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`wrote ${outFile}`);
