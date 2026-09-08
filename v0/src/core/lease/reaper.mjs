// Reaper: reclaim runs whose lease expired (the owning worker died).
//
// Invariants: never terminalize twice; never steal a live lease; compare-and-set on reclaim so two
// racing reapers cannot both act on the same run.
//
// W5 (S1/S2/R1-R4): this module used to issue six raw SQL statements against `store.db`, two of
// them `INSERT INTO events` that bypassed `isKnownType()` — so the closed vocabulary could be
// broken by anyone willing to write SQL. It now goes through the Store, which is Invariant 1
// ("Store.append is the only mutation path") holding in fact rather than by convention.

export function reap(store, { maxAttempts = 5, now = Date.now(), reaperId = 'reaper' } = {}) {
  const stale = store.staleRuns({ now });

  let requeued = 0, parked = 0, skipped = 0;
  const actions = [];

  for (const r of stale) {
    const park = Number(r.attempts) >= maxAttempts;
    // One transaction: the status change and the event that explains it commit together. A crash
    // between them would leave a run reclaimed with no record of why, which `explain` could not
    // narrate — and an unexplainable reclaim is indistinguishable from a lost run.
    const applied = store.reclaimStale(r.id, {
      observedLeaseToken: r.lease_token,
      status: park ? 'parked' : 'pending',
      type: park ? 'run.parked' : 'run.lease_lost',
      payload: { reason: park ? 'max_attempts' : 'lease_expired',
                 attempts: Number(r.attempts), reaper: reaperId },
      now,
    });
    if (!applied) { skipped++; continue; }
    park ? parked++ : requeued++;
    actions.push({ run_id: r.id, action: park ? 'parked' : 'requeued', attempts: Number(r.attempts) });
  }
  return { requeued, parked, skipped, actions };
}

/**
 * Expire human requests whose deadline passed; park the run rather than losing it.
 *
 * R1: this was four writes across three transactions, so a crash mid-sequence could expire the
 * request without parking the run, or park it with no `run.parked` event to explain the park.
 * It is now one atomic call per request.
 *
 * R2: it also used `setStatus(..., { force: true })`, which skips the "never terminalize twice"
 * guard — so an already-completed run could be forced back to `parked` by a late timeout. The
 * Store now refuses that: the expiry is still recorded, and the run's outcome stands.
 */
export function expireHumanRequests(store, { now = Date.now() } = {}) {
  const due = store.dueHumanRequests({ now });
  let parked = 0, skippedTerminal = 0;
  for (const hr of due) {
    const r = store.expireHumanRequest(hr.id, hr.run_id, { now });
    if (r.parked) parked++;
    else if (r.expired) skippedTerminal++;
  }
  return { expired: due.length, parked, skippedTerminal };
}
