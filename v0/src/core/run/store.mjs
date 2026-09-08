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

// ── Schema versioning (W5 / P1) ─────────────────────────────────────────────
//
// Until now the schema was `CREATE TABLE IF NOT EXISTS` and nothing else: a database written by an
// older build was simply opened and used, and a schema change would have silently produced a
// half-shaped database with no way to detect it. That is Invariant 9 — an old log must replay
// under a new build — resting on nothing but the schema never changing.
//
// SQLite's own `user_version` pragma is the version store: it costs no table, it is atomic with
// the file, and it is readable by any SQLite tool if this runtime is ever unavailable.
//
// RULES, so a future migration cannot quietly break an existing database:
//   1. Migrations are FORWARD-ONLY and applied in order, each inside one transaction.
//   2. A migration NEVER rewrites or deletes an event. The log is the authority; a migration may
//      add tables, columns or indexes around it.
//   3. Opening a database from a NEWER build than this one is refused loudly rather than guessed
//      at — a downgrade that silently ignores unknown columns is how data is lost.
export const SCHEMA_VERSION = 1;

/**
 * Ordered forward migrations. Index i upgrades a database at version i to version i+1.
 *
 * v0 -> v1 is deliberately a no-op: every database written before this wave already has the
 * v1 shape (that is what SCHEMA creates), so the only thing to do is stamp it. Recording it as a
 * real migration rather than special-casing "unversioned" means the runner has exactly one code
 * path, and the first genuine schema change is an ordinary entry rather than a new mechanism.
 */
