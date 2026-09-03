# qwen3:14b — n=1 sweep across the editing family (PROVISIONAL)

> **Every number here is provisional and n=1.** This sweep tests whether the single-task probe
> pattern generalises. It does not, and the write-up says so.

**Corpus** `CAPABILITY_V1_STAGE1` · sha256 `0a9a279d…` · unmodified.
Stage-1 baseline `runs/gemma4-31b.json` verified byte-identical after every run (guard never
tripped). `v0/src` untouched. No capability implementation.

**Coverage**: 4 sweep runs (`qwen3-14b-sweep`) + the earlier `pylint-6506` probe
(`qwen3-14b-probe`) = all 5 editing-family tasks at n=1.

Mechanisms come from the existing classifier (`report-repeats.mjs`, label-scoped). None was
hand-assigned.

## Decision table

| task | reached source? | edited? | mechanism | tool calls | error class |
|---|---|---|---|---|---|
| `pylint-6506` | **Y** | **Y** | `editing`* | 6 | **NameError** |
| `flask-5063` | **N** | N | `termination` | **0** | AssertionError (unchanged tree) |
| `pytest-8906` | **N** | N | `termination` | **0** | — |
| `pytest-8365` | partial (read only) | N | `termination` | 3 | — |
| `pytest-7432` | partial | N | `termination` | 4 | — |

\* `pylint-6506` is classified `editing` by the classifier on the probe artifact; the four sweep
tasks are all `termination`.

**Reached source and edited: 1 of 5.**

## The four questions

**1. Did it reach the source and attempt an edit?**
**No, on 4 of 5.** Only `pylint-6506` produced a non-empty `diff_stat`
(`pylint/config/config_initialization.py`, +2/−1, one `edit` call). The other four made **zero
successful edit or write calls**.

**2. What mechanism did it fail by?**
`termination` on 4 of 5; `editing` on 1. The classifier assigns `termination` because the run ends
`model_finished` with an unchanged world — the agent believed it was done.

**3. Did it quit early or loop?**
**Quit early, severely.** Two tasks made **zero tool calls at all** — one model call, then a prose
answer. Against Gemma's ~13 average:

| task | qwen3:14b | Gemma (same task) |
|---|---|---|
| `flask-5063` | **0** | 19 / 1 / 40 |
| `pytest-8906` | **0** | 15 / 16 / 11 |
| `pytest-8365` | 3 | 35 / 13 / 11 |
| `pytest-7432` | 4 | 5 / 11 / 11 |
| `pylint-6506` | 6 | 17 / 17 / 25 |

**4. Error class of the wrong edit.**
Only one edit exists. It produces **`NameError`** — and that is categorically different from
Gemma's failure on the identical task and file:

| model | `pylint-6506` failure |
|---|---|
| Gemma r1, r2, r3 | **`AssertionError`** — the test's own assertion |
| qwen3:8b | **`NameError`** |
| qwen3:14b | **`NameError`** |

Gemma writes **runnable code that does not fix the bug**. qwen3 writes **code that does not run**.
The `NameError` is introduced by the edit; it is not pre-existing (Gemma's runs on the same task at
the same commit fail with `AssertionError`).

## What the trajectories actually show

On the four non-editing tasks, qwen3:14b produced a *prose description of the fix* and stopped:

- `flask-5063` (0 tool calls): *"The `flask routes` command does not currently display subdomain
  information because Flask's URL map does not store subdomain data directly in `Rule` objects…"*
- `pytest-8906` (0 tool calls): *"The issue revolves around improving the clarity of pytest's error
  messages… 1. **Update Error Messages**…"*
- `pytest-8365` (3 calls — `grep`, `grep`, `read`): *"The issue arises because `getpass.getuser()`
  returns a username with illegal characters… The solution is to sanitize…"*

The diagnoses are largely **correct**. The agent identified the right cause and, on `pytest-8365`,
the right remedy — then answered the user instead of changing the repository.

## Applying the interpretation rules

