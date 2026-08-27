// Minimal event system for Experiment 1. No agent, no model, no tools.
// Deliberately small: Event, EventStore (SQLite | Postgres), StateReducer, Snapshot.

// ---------- Event ----------
// { run_id, seq, type, at, causation_id, payload }

export const EVENT_TYPES = [
  'run.created', 'run.leased', 'run.lease_renewed', 'run.paused', 'run.resumed',
  'run.parked', 'run.completed', 'run.failed',
  'turn.started', 'turn.finished',
  'model.requested', 'model.responded', 'model.failed',
  'tool.requested', 'tool.authorized', 'tool.denied', 'tool.escalated',
  'tool.started', 'tool.succeeded', 'tool.failed', 'tool.timed_out',
  'context.compacted', 'context.retrieved',
  'memory.written', 'memory.retrieved',
  'human.requested', 'human.responded', 'human.timed_out',
  'child.spawned', 'child.finished',
  'degraded',
];

// ---------- StateReducer ----------
// Folds events into the projection described in ARCHITECTURE.md 2.2.
export function emptyState(runId) {
  return {
    run_id: runId,
    status: 'pending',
    seq: 0,
    messages: [],
    pending_tool_calls: {},   // tool_call_id -> {name, started_at}
    budget_consumed: { tokens: 0, tool_calls: 0, model_calls: 0 },
    open_human_requests: {},
    children: [],
    degradations: [],
    lease_expires_at: null,
    worker_id: null,
    attempts: 0,
  };
}

export function applyEvent(s, e) {
  const p = e.payload || {};
  s.seq = e.seq;
  switch (e.type) {
    case 'run.created':       s.status = 'pending'; break;
    case 'run.leased':        s.status = 'running'; s.worker_id = p.worker_id;
                              s.lease_expires_at = p.lease_expires_at; s.attempts++; break;
    case 'run.lease_renewed': s.lease_expires_at = p.lease_expires_at; break;
    case 'run.paused':        s.status = 'paused'; s.lease_expires_at = null; s.worker_id = null; break;
    case 'run.resumed':       s.status = 'running'; break;
    case 'run.parked':        s.status = 'parked'; break;
    case 'run.completed':     s.status = 'completed'; break;
    case 'run.failed':        s.status = 'failed'; break;

    case 'turn.started':      s.messages.push({ role: 'user', content: p.input ?? '' }); break;
    case 'turn.finished':     break;

    case 'model.requested':   s.budget_consumed.model_calls++; break;
    case 'model.responded':
      s.budget_consumed.tokens += (p.input_tokens || 0) + (p.output_tokens || 0);
      s.messages.push({ role: 'assistant', content: p.content ?? '', tool_calls: p.tool_calls });
      break;
    case 'model.failed':      break;

    case 'tool.requested':    break;
    case 'tool.authorized':   break;
    case 'tool.denied':
      s.messages.push({ role: 'tool', tool_call_id: p.tool_call_id, content: `[denied] ${p.reason ?? ''}` });
      break;
    case 'tool.escalated':    break;
    case 'tool.started':
      s.pending_tool_calls[p.tool_call_id] = { name: p.name, started_at: e.at };
      s.budget_consumed.tool_calls++;
      break;
    case 'tool.succeeded':
      delete s.pending_tool_calls[p.tool_call_id];
      s.messages.push({ role: 'tool', tool_call_id: p.tool_call_id, content: p.result ?? '' });
      break;
    case 'tool.failed':
    case 'tool.timed_out':
      delete s.pending_tool_calls[p.tool_call_id];
      s.messages.push({ role: 'tool', tool_call_id: p.tool_call_id, content: `[${e.type}] ${p.error ?? ''}` });
      break;

    case 'context.compacted': {
      // replace [from,to) with a summary message
      const { from_seq_index, to_seq_index, summary } = p;
      if (typeof from_seq_index === 'number' && typeof to_seq_index === 'number') {
        const head = s.messages.slice(0, from_seq_index);
        const tail = s.messages.slice(to_seq_index);
        s.messages = [...head, { role: 'system', content: `[compacted] ${summary ?? ''}` }, ...tail];
      }
      break;
    }
    case 'context.retrieved': break;
    case 'memory.written':    break;
    case 'memory.retrieved':  break;

    case 'human.requested':
      s.open_human_requests[p.request_id] = { prompt: p.prompt, created_at: e.at };
      break;
    case 'human.responded':
    case 'human.timed_out':
      delete s.open_human_requests[p.request_id];
      break;

    case 'child.spawned':     s.children.push(p.child_run_id); break;
    case 'child.finished':    break;

    case 'degraded':
      s.degradations.push({ subsystem: p.subsystem, reason: p.reason, at: e.at });
      break;

    default: break; // unknown types are ignored (forward compat probe)
  }
  return s;
}