const MIGRATIONS = [
  { to: 1, name: 'baseline', apply: (_db) => { /* shape already created by SCHEMA */ } },
];

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
    this.#migrate();
    this.#prepare();
  }

  /**
   * Bring the database to SCHEMA_VERSION (W5 / P1).
   *
   * Runs before anything is prepared, so a migration can change shape that prepared statements
   * would otherwise have bound to. Each step is its own transaction: a crash between two
   * migrations leaves the database at the last COMPLETED version rather than half-way through one.
   */
  #migrate() {
    const current = Number(this.db.prepare('PRAGMA user_version').get().user_version ?? 0);

    if (current > SCHEMA_VERSION) {
      // Refuse rather than guess. A newer database opened by an older build would appear to work
      // while ignoring columns it cannot see — the failure mode that loses data quietly.
      throw new Error(
        `database schema v${current} is newer than this build supports (v${SCHEMA_VERSION}). `
        + 'Upgrade @kernlbase/orion, or point ORION_HOME at a different database.');
    }
    if (current === SCHEMA_VERSION) return;

    for (const m of MIGRATIONS) {
      if (m.to <= current) continue;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        m.apply(this.db);
        // PRAGMA does not accept a bound parameter; `m.to` is an integer literal from this file,
        // never user input.
        this.db.exec(`PRAGMA user_version=${Number(m.to)}`);
        this.db.exec('COMMIT');
      } catch (err) {
        try { this.db.exec('ROLLBACK'); } catch { /* the failure below is the real one */ }
        throw new Error(`schema migration to v${m.to} (${m.name}) failed: ${err?.message ?? err}`);
      }
    }
  }

  /** The schema version this database is currently at. */
  schemaVersion() {
    return Number(this.db.prepare('PRAGMA user_version').get().user_version ?? 0);
  }

  #prepare() {
    const d = this.db;
    this._maxSeq   = d.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM events WHERE run_id=?');
    this._insEvent = d.prepare('INSERT INTO events (run_id,seq,type,at,causation_id,payload) VALUES (?,?,?,?,?,?)');
    this._readFrom = d.prepare('SELECT seq,type,at,causation_id,payload FROM events WHERE run_id=? AND seq>? AND seq<=? ORDER BY seq');
    this._putSnap  = d.prepare('INSERT OR REPLACE INTO snapshots (run_id,seq,state) VALUES (?,?,?)');
    this._getSnap  = d.prepare('SELECT seq,state FROM snapshots WHERE run_id=? AND seq<=? ORDER BY seq DESC LIMIT 1');
    this._getRun   = d.prepare('SELECT * FROM runs WHERE id=?');

    // W5 / S1: statements for the operations that used to be raw SQL in the reaper and in fork.
    this._selStale = d.prepare(
      `SELECT id, attempts, lease_token, status FROM runs
        WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`);
    this._reclaim = d.prepare(
      `UPDATE runs SET status=?, lease_expires_at=NULL, lease_token=NULL, worker_id=NULL
        WHERE id=? AND lease_token IS ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`);
    this._selDueHr = d.prepare(
      `SELECT id, run_id FROM human_requests
        WHERE status='pending' AND expires_at IS NOT NULL AND expires_at <= ?`);
    this._expireHr = d.prepare(`UPDATE human_requests SET status='expired' WHERE id=?`);
    this._setStatusUnfenced = d.prepare('UPDATE runs SET status=? WHERE id=?');
    this._insRunFull = d.prepare(
      `INSERT INTO runs (id,parent_run_id,forked_from_seq,scope,principal,status,attempts,created_at,task)
       VALUES (?,?,?,?,?,?,?,?,?)`);
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
    // node:sqlite types every column as SQLOutputValue; the schema guarantees TEXT here.
    return r ? { seq: Number(r.seq), state: JSON.parse(String(r.state)) } : null;
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
      if (!force && TERMINAL.has(String(r.status))) return false;     // never terminalize twice
      if (!force && leaseToken !== null && !this.#leaseIsLive(runId, leaseToken)) return false; // fencing
      const fenced = !force && leaseToken !== null;
      const sql = releaseLease
        ? `UPDATE runs SET status=?, lease_expires_at=NULL, lease_token=NULL, worker_id=NULL WHERE id=?${fenced ? ' AND lease_token=? AND lease_expires_at>?' : ''}`
        : `UPDATE runs SET status=? WHERE id=?${fenced ? ' AND lease_token=? AND lease_expires_at>?' : ''}`;
      // X7: this was a ternary on `releaseLease` whose two branches were byte-identical. The
      // argument list depends only on whether the statement is fenced.
      const args = fenced ? [status, runId, leaseToken, Date.now()] : [status, runId];
      return this.db.prepare(sql).run(...args).changes > 0;
    });
  }

  // ── Store boundary (W5 / S1-S3, R1-R4) ────────────────────────────────────
  //
  // These exist so no caller needs `store.db`. Before this wave the reaper and `fork` reached
  // past the Store and issued raw SQL — including two `INSERT INTO events` that bypassed
  // `isKnownType()` entirely, so the "closed vocabulary" could be broken by any caller willing to
  // write SQL. Proven: a raw insert of `totally.made.up` was accepted and read back.
  //
  // Invariant 1 says `Store.append` is the ONLY mutation path. A guard that a caller can step
  // around is not a guard, and moving these inside also puts storage behind one seam — the
  // precondition for a non-SQLite backend later without touching three modules (S3).

  /** Runs whose lease has expired and which are therefore reclaimable. */
  staleRuns({ now = Date.now() } = {}) {
    return this._selStale.all(now);
  }

  /**
   * Reclaim ONE stale run and record why, atomically (R1/R4).
   *
   * Compare-and-set on the observed lease token: a racing reaper or a fresh claim invalidates it,
   * so two reapers cannot both act. The status change and its event commit together — a crash
   * between them would leave a run reclaimed with no record of why, which `explain` could not
   * narrate.
   */
  /**
   * @param {string} runId
   * @param {{ observedLeaseToken?: string|null, status: string, type: string,
   *           payload?: any, now?: number }} opts
   */
  reclaimStale(runId, { observedLeaseToken, status, type, payload, now = Date.now() } = /** @type {any} */ ({})) {
    if (!isKnownType(type)) throw new UnknownEventType(type);
    const json = payload == null ? null : JSON.stringify(payload);
    return this.tx(() => {
      const changed = this._reclaim.run(status, runId, observedLeaseToken, now).changes;
      if (changed === 0) return false;
      const seq = Number(this._maxSeq.get(runId).m) + 1;
      this._insEvent.run(runId, seq, type, now, null, json);
      return true;
    });
  }

  /** Human requests whose deadline has passed. */
  dueHumanRequests({ now = Date.now() } = {}) {
    return this._selDueHr.all(now);
  }

  /**
   * Expire one human request and park its run — as ONE transaction (R1/R2).
   *
   * This was four writes across three transactions, so a crash mid-way could expire the request
   * without parking the run, or park it with no `run.parked` event. It also used
   * `setStatus(..., {force:true})`, which skips the terminal guard: a run that had already
   * completed could be forced back to `parked` (R2). Terminal is now respected — a finished run
   * is left alone and the caller is told, rather than silently rewritten.
   */
  expireHumanRequest(requestId, runId, { now = Date.now() } = {}) {
    return this.tx(() => {
      const r = this._getRun.get(runId);
      if (!r) return { expired: false, parked: false, reason: 'no such run' };

      this._expireHr.run(requestId);
      let seq = Number(this._maxSeq.get(runId).m) + 1;
      this._insEvent.run(runId, seq, 'human.timed_out', now, null,
                         JSON.stringify({ request_id: requestId }));

      // R2: never rewrite a terminal run. The request genuinely expired and that is recorded;
      // the run's outcome stands.
      if (TERMINAL.has(String(r.status))) return { expired: true, parked: false, reason: `run already ${r.status}` };

      this._setStatusUnfenced.run('parked', runId);
      this._insEvent.run(runId, seq + 1, 'run.parked', now, null,
                         JSON.stringify({ reason: 'human_request_expired' }));
      return { expired: true, parked: true, reason: null };
    });
  }

  /**
   * Create a forked run and copy its inherited history, atomically (S1/S2).
   *
   * `fork` previously issued its own INSERTs, including into `events` — the second bypass of the
   * closed vocabulary. Copied events are re-validated here: history that could not be written
   * today must not become writable by being copied.
   */
  createForkedRun(newRunId, source, events) {
    return this.tx(() => {
      this._insRunFull.run(newRunId, source.parent_run_id ?? null, source.forked_from_seq ?? null,
        source.scope, source.principal, 'pending', 0, Date.now(), source.task ?? null);
      for (const e of events) {
        if (!isKnownType(e.type)) throw new UnknownEventType(e.type);
        this._insEvent.run(newRunId, e.seq, e.type, e.at, e.causation_id ?? null,
          e.payload == null ? null : JSON.stringify(e.payload));
      }
      return newRunId;
    });
  }

  /** `PRAGMA integrity_check` — exposed so the CLI's doctor need not reach for `store.db`. */
  integrityOk() {
    try { this.db.exec('PRAGMA integrity_check'); return true; } catch { return false; }
  }

  /**
   * W6 M — every `grant.*` event, across ALL runs, oldest first.
   *
   * A project-scoped approval has to outlive the run that recorded it, and events are per-run.
   * The alternative designs were both worse: a `grants` table would be state beside the log
   * (Invariant 1, and a replayed run could then reach a different authorization decision than
   * the original), and folding every run's full event list would make an authorization check
   * cost the whole database.
   *
   * So this is a cross-run QUERY over the grant events themselves — an index INTO the log, not a
   * second copy of it. The events stay the only source of truth; `projectGrants` folds whatever
   * this returns. It lives here because `Store` is the only path to the database (W5 S1/S2), and
   * a grant subsystem reaching for `store.db` would reopen exactly the boundary W5 closed.
   *
   * `project` filters in SQL on the payload rather than in JS over every row, because the common
   * call is "the grants for this directory" on a database holding every run ever.
   */
  grantEvents({ project = null, limit = 5_000 } = {}) {
    const rows = project === null
      ? this.db.prepare(
          `SELECT run_id, seq, type, at, payload FROM events
            WHERE type LIKE 'grant.%' ORDER BY at ASC, seq ASC LIMIT ?`).all(limit)
      : this.db.prepare(
          // A revoke carries only the grant_id, so it has no project to match on. Filtering it
          // out here would let a revoked grant come back to life whenever the query is scoped —
          // which is the one thing a revocation must never do.
          `SELECT run_id, seq, type, at, payload FROM events
            WHERE type LIKE 'grant.%'
              AND (type = 'grant.revoked' OR json_extract(payload, '$.project') IS ?
                   OR json_extract(payload, '$.project') = ?)
            ORDER BY at ASC, seq ASC LIMIT ?`).all(null, project, limit);

    return rows.map(r => ({
      run_id: String(r.run_id), seq: Number(r.seq), type: String(r.type), at: Number(r.at),
      payload: r.payload == null ? null : JSON.parse(String(r.payload)),
    }));
  }

  /** Atomically append a terminal/pause event and update the run under one live lease. */
  /**
   * @param {string} runId @param {string} type @param {any} payload @param {string} status
   * @param {{ leaseToken?: string|null, releaseLease?: boolean,
   *           causationId?: string|null, at?: number }} [opts]
   */
  appendStatus(runId, type, payload, status,
    { leaseToken, releaseLease = true, causationId = null, at = Date.now() } = {}) {
    if (!isKnownType(type)) throw new UnknownEventType(type);
    const json = payload == null ? null : JSON.stringify(payload);
    return this.tx(() => {
      if (!this.#leaseIsLive(runId, leaseToken)) return false;
      const r = this._getRun.get(runId);
      if (!r || TERMINAL.has(String(r.status))) return false;
      const next = releaseLease
        ? this.db.prepare(`UPDATE runs SET status=?, lease_expires_at=NULL, lease_token=NULL, worker_id=NULL
                           WHERE id=? AND lease_token=? AND lease_expires_at>?`)
        : this.db.prepare(`UPDATE runs SET status=? WHERE id=? AND lease_token=? AND lease_expires_at>?`);
      // X7: likewise byte-identical branches. appendStatus is always fenced.
      const changed = next.run(status, runId, leaseToken, Date.now()).changes;
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
