# Replay and Fork Across the Boundary (§15)

Suite: `v0/tests/escalationgate/escalation-lifecycle.test.mjs`.

## Results

```
replay reproduces the paused state          ok
replay is deterministic across the boundary ok      (open_human_requests identical)
replay made zero model calls                ok      (structurally 0)
escalation IS in the durable event history  ok
fork before escalation is not paused        ok      child status = running
parent remains paused                       ok
```

## Where the escalation state lives

**In the durable event history**, as ordinary events:

```
tool.escalated → human.requested → run.paused
```

No parallel state store, no side table, no projection field was added. §15 asked whether the
verification metadata belongs in the event, the projection, or a recovery journal — the answer is
that it already belongs in the **event log**, and reusing it means replay and fork required no
changes at all.

## Fork semantics are intact

Forking at `escalationSeq - 1` produces a child in `running` state: the child does **not** inherit
the pause, because the events that caused it are after the fork point. The parent stays paused.

That is the correct behaviour, and it is a useful property — a fork before the boundary is exactly
how one would explore an alternative strategy that avoids the protected artifact entirely.

## Regression

`replay/semantics` (44) and `fencing/fencing` (29) both unchanged. Full suite 441 → **501 passed,
0 failed across 19 suites**.
