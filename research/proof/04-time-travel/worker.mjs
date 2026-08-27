// Experiment 4 — the worker loop. Stateless: all state comes from the log.
import { Store, project, emptyState, applyEvent, LocalSandbox, makeTools, makeAuthorizer, uid } from './harness.mjs';

// ---------------- Deterministic scripted "model" ----------------
// No credentials available in this environment, so the model is a deterministic
// program keyed on the visible state. This is a LIMITATION (recorded in results.md),
// but it is also what makes replay assertions exact.
export function makeScriptedModel(script, { failFirstN = 0, degradeAt = null } = {}) {
  let calls = 0;
  return {
    name: 'scripted-v1',
    invoke(state) {
      calls++;
      if (calls <= failFirstN) { const e = new Error('simulated provider 503'); e.retryable = true; throw e; }
      const step = state.message_count; // deterministic function of visible state
      const entry = script.find(s => s.when(state)) ?? { reply: { content: 'done', finish: true } };
      const out = typeof entry.reply === 'function' ? entry.reply(state) : entry.reply;
      return { ...out, input_tokens: 100 + state.message_count * 10, output_tokens: 40,
               degrade: degradeAt === calls ? { subsystem: 'model', reason: 'primary provider down, using fallback' } : null };
    },
  };
}

// ---------------- Worker ----------------
export class Worker {
  constructor(store, { sandbox, model, tools, authorize, workerId = uid('w'),
                       leaseMs = 30_000, snapshotEvery = 25, maxTurns = 50,
                       crashAt = null } = {}) {
    Object.assign(this, { store, sandbox, model, tools, authorize, workerId, leaseMs,
                          snapshotEvery, maxTurns, crashAt });
  }

  // crashAt: {after: 'tool.effect'|'model.responded'|'tool.succeeded', n: k}
  _maybeCrash(marker, counters) {
    if (!this.crashAt) return;
    if (this.crashAt.after === marker && ++counters[marker] === this.crashAt.n) {
      const e = new Error(`SIMULATED CRASH after ${marker} #${this.crashAt.n}`);
      e.__simulated_crash = true; throw e;
    }
  }

