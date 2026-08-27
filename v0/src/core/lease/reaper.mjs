// Reaper: reclaim runs whose lease expired (the owning worker died).
// Invariants: never terminalize twice; never steal a live lease; compare-and-set on reclaim
// so two racing reapers cannot both act on the same run.

export function reap(store, { maxAttempts = 5, now = Date.now(), reaperId = 'reaper' } = {}) {
  const stale = store.db.prepare(
    `SELECT id, attempts, lease_token, status FROM runs
      WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`
  ).all(now);

  let requeued = 0, parked = 0, skipped = 0;
  const actions = [];

  for (const r of stale) {
    // Compare-and-set: only act if the lease_token is still the one we observed AND
    // the lease is still expired. A racing reaper or a fresh claim invalidates both.
    const park = Number(r.attempts) >= maxAttempts;
    const applied = store.tx(() => {
      const res = store.db.prepare(
        `UPDATE runs SET status=?, lease_expires_at=NULL, lease_token=NULL, worker_id=NULL
          WHERE id=? AND lease_token IS ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`
      ).run(park ? 'parked' : 'pending', r.id, r.lease_token, now);
      if (res.changes === 0) return false;
      const seq = Number(store.db.prepare('SELECT COALESCE(MAX(seq),0) m FROM events WHERE run_id=?').get(r.id).m) + 1;
      store.db.prepare('INSERT INTO events (run_id,seq,type,at,causation_id,payload) VALUES (?,?,?,?,?,?)')
        .run(r.id, seq, park ? 'run.parked' : 'run.lease_lost', now, null,
             JSON.stringify({ reason: park ? 'max_attempts' : 'lease_expired',
                              attempts: Number(r.attempts), reaper: reaperId }));
      return true;
    });
    if (!applied) { skipped++; continue; }
    park ? parked++ : requeued++;
    actions.push({ run_id: r.id, action: park ? 'parked' : 'requeued', attempts: Number(r.attempts) });
  }
  return { requeued, parked, skipped, actions };
}

/** Expire human requests whose deadline passed; parks the run rather than losing it. */
export function expireHumanRequests(store, { now = Date.now() } = {}) {
  const due = store.db.prepare(
    `SELECT id, run_id FROM human_requests WHERE status='pending' AND expires_at IS NOT NULL AND expires_at <= ?`
  ).all(now);
  for (const hr of due) {
    store.db.prepare(`UPDATE human_requests SET status='expired' WHERE id=?`).run(hr.id);
    store.append(hr.run_id, 'human.timed_out', { request_id: hr.id }, { at: now });
    store.setStatus(hr.run_id, 'parked', { force: true });
    store.append(hr.run_id, 'run.parked', { reason: 'human_request_expired' }, { at: now });
  }
  return { expired: due.length };
}
