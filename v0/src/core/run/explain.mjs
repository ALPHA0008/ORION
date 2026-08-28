// Phase L — make a run's history understandable to a human.
// Phase M: redact anything that looks like a secret; summarise by default, full detail on request.

const SECRET_PATTERNS = [
  [/\b(sk-[A-Za-z0-9_-]{16,})\b/g, 'sk-…REDACTED'],
  [/\b(ghp_[A-Za-z0-9]{20,})\b/g, 'ghp_…REDACTED'],
  [/\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, 'xox…REDACTED'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, 'AKIA…REDACTED'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, 'jwt…REDACTED'],
  [/(?<=(?:password|passwd|secret|token|api[_-]?key|authorization)["'\s:=]{1,4})[^\s"',}]{6,}/gi, 'REDACTED'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (m) => m.replace(/^[^@]+/, '…')],
];

export function redact(text) {
  let s = String(text ?? '');
  for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
  return s;
}

const clip = (s, n) => { const t = redact(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

const GLYPH = {
  'run.created': '·', 'run.leased': '·', 'run.lease_renewed': '·', 'run.lease_lost': '⚠',
  'run.paused': '⏸', 'run.resumed': '▶', 'run.parked': '⛔', 'run.completed': '✓', 'run.failed': '✕',
  'turn.started': '▸', 'turn.finished': '·',
  'model.requested': '·', 'model.responded': '🧠', 'model.failed': '⚠',
  'tool.requested': '·', 'tool.authorized': '·', 'tool.denied': '⛔', 'tool.escalated': '🙋',
  'tool.started': '·', 'tool.succeeded': '✓', 'tool.failed': '✕', 'tool.timed_out': '⏱',
  'tool.recovery_decided': '♻', 'context.compacted': '✂', 'context.retrieved': '·',
  'memory.written': '·', 'memory.retrieved': '·',
  'human.requested': '🙋', 'human.responded': '💬', 'human.timed_out': '⏱',
  'child.spawned': '·', 'child.finished': '·', 'degraded': '⚠',
};

/** One line per event, human-first. `verbose` shows every event; default hides bookkeeping. */
export function explain(store, runId, { verbose = false, full = false, maxArg = 70 } = {}) {
  const events = store.events(runId);
  const run = store.run(runId);
  const lines = [];

  lines.push(`Run ${runId}`);
  if (run?.parent_run_id) lines.push(`  forked from ${run.parent_run_id} at event ${run.forked_from_seq}`);
  if (run?.task) lines.push(`  task: ${clip(run.task, 100)}`);
  lines.push('─'.repeat(64));

  const HIDDEN = new Set(['run.lease_renewed', 'tool.authorized', 'tool.requested',
                          'model.requested', 'turn.finished', 'run.leased', 'context.retrieved']);

  for (const e of events) {
    if (!verbose && HIDDEN.has(e.type)) continue;
    const p = e.payload || {};
    const g = GLYPH[e.type] ?? '·';
    let text;
    switch (e.type) {
      case 'run.created':   text = `run created (scope ${p.scope})`; break;
      case 'turn.started':  text = `task: ${clip(p.input, 90)}`; break;
      case 'model.responded': {
        const n = p.tool_calls?.length ?? 0;
        const cost = p.cost_usd != null ? ` $${p.cost_usd}` : '';
        const tok = (p.input_tokens || p.output_tokens) ? ` ${p.input_tokens}→${p.output_tokens}tok` : '';
        text = n ? `wants ${n} tool call${n > 1 ? 's' : ''}: ${p.tool_calls.map(t => t.name).join(', ')}${tok}${cost}`
                 : `"${clip(p.content, 80)}"${tok}${cost}`;
        break;
      }
      case 'model.failed':  text = `model error (${p.kind}${p.retryable ? ', retryable' : ''}): ${clip(p.error, 70)}`; break;
      case 'tool.started':  text = `${p.name} ${clip(JSON.stringify(p.args ?? {}), maxArg)}`; break;
      case 'tool.succeeded':text = `${p.name} → ${clip(p.result, maxArg)}`; break;
      case 'tool.failed':   text = `${p.name} failed: ${clip(p.error, maxArg)}`; break;
      case 'tool.denied':   text = `${p.name} DENIED — ${clip(p.reason, 60)}`; break;
      case 'tool.escalated':text = `${p.name} needs approval`; break;
      case 'tool.recovery_decided':
        text = `recovery: ${p.name} (${p.class}) → ${p.decision}${p.verified ? ` [verify: ${p.verified}]` : ''}`; break;
      case 'human.requested': text = `asked: "${clip(p.prompt, 70)}"`; break;
      case 'human.responded': text = `human said: ${clip(p.response, 40)}`; break;
      case 'human.timed_out': text = `human request expired`; break;
      case 'degraded':      text = `DEGRADED [${p.subsystem}] ${clip(p.reason, 70)}`; break;
      case 'context.compacted': text = p.elided
        ? `compacted context (elided ${p.elided} superseded results, saved ${p.bytes_saved ?? 0}b)`
        : `compacted context (dropped ${p.dropped ?? '?'} messages)`; break;
      case 'run.paused':    text = `paused — ${p.reason}`; break;
      case 'run.resumed':   text = p.seam ? `── fork seam (history above is inherited) ──` : `resumed`; break;
      case 'run.lease_lost':text = `lease lost (${p.reason ?? 'expired'}) — will be reclaimed`; break;
      case 'run.parked':    text = `parked — ${p.reason}`; break;
      case 'run.completed': text = `completed — ${p.reason}${p.result ? `: "${clip(p.result, 60)}"` : ''}`; break;
      case 'run.failed':    text = `failed — ${p.reason}${p.detail ? ` (${clip(p.detail, 60)})` : ''}`; break;
      default:              text = verbose ? clip(JSON.stringify(p), maxArg) : e.type;
    }
    const ts = new Date(e.at).toISOString().slice(11, 19);
    lines.push(`${String(e.seq).padStart(4)}  ${ts}  ${g} ${text}`);
    if (full) {
      const raw = redact(JSON.stringify(p ?? {}, null, 2));
      for (const l of raw.split('\n')) lines.push(`            ${l}`);
    }
  }
  return lines.join('\n');
}

/** Compact status block for `harness status`. */
export function summarise(store, runId, state) {
  const run = store.run(runId);
  const L = [];
  L.push(`Run ${runId}`);
  L.push(`  status      ${state.status}${state.exit_reason ? ` (${state.exit_reason})` : ''}`);
  L.push(`  events      ${state.seq}`);
  L.push(`  turns       ${state.budget.turns}   model calls ${state.budget.model_calls}   tool calls ${state.budget.tool_calls}`);
  L.push(`  tokens      ${state.budget.tokens} (in ${state.budget.input_tokens} / out ${state.budget.output_tokens}` +
         `${state.budget.cache_read_tokens ? `, cache ${state.budget.cache_read_tokens}` : ''})`);
  if (state.budget.cost_usd) L.push(`  cost        $${state.budget.cost_usd}`);
  L.push(`  messages    ${state.message_count} total, ${state.recent_messages.length} hot, ${state.dropped_message_count} archived`);
  if (state.degradation_count) {
    L.push(`  DEGRADED    ${state.degradation_count} event(s):`);
    for (const d of state.recent_degradations.slice(-3)) L.push(`                - [${d.subsystem}] ${clip(d.reason, 60)}`);
  }
  const open = Object.entries(state.open_human_requests);
  if (open.length) for (const [id, r] of open) L.push(`  AWAITING    ${id}: "${clip(r.prompt, 60)}"`);
  const pend = Object.keys(state.pending_tool_calls);
  if (pend.length) L.push(`  in-flight   ${pend.length} tool call(s)`);
  if (run?.parent_run_id) L.push(`  forked from ${run.parent_run_id} @${run.forked_from_seq}`);
  if (run?.lease_expires_at) L.push(`  lease       held by ${run.worker_id}, expires in ${Math.max(0, run.lease_expires_at - Date.now())}ms`);
  return L.join('\n');
}