export function fold(events, base) {
  let s = base ?? emptyState(events.length ? events[0].run_id : null);
  for (let i = 0; i < events.length; i++) s = applyEvent(s, events[i]);
  return s;
}

// ---------- SQLite store ----------
import { DatabaseSync } from 'node:sqlite';

export class SqliteEventStore {
  constructor(path, { wal = true } = {}) {
    this.db = new DatabaseSync(path);
    if (wal) this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL,
        at INTEGER NOT NULL, causation_id TEXT, payload TEXT,
        PRIMARY KEY (run_id, seq)
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        run_id TEXT NOT NULL, seq INTEGER NOT NULL, state TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );`);
    this._ins = this.db.prepare(
      'INSERT INTO events (run_id,seq,type,at,causation_id,payload) VALUES (?,?,?,?,?,?)');
    this._read = this.db.prepare(
      'SELECT run_id,seq,type,at,causation_id,payload FROM events WHERE run_id=? AND seq>? ORDER BY seq');
    this._insSnap = this.db.prepare('INSERT OR REPLACE INTO snapshots (run_id,seq,state) VALUES (?,?,?)');
    this._latestSnap = this.db.prepare(
      'SELECT seq,state FROM snapshots WHERE run_id=? AND seq<=? ORDER BY seq DESC LIMIT 1');
  }
  append(e) {
    this._ins.run(e.run_id, e.seq, e.type, e.at, e.causation_id ?? null,
      e.payload ? JSON.stringify(e.payload) : null);
  }
  appendBatch(evts) {
    this.db.exec('BEGIN');
    try { for (const e of evts) this.append(e); this.db.exec('COMMIT'); }
    catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  readFrom(runId, afterSeq = 0) {
    return this._read.all(runId, afterSeq).map(r => ({
      run_id: r.run_id, seq: r.seq, type: r.type, at: r.at,
      causation_id: r.causation_id, payload: r.payload ? JSON.parse(r.payload) : null,
    }));
  }
  putSnapshot(runId, seq, state) { this._insSnap.run(runId, seq, JSON.stringify(state)); }
  getSnapshot(runId, upToSeq = 1e15) {
    const r = this._latestSnap.get(runId, upToSeq);
    return r ? { seq: r.seq, state: JSON.parse(r.state) } : null;
  }
  // Load state: snapshot (if any) + tail replay
  load(runId, { useSnapshot = true, upToSeq = 1e15 } = {}) {
    let base = null, from = 0;
    if (useSnapshot) {
      const snap = this.getSnapshot(runId, upToSeq);
      if (snap) { base = snap.state; from = snap.seq; }
    }
    const tail = this.readFrom(runId, from).filter(e => e.seq <= upToSeq);
    return fold(tail, base ?? emptyState(runId));
  }
  close() { this.db.close(); }
}

// ---------- Postgres store ----------
export class PgEventStore {
  constructor(client) { this.c = client; }
  async init() {
    await this.c.query(`
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL, seq BIGINT NOT NULL, type TEXT NOT NULL,
        at BIGINT NOT NULL, causation_id TEXT, payload JSONB,
        PRIMARY KEY (run_id, seq));
      CREATE TABLE IF NOT EXISTS snapshots (
        run_id TEXT NOT NULL, seq BIGINT NOT NULL, state JSONB NOT NULL,
        PRIMARY KEY (run_id, seq));`);
  }
  async append(e) {
    await this.c.query('INSERT INTO events (run_id,seq,type,at,causation_id,payload) VALUES ($1,$2,$3,$4,$5,$6)',
      [e.run_id, e.seq, e.type, e.at, e.causation_id ?? null, e.payload ? JSON.stringify(e.payload) : null]);
  }
  async appendBatch(evts) {
    // multi-row insert, one round trip
    const vals = [], params = [];
    evts.forEach((e, i) => {
      const b = i * 6;
      vals.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`);
      params.push(e.run_id, e.seq, e.type, e.at, e.causation_id ?? null,
        e.payload ? JSON.stringify(e.payload) : null);
    });
    await this.c.query(`INSERT INTO events (run_id,seq,type,at,causation_id,payload) VALUES ${vals.join(',')}`, params);
  }
  async readFrom(runId, afterSeq = 0) {
    const { rows } = await this.c.query(
      'SELECT run_id,seq,type,at,causation_id,payload FROM events WHERE run_id=$1 AND seq>$2 ORDER BY seq',
      [runId, afterSeq]);
    return rows.map(r => ({ run_id: r.run_id, seq: Number(r.seq), type: r.type,
      at: Number(r.at), causation_id: r.causation_id, payload: r.payload }));
  }
  async putSnapshot(runId, seq, state) {
    await this.c.query(`INSERT INTO snapshots (run_id,seq,state) VALUES ($1,$2,$3)
      ON CONFLICT (run_id,seq) DO UPDATE SET state=EXCLUDED.state`, [runId, seq, JSON.stringify(state)]);
  }
  async getSnapshot(runId, upToSeq = 1e15) {
    const { rows } = await this.c.query(
      'SELECT seq,state FROM snapshots WHERE run_id=$1 AND seq<=$2 ORDER BY seq DESC LIMIT 1', [runId, upToSeq]);
    return rows.length ? { seq: Number(rows[0].seq), state: rows[0].state } : null;
  }
  async load(runId, { useSnapshot = true, upToSeq = 1e15 } = {}) {
    let base = null, from = 0;
    if (useSnapshot) {
      const snap = await this.getSnapshot(runId, upToSeq);
      if (snap) { base = snap.state; from = snap.seq; }
    }
    const tail = (await this.readFrom(runId, from)).filter(e => e.seq <= upToSeq);
    return fold(tail, base ?? emptyState(runId));
  }
}

