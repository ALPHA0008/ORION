# ADR-010 — Client-internal retries and provider shims are degradations

**Status:** Accepted (new; forced by real-model evidence)
**Supersedes:** nothing. Closes a hole in the "no silent degradation" rule.

## Context

The architecture has one non-negotiable observability rule:

> Fallbacks must emit a `degraded` event. Never silently hide fallback behaviour.

The model client (`createOpenAICompatModel`) retries transient provider faults **internally** with
exponential backoff — 429, 5xx, timeout, malformed JSON, empty `choices`. This was considered
correct: the worker asked for a completion and got one.

## Evidence

Step 7 of the real-model phase injected faults through a proxy sitting in front of the live vLLM
endpoint. First run, across six different transient fault types:

```
429 rate limit    -> completed  model.failed=0  degraded=0
500 server error  -> completed  model.failed=0  degraded=0
503 unavailable   -> completed  model.failed=0  degraded=0
malformed body    -> completed  model.failed=0  degraded=0
empty choices     -> completed  model.failed=0  degraded=0
timeout           -> completed  model.failed=0  degraded=0
```

## Failure discovered

**A response that took four attempts was byte-indistinguishable in the event log from one that
took one.**

The client absorbed the fault, retried, succeeded, and returned a normal result. The worker never
learned anything had happened. An operator reading `explain` on a run that limped through a
provider brownout would see a clean, healthy run.

This is exactly the failure mode the rule exists to prevent, hiding one layer below where anyone
had looked. It was invisible to 310 passing tests because the scripted provider in
`tests/integration/provider.test.mjs` asserted only that the run *recovered*, never that the
recovery was *recorded*.

A second instance of the same class was found alongside it: **provider shims**. The Gemma/vLLM
shim rewrites the model response (parsing native tool-call syntax, stripping channel markers).
That is a material departure from the normal path and was equally invisible.

## Decision

Two `degraded` events, emitted by the worker immediately before `model.responded`:

```js
const attempts = Number(resp?.ext?.attempts ?? 1);
if (attempts > 1)
  append('degraded', { subsystem: 'model', attempts,
    reason: `provider succeeded only after ${attempts} attempts (transient faults absorbed by the client)` });

if (resp?.ext?.shimmed)
  append('degraded', { subsystem: 'model_adapter',
    reason: `provider response required a shim: ${resp.ext.shimmed}` });
```

The client already reported `ext.attempts`; nothing new needed collecting. The bug was purely that
nobody read it.

**Generalised rule for future work:** a fallback is not only a branch the *runtime* takes. Any
layer that silently converts a failure into an apparent success — a retry inside a client, a shim
rewriting a response, a cache serving a stale value — is a degradation and must say so.

## Tradeoffs

- More events on a flaky provider: one extra `degraded` per retried call and per shimmed response.
  Acceptable — these are exactly the runs an operator needs to see, and the alternative is silence.
- `ext.attempts` becomes semi-load-bearing. It is still `ext` (unvalidated, ADR-004) and the
  reducer treats a missing value as `1`, so a provider that omits it degrades to today's behaviour
  rather than crashing.

## Tests

- `tests/real-model/06-remaining.mjs` Step 7 — six transient fault types against the **real**
  vLLM endpoint through a fault-injecting proxy. Each now reports `degraded=3` where it previously
  reported `0`.
- Same suite: a total outage (every request fails) terminates as `failed` / **`model_unavailable`**
  with `model.failed=3, degraded=2` — a named cause, not `max_turns` and not a silent completion.
- Full regression suite: 310/310 unchanged.
