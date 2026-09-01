# Stage 1 Summary

## Stage status: `CORPUS_NEEDS_MORE_TASKS`

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
Not "SWE-bench Lite performance", not industry-level, not a competitive benchmark.

The baseline **completed**. It is **not interpretable enough** to justify a capability intervention.
Those are different things, and §22 is explicit that a clean run is not automatically an
interpretable benchmark.

## Frozen corpus

`CAPABILITY_V1_STAGE1` · sha256 `0a9a279d48a491dacdadfd714c2c588bfb8a79adb4d536680241f1ebcf8300bb`
· **17 tasks** · committed `7d5e5b6` **before** either baseline consumed it.

32 SWE-bench Lite candidates → 17 accepted / 15 rejected, every rejection categorised. All 17 are
real merged-PR fixes with maintainer-authored oracles; nothing was authored here.

## Environment integrity

Reproducible, and hard-won. Bracketing first measured **1/32**; the tasks never changed. Eleven
defects in *our own* provisioning and instrumentation were found and fixed, of which the largest:

- **no Python interpreter on `PATH`** — the agent was asked to fix code it could not execute.
  Invalidated an entire Gemma baseline (`invalidated-baseline.md`).
- `atomicwrites` yank-hole causing uv to **silently** resolve pytest 3.5.1 for a 2021 project.
- our own `--no-header` flag, which postdates pytest 6.0, rejecting 9 tasks.

Verification: 17/17 two-sided through the production verifier; **25/25 anti-gaming attacks
defended**; 0 infra failures, 0 verifier failures, 0 timeouts in the valid run.

## Gemma — valid baseline

**3 / 17.** 403 tool calls, 79.9% success, 0 escalations, 0 compactions.
See `gemma-baseline.md`.

## Qwen — invalidated

**0 / 17**, classified `QWEN_INTERACTION_MECHANISM_CONFIRMED`: a deterministic model/serving/harness
interaction failure, reproduced from minimal state with 0 bytes of tool feedback. It is **not** a
capability measurement, Qwen is not "bad", and Ollama is not named as sole root cause.
See `qwen-invalidation.md`.

## Failure distribution (14 agent failures)

| mechanism | freq | repos | note |
|---|---|---|---|
| `long-horizon execution` | 6 | 2/4 | 83% pytest; ≥2 sub-mechanisms |
| `editing` | 4 | 2/4 | wrong change to the right file |
| `termination` | 4 | 2/4 | clearest mechanism; detector already exists |

**No mechanism reaches 50%, and none spans more than 2 of 4 repositories.**

## First-causal-divergence findings

- `pylint-6506` — 31 calls of correct investigation, then **1 731 characters of accurate analysis
  and zero edits**. Diagnosis was never converted into action.
- `pytest-6116` — five near-identical `grep` calls, no `path`, **zero files read**, then ADR-006
  fires. A degenerate loop, not a considered stop.
- `flask-5063` — edited `src/flask/cli.py` and still failed: a genuine wrong edit.

## Rejected candidate — recorded because it looked convincing

**Context management.** Dropped messages correlate strongly with failure (17.4 mean vs 3.3 in
passes). Rejected on direct test: `dropped == max(0, messages_total − 40)` in **17/17** runs.
Dropping is arithmetic on conversation length, not a cause. 0 compactions; the 32K window was never
binding.

## Unresolved and safety-relevant

**10 of 17 runs wrote files through `bash`**, not `write`/`edit`; 4 exclusively. This bypasses
ADR-011's write pre-state witness — phase 7's lost-update protection does not apply to those writes.
No failure is attributed to it, so it is unranked, but it is a real gap.

## Corpus limitations

- **Every gold patch touches exactly one file.** SWE-bench *Lite* by construction. This corpus
  **cannot** measure multi-file refactoring or cross-module reasoning.
- One language, one test framework, 4 repositories; pytest is 59% of tasks and 64% of failures.
- The hard end of the difficulty range (django, sympy, scientific stack) was excluded for
  buildability. A *success* rate here does not transfer upward; a *failure* probably does.
- **n=1.** No stable/high-variance label is assigned to any task; the V0 n=3 thresholds do not apply.

## Interpretability gate

| criterion | verdict |
|---|---|
| corpus quality | **PASS** — real merged-PR tasks, maintainer oracles |
| environment integrity | **PASS** — infra failures separated and excluded |
| verifier integrity | **PASS** — 17/17 bracketed, 25/25 attacks defended |
| diversity | **FAIL** — 1 language, 1 framework, single-file fixes only |
| repository dominance | **FAIL** — pytest 59% of tasks, 64% of failures |
| attribution | **PASS** — first causal divergence recoverable in 14/14 |
| statistical usefulness | **FAIL** — n=1; no mechanism >50%; 4-vs-6 split not a reliable ordering |
| model validity | **PARTIAL** — one valid arm; MODEL vs HARNESS cannot be separated |

Three failures and a partial. The decision follows the gate.

## Strongest bottleneck (held, not selected)

`termination` — clearest mechanism, HIGH trajectory confidence. **Not selected**, because phase 10
already measured this intervention's ceiling: it fixes runtime truth but did not recover capability
on live runs. Full reasoning and falsification criteria in `first-intervention.md`.

## What NOT to build

No memory, planning, MCP, skills, subagents, new tools, new search, new context architecture. No
context-management work — that candidate was tested and rejected. The completion contract stays
**off** until an experiment turns it on deliberately.

## Remaining unknowns

1. Whether any mechanism is a **harness** property or a **Gemma** property — unanswerable with one
   arm.
2. Whether the 4-vs-6 mechanism split survives repeats.
3. Whether `long-horizon execution` is one mechanism or two.
4. Why the agent prefers `bash` over its own file tools.
5. Whether these mechanisms hold on multi-file work — untestable on this corpus.

## Confidence

**MEDIUM** in the individual first-causal-divergence diagnoses (trajectory-backed, 14/14).
**LOW** in the mechanism *ranking*, and therefore in any single-intervention choice built on it.

That gap is the whole reason this stage stops here.
