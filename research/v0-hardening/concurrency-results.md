# Concurrency and Lease Results — Phase C

Source: `v0/tests/concurrency/lease.test.mjs` — **45 assertions, 45 pass.**
This closes the largest technical gap carried into this phase: the previous phase's
`ARCHITECTURE-REVISION.md` listed multi-worker contention as *"argued, not demonstrated."*

## Invariants under test

| ID | Invariant | Status |
|---|---|---|
| I1 | At most one active worker owns a run | **HOLDS** |
| I2 | No run is lost | **HOLDS** |
| I3 | No run is terminalized twice | **HOLDS** |
| I4 | A stale worker cannot overwrite the current owner | **HOLDS** |
| I5 | Reclaim is compare-and-set safe | **HOLDS** |

## Mechanism

Two things do the work, and both are needed:

1. **Atomic claim.** `BEGIN IMMEDIATE` + a single `UPDATE` that sets `status`, `worker_id`,
   `lease_token` and `lease_expires_at` together. Writers serialise at `BEGIN`, not at first write,
   which avoids lock-upgrade deadlocks.
2. **Lease tokens (fencing).** Every claim mints a fresh random token. Every subsequent write —
   `renew`, `setStatus` — is conditional on that token. A worker that lost its lease writes nothing.

Fencing is what makes the difference between "usually fine" and correct. Without it, a worker that
stalls past its lease and then wakes up will happily terminalize a run another worker now owns.

## Scenarios

| scenario | result |
|---|---|
| A claims; B attempts the same run | B blocked |
| A's lease expires; B reclaims | B succeeds, new token, A's token invalid |
| A renews near expiry | keeps the lease; B still blocked |
| **A writes after losing the lease** | `renew` → `false`; `setStatus` → `false`; run untouched |
| Terminalize twice | second attempt refused; a completed run is not claimable |
| Worker dies during renewal | reaper requeues; `run.lease_lost` recorded with attempt count |
| Worker dies immediately after claim | reclaimable; `attempts` correctly = 2 |
| **Two reapers race** (20 runs, same instant) | first requeues 20, second requeues 0, **zero double `lease_lost`** |
| Human request expiry | run **parked**, not lost; `human.timed_out` recorded |

## Multi-process claim storm

6 OS processes, 30 runs, each process claiming until the queue drains:

```
all claim workers exited 0                         0,0,0,0,0,0
every run was claimed at least once                30/30
no run was claimed twice concurrently              30 claims for 30 runs
I2 no run was lost — all reached a terminal state  30/30 completed
I3 no run completed twice                          0
every run log is gapless                           true
```

**30 claims for 30 runs** is the headline: six processes racing on one SQLite file produced exactly
one claim per run.

## Randomized soak

400 randomized steps over 40 runs, interleaving claim / renew / terminalize / reap with random
sleeps:

```
I1 no concurrent double-ownership observed   0 violations
I3 no run terminalized twice                 0
I2 no run stranded beyond reaper reach       0
```

## Concurrent append (Phase B, related)

4 OS processes x 40 appends to the **same run**:

```
every process got a seq for every append     160
no two processes were given the same seq     160 unique of 160
log gapless after concurrent writes          true
```

Sequence numbers are allocated server-side inside the same transaction as the insert, so two
appenders cannot receive the same `seq` or leave a gap.

## Limits

1. **SQLite on one machine.** Postgres and true multi-host contention are untested. The primitives
   (`BEGIN IMMEDIATE` ↔ `FOR UPDATE SKIP LOCKED`, advisory locks) map cleanly, but that is an
   argument, not a measurement.
2. **`busy_timeout=5000`.** Under heavier contention than tested, claims would start timing out;
   the failure mode (a claim returning null) is safe but unmeasured at scale.
3. **Wall-clock leases.** Clock skew across hosts would break the expiry assumption. Single-host
   only in V0.
4. **The reaper is called explicitly** (CLI `reap`, or by tests). V0 has no background reaper daemon.