  runOnce(runId, { input = null } = {}) {
    const S = this.store;
    let state = project(S, runId);
    const counters = {};

    if (input !== null) { S.append(runId, 'turn.started', { input }); state = project(S, runId); }

    // ---- RESUME: reconcile any tool.started with no terminal event (Exp 2 contract) ----
    for (const [tcid, pend] of Object.entries(state.pending_tool_calls)) {
      if (pend.escalated) continue;                     // waiting on a human, not orphaned
      const tool = this.tools[pend.name];
      const rec = tool?.recovery?.(pend.args) ?? { class: 'UNSAFE' };
      let decision;
      if (rec.verify) {
        const v = rec.verify();
        decision = v === 'applied' ? 'skip' : v === 'not-applied' ? 'reissue' : 'escalate';
      } else if (['READ_ONLY', 'SAFE_RETRY', 'SELF_VERIFYING', 'TRANSACTIONAL'].includes(rec.class)) {
        decision = 'reissue';
      } else decision = 'escalate';

      S.append(runId, 'degraded', { subsystem: 'recovery',
        reason: `orphaned ${pend.name} (${rec.class}) -> ${decision}` });

      if (decision === 'skip') {
        S.append(runId, 'tool.succeeded', { tool_call_id: tcid, name: pend.name,
          result: '[recovered: effect already applied]' });
      } else if (decision === 'reissue') {
        try { const r = tool.run(pend.args);
          S.append(runId, 'tool.succeeded', { tool_call_id: tcid, name: pend.name, result: String(r).slice(0, 4000) }); }
        catch (err) { S.append(runId, 'tool.failed', { tool_call_id: tcid, name: pend.name, error: String(err.message) }); }
      } else {
        const rid = uid('hr');
        S.db.prepare(`INSERT INTO human_requests (id,run_id,prompt,status,created_at) VALUES (?,?,?,'pending',?)`)
          .run(rid, runId, `Tool ${pend.name} may have already run. Re-issue?`, Date.now());
        S.append(runId, 'human.requested', { request_id: rid, tool_call_id: tcid, prompt: 'ambiguous recovery' });
        S.append(runId, 'run.paused', { reason: 'ambiguous_tool_recovery' });
        S.setStatus(runId, 'paused', { releaseLease: true });
        return { status: 'paused', reason: 'ambiguous_tool_recovery' };
      }
      state = project(S, runId);
    }

    // ---- answer any human responses that arrived while paused ----
    const answered = S.db.prepare(`SELECT * FROM human_requests WHERE run_id=? AND status='answered'`).all(runId);
    for (const hr of answered) {
      if (!state.open_human_requests[hr.id]) continue;
      S.append(runId, 'human.responded', { request_id: hr.id, response: hr.response });
      const tcid = state.open_human_requests[hr.id].tool_call_id;
      if (tcid) {
        const pend = state.pending_tool_calls[tcid];
        if (hr.response === 'approve' && pend) {
          try { const r = this.tools[pend.name].run(pend.args);
            S.append(runId, 'tool.succeeded', { tool_call_id: tcid, name: pend.name, result: String(r).slice(0,4000) }); }
          catch (err) { S.append(runId, 'tool.failed', { tool_call_id: tcid, name: pend.name, error: String(err.message) }); }
        } else {
          S.append(runId, 'tool.denied', { tool_call_id: tcid, name: pend?.name ?? '?', reason: `human said: ${hr.response}` });
        }
      }
      S.db.prepare(`UPDATE human_requests SET status='consumed' WHERE id=?`).run(hr.id);
      state = project(S, runId);
    }
    if (S.run(runId).status === 'paused') { S.setStatus(runId, 'running'); S.append(runId, 'run.resumed', {}); state = project(S, runId); }

    // ---- main loop ----
    for (let turn = 0; turn < this.maxTurns; turn++) {
      this.store.renew(runId, this.workerId, this.leaseMs);
      state = project(S, runId);

      // authorize the model call
      const az = this.authorize({ kind: 'model', name: this.model.name });
      if (az.decision === 'deny') { S.append(runId, 'run.failed', { reason: `model denied: ${az.reason}` });
        S.setStatus(runId, 'failed', { releaseLease: true }); return { status: 'failed' }; }

      S.append(runId, 'model.requested', { model: this.model.name, messages: state.recent_messages.length });
      let resp;
      try { resp = this.model.invoke(state); }
      catch (err) {
        S.append(runId, 'model.failed', { error: String(err.message), retryable: !!err.retryable });
        if (err.retryable) { S.append(runId, 'degraded', { subsystem: 'model', reason: 'retry after provider error' }); continue; }
        S.append(runId, 'run.failed', { reason: String(err.message) });
        S.setStatus(runId, 'failed', { releaseLease: true }); return { status: 'failed' };
      }
      if (resp.degrade) S.append(runId, 'degraded', resp.degrade);
      S.append(runId, 'model.responded', { content: resp.content ?? '', tool_calls: resp.tool_calls ?? null,
        input_tokens: resp.input_tokens, output_tokens: resp.output_tokens });
      this._maybeCrash('model.responded', counters);

      if (resp.finish || !resp.tool_calls?.length) {
        S.append(runId, 'run.completed', { result: resp.content ?? '', reason: 'model_finished' });
        S.setStatus(runId, 'completed', { releaseLease: true });
        this._snapshot(runId);
        return { status: 'completed', result: resp.content };
      }

      for (const tc of resp.tool_calls) {
        const tool = this.tools[tc.name];
        const tcid = tc.id ?? uid('tc');
        S.append(runId, 'tool.requested', { tool_call_id: tcid, name: tc.name, args: tc.args });
        if (!tool) { S.append(runId, 'tool.failed', { tool_call_id: tcid, name: tc.name, error: 'unknown tool' }); continue; }

        const rec = tool.recovery?.(tc.args) ?? { class: 'UNSAFE' };
        const d = this.authorize({ kind: 'tool', name: tc.name, args: tc.args, recovery: rec });

        if (d.decision === 'deny') { S.append(runId, 'tool.denied', { tool_call_id: tcid, name: tc.name, reason: d.reason }); continue; }

        if (d.decision === 'escalate') {
          const rid = uid('hr');
          S.db.prepare(`INSERT INTO human_requests (id,run_id,prompt,options,status,created_at) VALUES (?,?,?,?,'pending',?)`)
            .run(rid, runId, d.prompt, d.options ? JSON.stringify(d.options) : null, Date.now());
          S.append(runId, 'tool.escalated', { tool_call_id: tcid, name: tc.name, args: tc.args });
          S.append(runId, 'human.requested', { request_id: rid, tool_call_id: tcid, prompt: d.prompt });
          S.append(runId, 'run.paused', { reason: 'awaiting_human' });
          S.setStatus(runId, 'paused', { releaseLease: true });   // <-- lease RELEASED; worker freed
          this._snapshot(runId);
          return { status: 'paused', reason: 'awaiting_human', request_id: rid };
        }

        S.append(runId, 'tool.authorized', { tool_call_id: tcid, name: tc.name });
        S.append(runId, 'tool.started', { tool_call_id: tcid, name: tc.name, args: tc.args });
        let out, failed = null;
        try { out = tool.run(tc.args); } catch (err) { failed = err; }
        // the crash window: effect has happened, terminal event not yet written
        this._maybeCrash('tool.effect', counters);
        if (failed) S.append(runId, 'tool.failed', { tool_call_id: tcid, name: tc.name, error: String(failed.message) });
        else S.append(runId, 'tool.succeeded', { tool_call_id: tcid, name: tc.name, result: String(out).slice(0, 4000) });
        this._maybeCrash('tool.succeeded', counters);
      }
      this._snapshot(runId);
    }
    S.append(runId, 'run.failed', { reason: 'max_turns' });
    S.setStatus(runId, 'failed', { releaseLease: true });
    return { status: 'failed', reason: 'max_turns' };
  }

