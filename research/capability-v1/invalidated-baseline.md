# Invalidated Runs — Stage 1

Two separate invalidations, from two unrelated causes. This file is the index; each has its own
detail.

| run | cause | classification | detail |
|---|---|---|---|
| Gemma 2/17 (pre-fix) + partial Qwen | no Python interpreter on `PATH` | **INFRASTRUCTURE** — ours | below |
| Qwen 0/17 (post-fix, complete) | deterministic empty/truncated terminal completion | `QWEN_INTERACTION_MECHANISM_CONFIRMED` | `qwen-invalidation.md` |

The two are unrelated and must not be conflated: the first was a defect in our environment
provisioning, the second is a model/serving/harness interaction that survives a correct environment.
Neither contributes to capability scoring.

---

## Invalidation 1 — No Interpreter on PATH

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

The first Gemma baseline (**2/17**) and the partial Qwen run are **INVALID and must not be quoted**.
They are kept at `eval/capability-v1/runs/invalidated/` as evidence, not deleted.

## The defect

The runner never placed the task's virtualenv on `PATH`. The sandbox inherited a bare Windows shell
in which:

- `python` resolved to the **Microsoft Store stub** — `Python was not found`, exit 49
- `python3` **did not exist at all**

So the agent was asked to fix code it had **no way to execute**. Not a hard environment, an
impossible one: no amount of correct reasoning could have run a test or a reproduction script.

## How it was found

Not from the score — from the trajectory. `psf__requests-3362` navigated correctly to the right
functions in `models.py` and `utils.py` (T1–T10), then spent **T13–T26** hunting for an interpreter:

```
/usr/bin/python3 --version   → No such file or directory
where python3                → C:\...\WindowsApps\python3.exe
C:\...\python3.exe --version → bash mangles the backslashes → command not found
python3 --version            → Python was not found (exit 49)
/usr/bin/env python3         → Python was not found
which python                 → /c/.../WindowsApps/python
that path --version          → Python was not found
```

It then terminated with a prose analysis. The mechanism label said *premature termination*; the
trajectory says the agent had nowhere to go.

Corpus-wide: **8 of 17 runs** showed this interpreter hunt, and **143 bash calls failed**. The two
runs that passed (`pytest-7373`, `pytest-7432`) barely used bash at all — consistent with the
hypothesis that bash was effectively unusable.

## Why this is INFRA and not AGENT (§8)

The brief is explicit that environment problems must not become agent failures. Had this stood, the
headline would have been *"premature termination, 8 failures, generalises across all four
repositories"* — a confident, well-evidenced, **wrong** conclusion, and the single largest
misattribution available in this stage. The proposed V1 intervention would then have targeted
termination behaviour when the real defect was a missing `PATH` entry.

## The fix

In `eval/` only — **`v0/src` remains untouched (Rule 9)**:

1. The task's venv `Scripts/` directory is prepended to `PATH` for the duration of each run, and
   restored afterwards so no task leaks its interpreter into the next. `LocalSandbox` reads
   `process.env` at exec time and exposes no env option, so this is done on the parent rather than
   by modifying V0.
2. A `python3.exe` alias is created in each venv. Windows venvs ship `python.exe` only, and every
   trajectory inspected reached for `python3` first — the habit of a model trained on POSIX. The
   corpus should test whether the agent can fix the bug, not whether it knows Windows venv layout.

Verified after the fix, through the real sandbox:

```
python  --version                        → Python 3.9.25
python3 --version                        → Python 3.9.25
python3 -m pylint --version              → pylint 2.15.0-a0     (the TASK'S pylint)
python -c "import pylint; print(...)"    → .../work/pylint-dev__pylint-7228/pylint/...
```

## Consequence

Both baselines are re-run from scratch against the unchanged frozen corpus
(`CAPABILITY_V1_STAGE1`, sha256 `0a9a279d…`). The corpus definition did **not** change, so the
corpus hash is unchanged and results remain comparable to the frozen manifest.

The invalidated numbers are **not** carried into `comparison.md`, `failure-table.md`, or any
capability claim.

## What this says about the instrument

Three of the four defects found in Stage 1B/1C were caught the same way: by cross-checking a
reported metric against the durable event log and refusing to accept the first plausible story. The
score was internally consistent every time. Only the trajectory disagreed.
