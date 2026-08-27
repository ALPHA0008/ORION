# Test 06 — Provider failure (Step 7)

## Method

Faults were injected by a **proxy sitting in front of the real vLLM endpoint**. Upstream is the
genuine `gemma4-31b`; the proxy returns a transport fault for the first N requests and then passes
through. So the failure handling is exercised against real model output, not a stub.

## Results

| fault | terminal state | `model.failed` | kinds | `degraded` | task done |
|---|---|---|---|---|---|
| 429 rate limit | `completed` / `model_finished` | 0 | — | 3 | True |
| 500 server error | `completed` / `model_finished` | 0 | — | 3 | True |
| 503 unavailable | `completed` / `model_finished` | 0 | — | 3 | True |
| malformed body | `completed` / `model_finished` | 0 | — | 3 | True |
| empty choices | `completed` / `model_finished` | 0 | — | 3 | True |
| timeout | `completed` / `model_finished` | 0 | — | 3 | True |
| persistent 500 (total outage) | `failed` / `model_unavailable` | 3 | `server_error` | 2 | False |

## THE FINDING: transient retries were completely invisible

The first run of this experiment showed `model.failed=0, degraded=0` for **every** transient fault,
while the runs completed successfully.

The cause: the model client retries transient faults **internally** (`maxRetries: 3`). It absorbs a
429/500/timeout, retries, succeeds, and returns a normal result. The worker never learns anything
happened.

**A response that took 4 attempts was indistinguishable in the event log from one that took 1.**
That is precisely the silent degradation the architecture forbids.

### Fix

`src/agent/loop/worker.mjs` now emits a `degraded` event when the model result reports
`ext.attempts > 1`, and a second one when a provider **shim** rewrote the response:

```js
const attempts = Number(resp?.ext?.attempts ?? 1);
if (attempts > 1)
  append('degraded', { subsystem: 'model', attempts,
    reason: `provider succeeded only after ${attempts} attempts ...` });
if (resp?.ext?.shimmed)
  append('degraded', { subsystem: 'model_adapter',
    reason: `provider response required a shim: ${resp.ext.shimmed}` });
```

After the fix, every transient-fault run reports `degraded=3` where it previously reported `0`.

## Temporary vs permanent

| class | behaviour | evidence |
|---|---|---|
| 429 / 5xx / timeout / malformed / empty | retried inside the client with backoff, **`degraded` emitted**, run completes | all six rows above |
| total outage (every request fails) | client exhausts retries -> `model.failed` (kind `server_error`) -> worker counts consecutive failures -> terminates | `failed` / **`model_unavailable`**, 3 `model.failed`, 2 `degraded` |
| 4xx | **not** retried, fails fast | covered in `tests/integration/provider.test.mjs` Test 6e |

A permanent outage produces a **named** terminal reason (`model_unavailable`), not `max_turns` and
not a silent completion.