// ---------- Synthetic run generator ----------
// Models a realistic agent run: turns of (model call -> k tool calls), with
// occasional compaction, degradation and human pauses.
export function* generateRun(runId, nEvents, { seed = 1, toolResultBytes = 400 } = {}) {
  let rnd = seed;
  const rand = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const bigResult = 'x'.repeat(toolResultBytes);
  let seq = 0, at = 1_700_000_000_000, turn = 0, tc = 0;
  const ev = (type, payload) => ({ run_id: runId, seq: ++seq, type, at: (at += 50), causation_id: null, payload });

  yield ev('run.created', { scope: 'personal:u1', principal: 'u1' });
  yield ev('run.leased', { worker_id: 'w1', lease_expires_at: at + 30000 });
  while (seq < nEvents) {
    turn++;
    yield ev('turn.started', { input: `task step ${turn}` });
    if (seq >= nEvents) break;
    yield ev('model.requested', { model: 'm', messages_count: turn });
    if (seq >= nEvents) break;
    const nTools = 1 + Math.floor(rand() * 3);
    yield ev('model.responded', { content: `thinking ${turn}`, input_tokens: 1200, output_tokens: 180,
      tool_calls: Array.from({ length: nTools }, (_, i) => ({ id: `tc${tc + i}`, name: 'read_file' }) ) });
    for (let i = 0; i < nTools && seq < nEvents; i++) {
      const id = `tc${tc++}`;
      yield ev('tool.requested', { tool_call_id: id, name: 'read_file' });
      if (seq >= nEvents) break;
      yield ev('tool.authorized', { tool_call_id: id });
      if (seq >= nEvents) break;
      yield ev('tool.started', { tool_call_id: id, name: 'read_file' });
      if (seq >= nEvents) break;
      if (rand() < 0.04) yield ev('tool.failed', { tool_call_id: id, error: 'ENOENT' });
      else yield ev('tool.succeeded', { tool_call_id: id, result: bigResult });
    }
    if (seq < nEvents) yield ev('turn.finished', { turn });
    if (turn % 25 === 0 && seq < nEvents)
      yield ev('context.compacted', { from_seq_index: 2, to_seq_index: 10, summary: 'earlier work' });
    if (turn % 40 === 0 && seq < nEvents)
      yield ev('degraded', { subsystem: 'embeddings', reason: 'provider timeout, using fallback' });
    if (turn % 60 === 0 && seq < nEvents) {
      yield ev('human.requested', { request_id: `hr${turn}`, prompt: 'approve rm -rf?' });
      if (seq < nEvents) yield ev('human.responded', { request_id: `hr${turn}`, response: 'deny' });
    }
    if (turn % 10 === 0 && seq < nEvents)
      yield ev('run.lease_renewed', { lease_expires_at: at + 30000 });
  }
}
