# Runtime-condition analysis for the Qwen runs

## Observed runtime facts (from the durable event log)

- **Sequential execution only.** The runner executes tasks in order (`run-baseline.mjs` sweep
  loop); no concurrent requests. Flask-5063 (125 s) and flask-4045 (45 s) ran at different times,
  not in parallel.
- **Per-request latency is small and stable.** 1.8–14.1 s per model round-trip, 6.1 s average-ish;
  time-to-failure 9–125 s. Nothing approaches the 900 s task timeout.
- **`cache_read_tokens = 0` and `cache_write_tokens = 0` on EVERY model.responded**, including
  round 12 where the input was a 4,000+ token superset of round 11. Ollama exposed no prefix-cache
  hits at all. TTFT was not recorded (`null`).

## What the runtime conditions DO and DO NOT distinguish

- **Not concurrency pressure:** no overlap; the earliest/fastest collapses (pylint-7993 at 9 s)
  happened under identical sequential load to later ones.
- **Not a warm/cold serving state:** both fast early-collapse runs and late-collapse runs occurred
  throughout the sweep (9 s, 40 s, 125 s wall times interleaved), with identical terminal behavior.
  The corrected replays (fresh requests, temp=0, away from the original sweep) also collapse —
  serving state at the moment of the ORIGINAL run is therefore not necessary for the mechanism.
- **PLausible but untested serving hypothesis:** cache_read=0 with a long prefix is unusual and
  could indicate Ollama recomputing prefix KV each request. Continued calls in a single run keep
  working (tool_calls returned for 5–14 rounds), so it does not by itself degrade loop survival.
  It does explain the per-request latency being proportional to input length.

## Verdict
Runtime/serving-state is **REFUTED as the collapse mechanism**: the corrected replays reproduce
the terminal empty completion with fresh, sequential, single requests against a quiet server,
with token counts that match the live run. The mechanism lives in the model's response to the
request state, not in the serving conditions under which the original run happened.