// Durable store: events, snapshots, runs, human requests.
// Invariant (Phase B): one run has ONE monotonically increasing event sequence.
// Enforced by PRIMARY KEY (run_id, seq) plus server-side seq allocation inside a
// single IMMEDIATE transaction, so concurrent appends cannot interleave a gap or duplicate.

import { DatabaseSync } from 'node:sqlite';
import { isKnownType, UnknownEventType, TERMINAL } from '../event/index.mjs';
import crypto from 'node:crypto';

export const uid = (p = 'run') => `${p}_${crypto.randomBytes(5).toString('hex')}`;

export class LeaseLostError extends Error {
  constructor(runId) {
    super(`lease lost for run: ${runId}`);
    this.name = 'LeaseLostError';
    this.runId = runId;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  causation_id TEXT,
  payload TEXT,
  PRIMARY KEY (run_id, seq)
) STRICT;

CREATE TABLE IF NOT EXISTS snapshots (
  run_id TEXT NOT NULL, seq INTEGER NOT NULL, state TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
) STRICT;

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  parent_run_id TEXT,
  forked_from_seq INTEGER,
  scope TEXT NOT NULL,
  principal TEXT NOT NULL,
  status TEXT NOT NULL,
  lease_expires_at INTEGER,
  lease_token TEXT,
  worker_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  task TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS human_requests (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, prompt TEXT NOT NULL, options TEXT,
  status TEXT NOT NULL, response TEXT, created_at INTEGER NOT NULL, expires_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS runs_claimable ON runs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS hr_by_run ON human_requests(run_id, status);
`;

export class Store {
  /** @param {string} dbPath  @param {{durability?:'full'|'normal'}} opts */
  constructor(dbPath, { durability = 'full' } = {}) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    // The log is the source of truth: default to FULL so a committed event survives power loss.
    this.db.exec(`PRAGMA synchronous=${durability === 'full' ? 'FULL' : 'NORMAL'}`);
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec('PRAGMA busy_timeout=5000');
    this.db.exec(SCHEMA);
    this.#prepare();
  }

  #prepare() {
    const d = this.db;
    this._maxSeq   = d.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM events WHERE run_id=?');
    this._insEvent = d.prepare('INSERT INTO events (run_id,seq,type,at,causation_id,payload) VALUES (?,?,?,?,?,?)');
    this._readFrom = d.prepare('SELECT seq,type,at,causation_id,payload FROM events WHERE run_id=? AND seq>? AND seq<=? ORDER BY seq');
    this._putSnap  = d.prepare('INSERT OR REPLACE INTO snapshots (run_id,seq,state) VALUES (?,?,?)');
    this._getSnap  = d.prepare('SELECT seq,state FROM snapshots WHERE run_id=? AND seq<=? ORDER BY seq DESC LIMIT 1');
    this._getRun   = d.prepare('SELECT * FROM runs WHERE id=?');
  }

  // ---------------------------------------------------------------- events
  /**
   * Append one event. Seq is allocated server-side inside an IMMEDIATE transaction so that
   * two concurrent appenders can never receive the same seq or leave a gap.
   * Returns the allocated seq.
   */
  append(runId, type, payload = null,
    { causationId = null, at = Date.now(), leaseToken = null } = {}) {
    if (!isKnownType(type)) throw new UnknownEventType(type);   // closed vocabulary (ADR-004)
    let json = null;
    if (payload !== null && payload !== undefined) {
      json = JSON.stringify(payload);
      if (json === undefined) throw new TypeError('event payload is not JSON-serialisable');
    }
    return this.tx(() => {
      if (leaseToken !== null && !this.#leaseIsLive(runId, leaseToken))
        throw new LeaseLostError(runId);
      const seq = Number(this._maxSeq.get(runId).m) + 1;
      this._insEvent.run(runId, seq, type, at, causationId, json);
      return seq;
    });
  }

  /** Append several events atomically (all-or-nothing), preserving order. */
  appendMany(runId, entries) {
    for (const e of entries) if (!isKnownType(e.type)) throw new UnknownEventType(e.type);
    return this.tx(() => {
      let seq = Number(this._maxSeq.get(runId).m);
      const out = [];
      for (const e of entries) {
        seq += 1;
        this._insEvent.run(runId, seq, e.type, e.at ?? Date.now(), e.causationId ?? null,
          e.payload == null ? null : JSON.stringify(e.payload));
        out.push(seq);
      }
      return out;
    });
  }

  events(runId, afterSeq = 0, upToSeq = Number.MAX_SAFE_INTEGER) {
    return this._readFrom.all(runId, afterSeq, upToSeq).map(rowToEvent);
  }

  lastSeq(runId) { return Number(this._maxSeq.get(runId).m); }

  // ------------------------------------------------------------- snapshots
  putSnapshot(runId, seq, state) { this._putSnap.run(runId, seq, JSON.stringify(state)); }
  getSnapshot(runId, upToSeq = Number.MAX_SAFE_INTEGER) {
    const r = this._getSnap.get(runId, upToSeq);
    return r ? { seq: Number(r.seq), state: JSON.parse(r.state) } : null;
  }

  // ------------------------------------------------------------------ runs
  createRun(runId, { scope = 'personal:local', principal = 'local', parent = null,
                     forkedFromSeq = null, task = null } = {}) {
    this.db.prepare(`INSERT INTO runs (id,parent_run_id,forked_from_seq,scope,principal,status,attempts,created_at,task)
                     VALUES (?,?,?,?,?,'pending',0,?,?)`)
      .run(runId, parent, forkedFromSeq, scope, principal, Date.now(), task);
    this.append(runId, 'run.created', { scope, principal, parent, forked_from_seq: forkedFromSeq, task });
    return runId;
  }

  run(runId) { const r = this._getRun.get(runId); return r ? normaliseRun(r) : null; }

  listRuns({ limit = 50 } = {}) {
    return this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?').all(limit).map(normaliseRun);
  }

  // ---------------------------------------------------------------- leases
  /**
   * Claim one runnable run. Returns {runId, leaseToken} or null.
   * A lease token fences the owner: every later write checks it, so a worker that
   * lost its lease (expiry + reclaim) cannot overwrite the new owner's state.
   */
  claim(workerId, { leaseMs = 30_000, runId = null, now = Date.now() } = {}) {
    return this.tx(() => {
      // 'paused' IS claimable:
      //  - targeted (runId given) => the caller is explicitly resuming, e.g. `orionctl resume`.
      //  - untargeted (queue scan) => only once a human has actually answered, otherwise a
      //    generic worker would pick up a run that is still waiting on a person.
      // Regression: excluding 'paused' entirely made every escalated run unresumable.
      const row = runId
        ? this.db.prepare(`SELECT id FROM runs WHERE id=? AND status IN ('pending','running','paused')
                             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`).get(runId, now)
        : this.db.prepare(`SELECT id FROM runs r WHERE
                             (lease_expires_at IS NULL OR lease_expires_at <= ?)
                             AND ( r.status IN ('pending','running')
                                OR ( r.status = 'paused'
                                     AND EXISTS (SELECT 1 FROM human_requests h
                                                 WHERE h.run_id = r.id AND h.status = 'answered') ) )
                           ORDER BY created_at LIMIT 1`).get(now);
      if (!row) return null;
      const token = crypto.randomBytes(8).toString('hex');
      this.db.prepare(`UPDATE runs SET status='running', worker_id=?, lease_token=?, lease_expires_at=?,
                         attempts=attempts+1 WHERE id=?`)
        .run(workerId, token, now + leaseMs, row.id);
      const seq = Number(this._maxSeq.get(row.id).m) + 1;
      this._insEvent.run(row.id, seq, 'run.leased', now, null,
        JSON.stringify({ worker_id: workerId, lease_expires_at: now + leaseMs }));
      return { runId: row.id, leaseToken: token };
    });
  }

  /** Renew. Returns false if the lease was lost (someone else owns it now). */
  renew(runId, leaseToken, { leaseMs = 30_000, now = Date.now() } = {}) {
    return this.tx(() => {
      const res = this.db.prepare('UPDATE runs SET lease_expires_at=? WHERE id=? AND lease_token=? AND lease_expires_at>?')
        .run(now + leaseMs, runId, leaseToken, now);
      if (res.changes === 0) return false;
      const seq = Number(this._maxSeq.get(runId).m) + 1;
      this._insEvent.run(runId, seq, 'run.lease_renewed', now, null,
        JSON.stringify({ lease_expires_at: now + leaseMs }));
      return true;
    });
  }

  holdsLease(runId, leaseToken, { now = Date.now() } = {}) {
    const r = this._getRun.get(runId);
    return !!r && r.lease_token === leaseToken && r.lease_expires_at !== null && Number(r.lease_expires_at) > now;
  }

  releaseLease(runId, leaseToken) {
    return this.db.prepare('UPDATE runs SET lease_expires_at=NULL, lease_token=NULL, worker_id=NULL WHERE id=? AND lease_token=?')
      .run(runId, leaseToken).changes > 0;
  }

  /**
   * Fenced status write. Returns false when the caller no longer owns the lease,
   * or when the run is already terminal (prevents double-terminalization).
   */
  setStatus(runId, status, { leaseToken = null, releaseLease = false, force = false } = {}) {
    return this.tx(() => {
      const r = this._getRun.get(runId);
      if (!r) return false;
      if (!force && TERMINAL.has(r.status)) return false;             // never terminalize twice
      if (!force && leaseToken !== null && !this.#leaseIsLive(runId, leaseToken)) return false; // fencing
      const fenced = !force && leaseToken !== null;
      const sql = releaseLease
        ? `UPDATE runs SET status=?, lease_expires_at=NULL, lease_token=NULL, worker_id=NULL WHERE id=?${fenced ? ' AND lease_token=? AND lease_expires_at>?' : ''}`
        : `UPDATE runs SET status=? WHERE id=?${fenced ? ' AND lease_token=? AND lease_expires_at>?' : ''}`;
      const args = releaseLease
        ? (fenced ? [status, runId, leaseToken, Date.now()] : [status, runId])
        : (fenced ? [status, runId, leaseToken, Date.now()] : [status, runId]);
      return this.db.prepare(sql).run(...args).changes > 0;
    });
  }

  /** Atomically append a terminal/pause event and update the run under one live lease. */
  appendStatus(runId, type, payload, status,
    { leaseToken, releaseLease = true, causationId = null, at = Date.now() } = {}) {
    if (!isKnownType(type)) throw new UnknownEventType(type);
    const json = payload == null ? null : JSON.stringify(payload);
    return this.tx(() => {
      if (!this.#leaseIsLive(runId, leaseToken)) return false;
      const r = this._getRun.get(runId);
      if (!r || TERMINAL.has(r.status)) return false;
      const next = releaseLease
        ? this.db.prepare(`UPDATE runs SET status=?, lease_expires_at=NULL, lease_token=NULL, worker_id=NULL
                           WHERE id=? AND lease_token=? AND lease_expires_at>?`)
        : this.db.prepare(`UPDATE runs SET status=? WHERE id=? AND lease_token=? AND lease_expires_at>?`);
      const changed = next.run(...(releaseLease
        ? [status, runId, leaseToken, Date.now()]
        : [status, runId, leaseToken, Date.now()])).changes;
      if (changed === 0) return false;
      const seq = Number(this._maxSeq.get(runId).m) + 1;
      this._insEvent.run(runId, seq, type, at, causationId, json);
      return seq;
    });
  }

  // ------------------------------------------------------- human requests
  createHumanRequest(runId, prompt, { options = null, expiresAt = null, id = uid('hr') } = {}) {
    this.db.prepare(`INSERT INTO human_requests (id,run_id,prompt,options,status,created_at,expires_at)
                     VALUES (?,?,?,?,'pending',?,?)`)
      .run(id, runId, prompt, options ? JSON.stringify(options) : null, Date.now(), expiresAt);
    return id;
  }
  answerHumanRequest(id, response) {
    return this.db.prepare(`UPDATE human_requests SET status='answered', response=? WHERE id=? AND status='pending'`)
      .run(response, id).changes > 0;
  }
  humanRequests(runId, status = null) {
    return status
      ? this.db.prepare('SELECT * FROM human_requests WHERE run_id=? AND status=?').all(runId, status)
      : this.db.prepare('SELECT * FROM human_requests WHERE run_id=?').all(runId);
  }
  consumeHumanRequest(id) {
    this.db.prepare(`UPDATE human_requests SET status='consumed' WHERE id=?`).run(id);
  }

  // ------------------------------------------------------------------ misc
  #leaseIsLive(runId, leaseToken, now = Date.now()) {
    const r = this._getRun.get(runId);
    return !!r && r.lease_token === leaseToken && r.lease_expires_at !== null && Number(r.lease_expires_at) > now;
  }

  /** IMMEDIATE so writers serialise at BEGIN, not at first write (avoids upgrade deadlocks). */
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch {} throw e; }
  }
  close() { try { this.db.close(); } catch {} }
}

function rowToEvent(r) {
  return { seq: Number(r.seq), type: r.type, at: Number(r.at),
           causation_id: r.causation_id, payload: r.payload ? JSON.parse(r.payload) : null };
}
function normaliseRun(r) {
  return { ...r,
    forked_from_seq: r.forked_from_seq === null ? null : Number(r.forked_from_seq),
    lease_expires_at: r.lease_expires_at === null ? null : Number(r.lease_expires_at),
    attempts: Number(r.attempts), created_at: Number(r.created_at) };
}
