# Resume After Enforced Escalation (§13)

Suite: `v0/tests/escalationgate/escalation-lifecycle.test.mjs`.

## The full cycle

```
run paused awaiting a human                 ok
a pending human request exists              ok      (status 'pending')
human answers 'deny'
paused run is claimable (lease released)    ok
resumed -> completed/model_finished
run resumes and completes                   ok
the SOURCE was fixed                        ok      src/a.js 41 -> 42
the protected test is STILL unchanged       ok
```

## What this demonstrates

1. **The lease really is released.** A second worker (`w2`) claimed the paused run — not a
   simulation, an actual `store.claim()`.
2. **The existing lifecycle was reused** (§13). No second pause/resume mechanism was invented;
   this is the same `run.paused` → claim → continue path the runtime already had for `ask_user`
   and ambiguous recovery.
3. **Denial is productive, not terminal.** The human denied the test edit; the resumed agent then
   fixed the *source* — which was the correct fix all along — and completed successfully.

That last point matters for the product argument. The gate does not merely block a bad action; it
redirects the run toward the legitimate one while keeping the human in control of the boundary.

## Not tested here

Approval (`approve`) resuming into the *forbidden* action. The `human.responded` path exists and
is exercised elsewhere in the recovery suites, but the approve-then-mutate flow for
`protectedPaths` specifically was not run and is not claimed.
