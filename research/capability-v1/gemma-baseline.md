# Gemma 4 31B — Endpoint Verification

> **STATUS: NO BASELINE HAS BEEN RUN.** This file currently records only that the endpoint is
> reachable and that the tool-call shim works. The capability baseline is **pending**; when it is
> run, its results replace this notice.

**Endpoint**: `http://172.20.7.22:8000/v1` · model id `gemma4-31b`
(`RedHatAI/gemma-4-31B-it-NVFP4`, vLLM, `max_model_len` 32768)

## Correction to an earlier claim in this stage

An earlier draft of this file recorded that no Gemma baseline was obtainable. That was **wrong**,
and the error was mine: I probed `localhost` on the ports used in earlier phases and concluded from
the silence that the endpoint did not exist. The server is on a **different host**, not a different
port. Nothing about the endpoint had changed.

The mistake is worth keeping in the record because of what it nearly cost. Had it stood, this stage
would have shipped a single-model baseline and marked its MODEL-vs-HARNESS attributions
"model-confounded" — a materially weaker result — on the strength of an unfounded inference from a
negative probe. **A negative probe bounds where you looked, not what exists.**

The two-model comparison is therefore **still possible**. It has **not been run** —
`comparison.md` does not yet exist.

## Reachability, verified through the unmodified client

Checked through `createOpenAICompatModel` with `applyGemmaToolCallShim` — the same path
`run-baseline.mjs` uses, not a bare `curl`:

| check | result |
|---|---|
| trivial completion, cold | 272 ms |
| trivial completion, warm | **56 ms** |
| tool call emitted and parsed | `{"name":"read","args":{"path":"/tmp/a.txt"},"argError":null}` |

The shim is required and is doing its job: Gemma does not emit native `tool_calls`, and the parsed
result above is what the shim reconstructs. This is existing V0 machinery, used unchanged (Rule 9).

## Context limit — the one material asymmetry between the arms

`max_model_len` is **32 768** for Gemma against Qwen's 262 144: an **8× difference**.

This matters more on this corpus than it did on the V0 diagnostic benchmark. These are real
repositories — `pytest`'s tree alone is thousands of files — so a bounded projection that was
comfortable against a five-file JS package is not obviously comfortable here. ADR-001's bounded
projection (`WINDOW=40`, `MSG_CLAMP=2000`) is what keeps the transcript inside the window, and it is
identical in both arms.

Where the two models diverge, this asymmetry will be a live alternative explanation to capability
and must be treated as one rather than noted and forgotten (comparison pending).

## Speed

Gemma is roughly **45× faster warm** than Qwen on a trivial completion (56 ms vs 2 560 ms). That is
a throughput property of the two deployments, not a capability claim, and it has one methodological
consequence worth stating: the Gemma arm can afford its full turn budget comfortably, while the Qwen
arm is the one at genuine risk of `TIMEOUT` classifications. Any timeout asymmetry between the arms
should be read as deployment speed first and agent behaviour second.
