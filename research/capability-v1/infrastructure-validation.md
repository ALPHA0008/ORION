# Infrastructure Validation

Before any baseline number means anything, the machinery that produces it has to be shown correct.
This stage produced **nine** infrastructure defects that each imitated a task or agent failure, so
the validation below is not ceremony — it is the reason the corpus is not a single task.

## 1. The bracket is two-sided

A one-sided check ("the test passes after the gold patch") would admit tasks that were never broken.
A different one-sided check ("the test fails on the clean tree") would admit tasks nothing can fix.
Both directions are executed per task, and **four `psf/requests` tasks were rejected specifically by
the preflight side** — their FAIL_TO_PASS test already passes on the clean tree here, so solving
them would prove nothing. That rejection class existing at all is evidence the preflight check is
load-bearing rather than decorative.

## 2. The oracle cannot be edited by the agent

The agent runs with `write`, `edit` and `bash` on a real checkout, so it *can* modify or delete the
failing test. Before any verdict is taken, `run-baseline.mjs` resets every file the `test_patch`
touches back to `base_commit` and re-applies the `test_patch`. Whatever the agent did to the test
suite is discarded before judging.

Without this, "delete the failing test" scores as a pass — the single most likely way for a
benchmark like this to report a capability that does not exist.

## 3. Success requires FAIL_TO_PASS **and** PASS_TO_PASS

```js
task_success: f2p.passed && p2p.passed
```

A fix that satisfies the target test by breaking the rest of the suite is not a fix. `PASS_TO_PASS`
is checked on a capped sample (25 node ids) and **the cap is recorded in every result row**, so the
claim stays exactly as strong as the evidence behind it.

## 4. No model is in the verification path

Verification is a process exit status from `pytest`. There is no scoring model, no rubric, no
partial credit, and no place where "the model says it solved it" can enter (§11). The same
discipline ADR-003 imposes on the runtime's `verify()` primitive.

## 5. Preflight is re-checked at run time, not trusted

Bracketing proves a task was unsatisfied *when bracketed*. `runTask` re-runs the preflight against
the actual tree the agent is about to receive and refuses the task if it already passes. A stale
environment therefore cannot manufacture a success.

## 6. Per-task isolation

One virtualenv and one working tree per task. Cross-task leakage was not hypothetical: a shared venv
let one task's dependency auto-load as a pytest plugin into the next and rejected two valid tasks.

## 7. The runtime is untouched

`run-baseline.mjs` imports `Store`, `LocalSandbox`, `makeTools`, `createAuthorizer` and `Worker` and
configures none of the phase-6-to-10 opt-in features: no `completionContract`, no `ACTION_PROMPT`,
no compaction. **Shipped defaults only**, per Rule 9.

`git status` on `v0/src/` is the check that matters, and it is clean: every file written this stage
lives under `eval/capability-v1/` or `research/capability-v1/`.

## 8. Known limitations, stated rather than hidden

| limitation | consequence |
|---|---|
| Docker unavailable (daemon 500 on `_ping`) | cannot use SWE-bench's official per-instance images; environment is reconstructed locally |
| Gemma context limit is 32 768 vs Qwen's 262 144 | an 8x asymmetry between arms; a live alternative explanation wherever the two diverge — see `gemma-baseline.md` |
| `PASS_TO_PASS` capped at 25 | regression checking is a sample, not exhaustive |
| One repeat per task | no variance estimate (§20) |
| Windows host | line-ending and path behaviour differ from the corpus's native Linux; every defect this caused is listed in `corpus-methodology.md` |
