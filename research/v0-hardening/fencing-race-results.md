# Fencing Race Results

## Pre-fix probe

The focused probe was run before changing the implementation:

```text
fencing unfixed probe: 9 passed, 0 failed (9 assertions)
Worker B reclaimed the run
stale Worker A can append despite passing its old token
expired owner can terminalize before the reaper clears its token
B owns the run before A resumes
stale A completed its model call
stale A performed the real file write
stale A appended post-reclaim execution events
stale A could not update the runs row after B reclaimed it
stale A nevertheless appended a terminal event
```

This is a confirmed vulnerability, not a static suspicion. The stale worker produced a real file
effect and authoritative-looking events after Worker B owned the Run. Store-level status fencing
prevented the stale worker from changing the `runs` row after B reclaimed it, but that was too late:
the tool effect and event appends had already happened.

The focused probe also confirmed a second race: if the lease expired but the reaper had not yet
cleared the token, `setStatus(..., leaseToken: A)` accepted the expired token because it checked
token identity but not expiry.

## Randomized probe

The post-fix 100-iteration race uses a new SQLite database and workspace, a controlled slow model,
lease expiry, reaper reclaim, a new Worker B claim, and a real filesystem write attempted by stale
Worker A. Its exact results are recorded below.

## Post-fix results

Focused regression: `node tests/fencing/fencing.test.mjs` — **29 passed, 0 failed**.

The reclaim-before-resume race ran 100 times with randomized lease durations and delays:

```text
effects=0, post-reclaim events=0, stale terminals=0,
ownership conflicts=0, unexpected worker results=0
```

The worst-boundary race also ran 100 times. It deliberately reclaimed the run after the final
lease assertion and immediately before `tool.run()`:

```text
in-flight external effects=100,
post-reclaim authoritative events=0,
post-reclaim stale terminals=0,
unexpected worker results=0
```

This is the important distinction. The runtime now fences authoritative database effects and
terminalization, but it cannot revoke an arbitrary external effect once execution crosses the
final assertion boundary. The test makes that limitation observable instead of claiming that a
lease check is an atomic transaction with the filesystem.

## Separate fencing conclusions

| Boundary | Result after fix | Evidence |
|---|---|---|
| Database fencing | stale token append rejected | `LeaseLostError` assertion |
| Tool fencing before model resumes | no stale filesystem effect | 100 randomized races, zero effects |
| Tool effect after final check but before external call | not preventable; observed explicitly | 100 forced boundary races, 100 in-flight effects |
| Terminal fencing | no stale event or row transition | direct expiry and Worker terminal races |