**Rule 1 — ≥3 of 5 show "reached source + edited wrongly + quit" → Outcome-B leaning.**
**NOT MET.** 1 of 5. The single-task probe did **not** generalise.

**Rule 2 — edits correct-ish, model just needs more tries.**
**NOT MET**, and not close. There is one edit, it is syntactically broken, and the dominant
behaviour is not looping — it is not starting.

**Rule 3 — pytest tasks terminate/pause without editing (the Mistral signature) → qwen3 diverges
from Gemma → still Outcome C.**
**MET, and beyond the pytest tasks.** `pytest-8906` and `flask-5063` made **zero tool calls**, which
is Mistral's signature exactly. `pytest-8365` and `pytest-7432` investigated slightly and stopped.

## Leaning direction: **Outcome C — UNRESOLVED. qwen3:14b is not a clean comparator.**

The hypothesis this sweep was built to test — *that qwen3 shares Gemma's editing mechanism across
tasks* — is **not supported**. On the single task where both edit, they fail in **different error
classes**; on the other four, qwen3 does not edit at all.

Two distinct failure signatures are now visible, and they are not the same mechanism wearing one
label:

| | Gemma 31B | qwen3:14b |
|---|---|---|
| reaches source | 13/15 runs | 1/5 tasks |
| tool calls | ~13 avg | 0–6 |
| characteristic failure | edits, wrong **semantics** (`AssertionError`) | **does not edit**; when it does, wrong **syntax** (`NameError`) |

This is the classifier's limit showing: `editing` on `pylint-6506` is the same label for Gemma and
qwen3, but `AssertionError` versus `NameError` are different defects. A corroboration claim built on
the label alone would have overreached.

## Critical caveats

1. **qwen3 is the quarantined family.** `qwen3.6:35b` carries
   `QWEN_INTERACTION_MECHANISM_CONFIRMED`. This is a different model and size and the quarantine was
   **not** reopened — but family-level behaviour cannot be ruled out as a contributor.
2. **Size confound.** 14B vs Gemma's 31B. Any difference may be scale, not harness.
3. **n=1.** Stage 1D measured **5 of 8 tasks changing mechanism across identical repeats**. These
   single runs cannot establish a per-task mechanism.
4. **Serving asymmetry.** qwen3 runs locally at ~62% GPU residency (9.3 GB against 8 GB VRAM);
   Gemma runs remotely on vLLM. Latency differs by an order of magnitude.
5. **Supporting, not conclusive.** These results **corroborate nothing** about Gemma's editing
   mechanism, because qwen3 mostly does not edit. A **non-Qwen, ~30B-or-larger** model remains
   required.

## What this rules out, which is the useful part

Three local candidates have now been tested, and none can serve as Model B for the editing question:

| candidate | gate failed |
|---|---|
| `deepseek-r1:70b` | **gate 1** — emits no `tool_calls` at all |
| `mistral-small3.2` | **gate 2** — 0 edits across 15 runs |
| `qwen3:14b` | **gate 2** — 1 edit across 5 tasks; 2 tasks with 0 tool calls |

The Model-B selection criterion is now sharper and empirically grounded: a candidate must **reach
source and attempt an edit on the majority of tasks**, not merely emit parseable tool calls. All
three local models cleared or failed gate 1 and then died at gate 2.

That points at the hardware, not the search: **8 GB VRAM** caps local candidates at ~8–14B, and the
observed edit-attempt rate falls off sharply below Gemma's 31B. Resolving the editing question
plausibly requires a **remote endpoint** for a ~30B+ tool-tuned non-Qwen model, served the way Gemma
already is.

## Provenance

| item | value |
|---|---|
| sweep artifacts | `runs/repeats/qwen3-14b-sweep-<task>-r1.json` (4) |
| probe artifact | `runs/repeats/qwen3-14b-probe-pylint-dev__pylint-6506-r1.json` (1) |
| classifier report | `reports/repeatability-qwen3-14b-sweep.json` |
| baseline guard | `a068127d…` — asserted after every run, never tripped |
| Gemma / Mistral artifacts | 24 / 15, untouched |