  _snapshot(runId) {
    const st = project(this.store, runId, { useSnapshot: true });
    if (st.seq % this.snapshotEvery < 12) this.store.putSnapshot(runId, st.seq, st);
  }
}

// ---------------- Reaper ----------------
export function reap(store, { maxAttempts = 5 } = {}) {
  const now = Date.now();
  const stale = store.db.prepare(
    `SELECT id, attempts FROM runs WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`
  ).all(now);
  let requeued = 0, parked = 0;
  for (const r of stale) {
    if (Number(r.attempts) >= maxAttempts) {
      store.db.prepare(`UPDATE runs SET status='parked', lease_expires_at=NULL, worker_id=NULL WHERE id=? AND lease_expires_at<=?`).run(r.id, now);
      store.append(r.id, 'run.parked', { reason: 'max_attempts' }); parked++;
    } else {
      store.db.prepare(`UPDATE runs SET status='pending', lease_expires_at=NULL, worker_id=NULL WHERE id=? AND lease_expires_at<=?`).run(r.id, now);
      requeued++;
    }
  }
  return { requeued, parked };
}

// ---------------- Fork ----------------
export function fork(store, srcRunId, atSeq, newRunId = uid('run')) {
  const src = store.run(srcRunId);
  store.createRun(newRunId, { scope: src.scope, principal: src.principal,
    parent: srcRunId, forkedFromSeq: atSeq });
  // copy events 1..atSeq, preserving order (skip the fork's own run.created at seq 1)
  const copied = store.events(srcRunId, 0, atSeq);
  store.db.exec('BEGIN');
  try {
    store.db.prepare('DELETE FROM events WHERE run_id=?').run(newRunId);
    const ins = store.db.prepare('INSERT INTO events (run_id,seq,type,at,payload) VALUES (?,?,?,?,?)');
    for (const e of copied) ins.run(newRunId, e.seq, e.type, e.at, e.payload ? JSON.stringify(e.payload) : null);
    store.db.exec('COMMIT');
  } catch (e) { store.db.exec('ROLLBACK'); throw e; }
  store.append(newRunId, 'run.resumed', { forked_from: srcRunId, at_seq: atSeq });
  store.setStatus(newRunId, 'pending');
  return newRunId;
}

// ---------------- Explain ----------------
export function explain(store, runId) {
  return store.events(runId).map(e => {
    const p = e.payload || {};
    const d = e.type === 'tool.started'    ? `${p.name} ${JSON.stringify(p.args ?? {}).slice(0, 70)}`
            : e.type === 'tool.succeeded'  ? `${p.name} -> ${String(p.result ?? '').slice(0, 60).replace(/\n/g, '\\n')}`
            : e.type === 'tool.failed'     ? `${p.name} !! ${p.error}`
            : e.type === 'tool.denied'     ? `${p.name} DENIED ${p.reason}`
            : e.type === 'tool.escalated'  ? `${p.name} -> human`
            : e.type === 'model.responded' ? `"${String(p.content ?? '').slice(0, 50)}" tools=${p.tool_calls?.length ?? 0}`
            : e.type === 'degraded'        ? `${p.subsystem}: ${p.reason}`
            : e.type === 'human.requested' ? `"${String(p.prompt).slice(0, 50)}"`
            : e.type === 'human.responded' ? `${p.response}`
            : e.type === 'run.completed'   ? `${p.reason}`
            : JSON.stringify(p ?? {}).slice(0, 60);
    return `  ${String(e.seq).padStart(3)} ${e.type.padEnd(18)} ${d}`;
  }).join('\n');
}
