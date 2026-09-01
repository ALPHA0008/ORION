# Attribution Results — Q5

Probe: `eval/mutation-observability/attribution-conflict.mjs` · data: `results/attribution-conflict.json`
Real `Worker` run with a scripted model issuing three bash calls, two of which mutate.

## Result

```
tc_1  echo A1 > a.py      names_files=false
tc_2  echo NOOP_READ      names_files=false
tc_3  echo B1 > b.py      names_files=false

tool.started   payload keys: tool_call_id, name, args
tool.succeeded payload keys: tool_call_id, name, result
final workspace diff:  M a.py   M b.py
```

## `PER_CALL_MUTATION_ATTRIBUTION = ABSENT`

The workspace ends with `a.py` and `b.py` both modified. The event log proves *which commands ran*
and in what order, but **no payload field names the files any call affected**. Attribution today is
inference from the command string, which is exactly the shell-parsing the project decided not to
build.

What this does and does not mean:

- **Does not** weaken the verdict on any task. Task success is decided by the verifier against the
  final world state; per-call attribution is a *diagnostic* affordance.
- **Does** limit trajectory analysis. In Stage 1, `pylint-7993` created six files across ten bash
  calls, and mapping file → call requires reading command strings by hand.
- **Does** mean a future intervention aimed at editing behaviour would have coarser evidence for
  bash-mediated edits than for `write`/`edit` ones.

## Not fixed here

An implementation is deliberately not added (§5). The cheap version — diff the workspace around
each `bash` invocation and record the changed paths on `tool.succeeded` — is plausible but is a
**runtime change** requiring the full V0 regression gate (§35), and nothing in the Stage-1 evidence
shows it changing a single task verdict. Recorded as a known limitation.
