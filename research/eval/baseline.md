# Evaluation Baseline — the runtime frozen before capability work

**Date:** 2026-08-28 · **Commit:** `73b0bc3` · **Tag:** `v0-baseline`
**Node:** v24.18.0 · **OS:** Windows 11 26100

This is the comparison point. Every later capability claim is measured against *this* commit.

---

## 1. Regression suite — 310/310

```
OK    unit/event-store          26 passed, 0 failed  (6.1s)
OK    concurrency/lease         51 passed, 0 failed  (2.3s)
OK    fencing/fencing           29 passed, 0 failed  (3.9s)
OK    runner/runner              7 passed, 0 failed  (0.1s)
OK    crash/matrix               6 passed, 0 failed  (12.6s)
OK    recovery/recovery         53 passed, 0 failed  (1.4s)
OK    replay/semantics          44 passed, 0 failed  (3.3s)
OK    integration/provider      53 passed, 0 failed  (7.5s)
OK    security/security         41 passed, 0 failed  (16.9s)
════════════════════════════════════════════════════════════
TOTAL: 310 passed, 0 failed across 9 suites      exit 0
```

Reproduce: `cd v0 && node tests/run-all.mjs`

## 2. Runner is fail-closed — verified, not assumed

The brief warns against "fixing" the runner to make the suite green. I verified the opposite
property holds, by feeding `assessSuiteResult` seven synthetic outcomes:

| scenario | verdict |
|---|---|
| clean pass | ok |
| suite reports failures | **rejected** — "2 failed assertion(s)" |
| nonzero exit, summary says pass | **rejected** — "exited with status 1" |
| killed by SIGKILL | **rejected** — "terminated by SIGKILL" |
| spawn error | **rejected** — "suite process error" |
| **crash with no summary at all** | **rejected** — "produced no test summary" |
| empty output | **rejected** — "produced no test summary" |

The sixth row is the one that matters: a suite that dies before printing anything cannot read as
green.

## 3. Size

| | LOC |
|---|---|
| `v0/src` | **2,326** |
| `v0/tests` | **3,130** |
| runtime dependencies | **0** |
| build step | none |

## 4. Architecture (unchanged)

```
CLI → Worker loop → Model adapter → Tools → Authorization → Sandbox
                          ↓
                  Append-only event log
                          ↓
                  Bounded projection
                          ↓
        resume · replay · fork · explain
```

31 closed event types, extensible payloads (ADR-004). State is a fold of the log, bounded by
`WINDOW=40` messages × `MSG_CLAMP=2000` bytes (ADR-001).

## 5. Current capability surface — deliberately small

**Tools (6):** `read` · `grep` · `write` · `edit` · `bash` · `ask_user`

**Model:** one adapter (OpenAI-compatible chat-completions) + one named provider shim
(Gemma-on-vLLM tool-call parsing and channel-marker stripping).

**Explicitly absent:** streaming · parallel tool calls · subagents · MCP · skills · semantic memory ·
multi-provider infrastructure · repository intelligence (no `glob`, `find`, `git diff`, `git status`,
file metadata, directory summaries) · planning beyond the model's own reasoning · retrieval.

## 6. What has been validated — and what that does NOT mean

**Validated: runtime reliability.**
Real `SIGKILL` at 25/50/75% of a task with zero duplicate effects; lease fencing under a 6-process
claim storm; per-invocation recovery with `verify()` resolving reissue/skip/escalate; replay
byte-identical with zero model calls under a nondeterministic model; fork with provenance;
authorization holding against a model instructed to bypass it; every fallback emitting `degraded`.

**NOT validated: agent capability.**
The hardest task the agent has completed is a **one-line bug fix in a 4-file repository**
(`return a - b` → `return a + b`), verified by a shell script. Every real-model task so far used
**3–6 tool calls**. Nothing has tested multi-file changes, repository exploration at scale,
dependency problems, or iterative test-driven debugging.

> The runtime has been validated far more deeply than the agent has. This phase exists to correct
> that asymmetry, and the baseline above is deliberately a statement of *ignorance* about capability
> rather than a claim of competence.

## 7. Known limitations carried into this phase

1. **Context-window overflow never occurred with a real model.** Clamping is proven (34 messages,
   peak 33 KB against a 96 KB ceiling); *elision* is not — 0 messages were ever dropped.
2. **One model, one provider** (`gemma4-31b` on vLLM).
3. **No naturally-occurring orphan.** Every random `SIGKILL` landed on `model.requested`, because
   the model call dominates wall time; reissue/skip/escalate were verified with induced orphans.
4. **No repository-scale tasks.** Largest workspace used: 14 files of ~3 KB.
5. **Multi-host leases untested** (wall-clock expiry assumes no clock skew); Postgres unmeasured.
6. **No developer has used this.** Zero installs, zero interviews.

## 8. Real-model baseline (from the previous phase, for reference)

95 assertions across 4 suites against `gemma4-31b`. Aggregate across 10 workloads:
462 events · 66 model calls · 47 tool calls · 57,228 input tokens · 1,726 output tokens.

Cost per task is **not** available — the endpoint is self-hosted with no per-token price.
For the evaluation phase, cost will be reported in tokens and, where a priced provider is used,
in USD.

---

## Freeze declaration

Runtime frozen at `v0-baseline` (`73b0bc3`). Capability work proceeds only via the evaluation loop:

```
MEASURE → FIND BOTTLENECK → BUILD ONE THING → BENCHMARK → KEEP / REVERT → REPEAT
```
