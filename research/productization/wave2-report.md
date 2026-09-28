# Wave 2 — Planning + Verification Loop: implementation report

Executed 2026-09-04. Parts A (CI), B (Wave 1 commit), C (Wave 2) in sequence.
Version stays `0.1.2`; **nothing republished**.

---

## Summary

| | before | after |
|---|---|---|
| Test suite | 692 / 26 suites | **746 passed, 0 failed / 27 suites** |
| Event contract | unversioned, 31 types | **v2, 35 types** (4 × `plan.*`) |
| Wave 1 commit | uncommitted | **`00b68a6`** |
| Planning | none | plan is a **fold over the log**, survives SIGKILL |
| `verify` in prompt | flagged gap | wired; a real model now chooses it unprompted |

---

## PART A — Windows CI shell path

### The change (`.github/workflows/ci.yml`)

Two steps added, Windows-only, before `Install`:

1. **`Use Git Bash as bash (Windows)`** — resolves Git Bash's `bin/` and prepends it to
   `GITHUB_PATH`, so `bash` is unambiguously Git Bash for every later step. Checks
   `ProgramFiles`, `ProgramFiles(x86)` and `LOCALAPPDATA\Programs` (GitHub runners use the
   first; per-user installs use the last), and **fails the job** if none has `bash.exe`.
2. **`Shell preflight (Windows)`** — runs `preflightShell()` from `tests/run-all.mjs` as its own
   step, so a broken runner is visible in the job list rather than buried in suite output.

### Why this is the right fix

The runtime shells out through `LocalSandbox`, which resolves the **bare name** `bash` through
PATH. On a Windows runner that is not automatically usable:

- the default PATH carries `Git\cmd` (which has `git.exe`, **not** `bash.exe`);
- where WSL exists, `C:\Windows\System32\bash.exe` resolves **first** and runs in a different
  filesystem namespace (`/mnt/d/...`), so it cannot see the checked-out workspace and silently
  returns empty output.

Both look like product defects and are not.

### Verified locally / must be checked on push

**Verified here:**

- YAML parses; 9 steps in the `test` job, in the intended order.
- The PowerShell resolution logic, run as-is on this machine → `C:\Users\...\Programs\Git\bin`.
- The exact `node -e` the preflight step runs → `{"ok":true}`, exit 0.
- The required local equivalent, Git Bash first on PATH:
  `node v0/tests/run-all.mjs` → **`TOTAL: 746 passed, 0 failed`**.
- The preflight discriminates: forced against WSL bash it returns `ok:false` with the
  namespace explanation; against Git Bash `ok:true`.

**Must be confirmed on push** (no GitHub runner available locally): that the matrix is green on
`ubuntu-latest` and `windows-latest` × Node 22 and 24 for `npm test`, `npm pack` and the CLI
step. The Windows risk is narrowed to one question — whether `bash.exe` exists at one of the
three probed locations — and the step fails loudly with the paths it searched if not.

---

## PART B — Wave 1 committed

**`00b68a6`** — `Wave 1: truthful completion — the runtime no longer reports success for work it
did not do`.

Contains only Wave 1: `worker.mjs`, `cli/index.mjs`, `tools/index.mjs`, `recovery/index.mjs`,
`event/index.mjs`, `tests/security`, `tests/run-all`, `tests/leaseheartbeat`,
`tests/truthfulcompletion`, and the CI fix. No Wave 2 code. `research/` deliberately excluded.

### Step 2 — installed-package acceptance (before committing)

```
$ npm pack && npm install -g ./kernlbase-orion-0.1.2.tgz
$ orionctl --version        → 0.1.2
$ orionctl --help           → banner + 12 commands
$ orionctl doctor           → home, db ok, endpoint, posture auto, integrity ok
```

Real run, `gemma4-31b`, on a fresh broken `calc.py` (baseline `1 failed`):

```
✓ bash / ✓ read / ✓ edit edited calc.py
✓ verify PASS (exit 0) py -m pytest -q . [100%] 1 passed in 0.02s
✓ model_finished

$ cat calc.py  → return a + b        $ py -m pytest -q → 1 passed
```

The model chose **`verify` on its own** — the Wave 1 tool being picked over `bash` without any
prompt guidance yet.

Slow-model run, `qwen3:14b` (the configuration that used to die as `lease_lost`):

```
✓ read / ✓ edit edited calc.py
✓ model_finished          → file: return a + b
```

---

## PART C — Wave 2: planning

### Architecture

A plan is a **fold over `plan.*` events** and is held nowhere else.

```
plan.created / plan.revised / plan.step_started / plan.step_finished
                          ↓  projectPlan()
        { goal, revision, steps[state, evidence, retry, depends_on], history[] }
```

`src/core/projection/plan.mjs` — pure, no I/O, no model. Because the worker stores nothing, the
plan survives a crash, and `resume`, `replay` and `fork` all reconstruct it from the same events.
This is deliberately **not** a workflow engine: no scheduler, no step runner. The model decides
what to do; the events record what it declared and what actually happened.

### Event contract versioning

`EVENT_CONTRACT_VERSION = 2` added to `core/event`. The set grew 31 → **35** and stays frozen.
Members are only ever added, never removed or renamed, so a v1 log still replays. Documented
in-source with what each version introduced.

### How a plan enters the trajectory

Two tools, `plan` and `plan_step`. They hold no state: `run()` returns an acknowledgement and a
new `emits(args, result, ctx)` seam returns the events that become the durable record.

`emits` is **general**, not a special case for named tools — the worker knows only that a tool
*can* emit, never which ones do. Emitted events are appended after `tool.succeeded` so log order
matches causality, and only a successful call emits. An emitter that throws produces a `degraded`
event rather than failing a call that genuinely succeeded.

### Completion contract now consumes the plan

`defaultCompletionContract` gains one rule, taking precedence over the Wave 1 heuristics:

> if the run declared a plan, the plan **is** the objective — `planSatisfied(plan)`.

A declared plan is a stronger, self-supplied statement of "done" than any inference from tool
activity. This closes a real gap: a run that declares 2 steps, writes a file, then stops was
**complete** under Wave 1 alone (a mutating tool succeeded) and is now correctly
`finished_without_change`.

### `verify` wired into the default system prompt

Closes the gap flagged at the end of Wave 1. Three short paragraphs: plan before starting, mark
steps as you go, and prefer `verify` over `bash` for checks because it records a PASS/FAIL
verdict as evidence. Plus one line restating the completion rule, so the model corrects course
rather than discovering the refusal at the end.

---

## Acceptance tests

`tests/planning/planning.test.mjs` — **54 assertions, all passing.**

### T1 — happy path

Plan → step → verify PASS → advance → next → completed.

```
PASS  every step is done  — s1.1:done s1.2:done s1.3:done
PASS  every step carries evidence — read 1 line | wrote a + b | PASS (exit 0) echo TESTS_OK
PASS  a verify PASS is recorded as trajectory evidence
PASS  the completion contract reads the plan as satisfied
```

Plus the sharp edge — **`T1-unfinished-plan-blocks-completion`**: a run that mutates a file but
leaves step 2 pending fails as `FINISHED_WITHOUT_CHANGE`. Wave 1's predicate alone passed this.

### T2 — fail and replan

```
PASS  the replan is a recorded trajectory event
PASS  the revision carries its reason — the exact-match edit did not apply
PASS  the plan is now at revision 2
PASS  the superseded plan is preserved, not overwritten
PASS  the old step list is still readable — patch with edit | prove it
PASS  the failed step of the old revision is still marked failed
```

Revising appends; it never edits in place. The trajectory still explains why the run changed
course.

### T3 — crash / resume / replay identity (the architectural test)

Worker A is crash-injected mid-plan at a point read from the **log** (step 1 done, step 2
pending), then a **different** `Worker` with a **different** `Store` handle resumes.

```
PASS  worker A died mid-plan
PASS  a plan was durable at the moment of the crash
PASS  a DIFFERENT process reconstructs the identical plan     ← fingerprint equality
PASS  step 1 kept its evidence across the crash
PASS  same revision (no plan was lost or restarted)
PASS  replay makes no model calls
PASS  replay reconstructs the plan identically
PASS  a third independent reader agrees
```

Fingerprint = goal + revision + every step's `[id, title, state, evidence, retry, depends_on]`.
Three independent readers of the same database agree. If a plan were ephemeral worker JSON, T1
and T2 would still pass and this would not.

---

## Manual terminal protocol (real installed package, live models)

### A defect found only here

The first manual T1 failed:

```
✕ plan invalid arguments: property steps must be array, got string   (×4)
failed — no_progress
```

The model had emitted a **correct** array; the Gemma shim's grammar sentinel-delimits every
element (`steps:[<|"|>a<|"|>,<|"|>b<|"|>]`) and read the whole literal as one opaque scalar.
`plan` is the first tool with an array argument, so nothing had exercised that path.

Fixed in the **shim** (the provider layer, where the project's own rule puts provider quirks),
with a regression test asserting both the parse and that the result passes schema validation —
the step that actually failed in the field.

### T1 — plan → steps → verify → complete (`gemma4-31b`)

```
✓ plan_step step 1 -> done      ✓ read                 ✓ plan_step step 3 -> done
✓ plan_step step 2 -> active    ✓ edit edited calc.py  ✓ verify PASS (exit 0) py -m pytest -q
✓ model_finished
```

Ground truth: `return a + b`, `1 passed`. `orionctl status` renders the plan:

```
plan r1: 5/5 steps — Fix the bug in calc.py where add does not return a + b and verify it with pytest.
 ✓ s1.1  Explore the workspace to find calc.py and its tests.  — Found calc.py and test_calc.py
 ✓ s1.2  Read calc.py to identify the bug.  — calc.py contains 'return a - b' instead of '
 ✓ s1.3  Read the tests to understand the expected behavior.  — test_calc.py expects add(2,3) to be 5
 ✓ s1.4  Fix the bug in calc.py.  — Changed 'return a - b' to 'return a + b'
 ✓ s1.5  Verify the fix with 'py -m pytest -q'.  — py -m pytest -q passed successfully
```

### T3 — real `SIGKILL` mid-plan, then resume

The node process (not a shell wrapper) was killed 6s in:

```
SIGKILL node PID 33272
```

State immediately after, read by a **fresh process** from the durable log:

```
$ cat calc.py            → return a - b        (STILL BROKEN)
$ orionctl status --json → status: running, satisfied: False
   s1.1 done     Explore the workspace to find calc.py an
   s1.2 pending  Read calc.py to identify the bug.
   s1.3 pending  Read the tests to understand the expecte
   s1.4 pending  Fix the bug in calc.py.
   s1.5 pending  Verify the fix with 'py -m pytest -q'.
```

`orionctl resume` immediately after returned **`could not claim the run (another worker holds
it)`** — correct: the dead worker's lease had not yet expired, and fencing refused the claim.
After expiry:

```
$ orionctl resume #330face5a3
  ✓ plan_step step 2 -> done          ← CONTINUED THE SAME PLAN, from step 2
  ✓ plan_step step 3 -> done
  ✓ edit edited calc.py
  ✓ verify PASS (exit 0) py -m pytest -q . [100%] 1 passed in 0.05s
  ✓ plan_step step 5 -> done
✓ model_finished
```

Ground truth after: `return a + b`, `1 passed`. Final state:

```
revision : 1 | satisfied: True        ← same revision; the plan was not lost or restarted
replay   : model_calls_made: 0 | status: completed | events: 194
```

---

## Deviations and honest findings

1. **A shim array-parsing gap** was found in manual testing, not by the suite (§ above). Fixed at
   the provider layer with a regression test. This is the second time the real-terminal rule
   caught something 700+ passing assertions did not.

2. **`qwen3:14b` ignored the plan instruction entirely** — it went straight to editing the file
   and never called `plan`. The system prompt is guidance, not enforcement, and a smaller model
   may skip it. The runtime handles this correctly (no plan ⇒ the Wave 1 predicate applies).

   **Classified as a MODEL-BEHAVIOUR / evaluation question, NOT a runtime defect.** Nothing in
   the runtime failed: the contract fell back to the Wave 1 predicate exactly as designed, and
   the run was judged on what it actually did. The finding is about the *model*, and the
   project's own separation rule (`runtime ≠ evaluation`, plan §9) puts it in `eval/`.

   Future eval items, to be measured per model and reported as measurements — never as a claim
   that the harness succeeded or failed:

   - **plan adherence** — does the model call `plan` at all, and does the declared plan
     resemble what it then does?
   - **verify adherence** — does it reach for `verify` over `bash` for checks, and does it pass
     the output through as step evidence?
   - **replanning behaviour** — on a failed step, does it revise (`plan.revised`) or does it
     retry the identical approach until `no_progress` stops it?

   **Do not assert planning universality in the README.** Wave 2 makes planning *possible and
   durable*; it does not make it *reliable across models*, and only measurement can say which
   models it holds for. See [`future-queue.md`](future-queue.md) Q2.

3. **Step evidence for steps completed before the crash showed as `None` after resume** in the
   manual T3 (the automated T3 asserts evidence *is* preserved, and it is — the model simply did
   not supply evidence on those steps in the manual run). Not a defect; recorded because the
   contrast between the two runs could otherwise look like one.

4. **`plan_step` accepts a 1-based index as well as a step id.** Models reach for "3" far more
   readily than "s1.3"; both resolve.

5. **The recovery-module boundary was respected.** No plan or policy logic went into
   `core/recovery`. The plan projection lives in `core/projection/plan.mjs`, the plan policy in
   the CLI's completion contract, and the provider quirk in the shim.

6. **Not republished.** Version stays `0.1.2`; manual tests used a locally packed tarball.

---

## Files changed (Wave 2, uncommitted)

| File | Change |
|---|---|
| `src/core/projection/plan.mjs` | **new** — the plan fold |
| `src/core/event/index.mjs` | `EVENT_CONTRACT_VERSION = 2`; 4 `plan.*` types |
| `src/agent/tools/index.mjs` | `plan`, `plan_step` tools with the `emits` seam |
| `src/agent/loop/worker.mjs` | `emits` dispatch; plan+verify system-prompt policy |
| `src/agent/model/shims/gemma-tool-calls.mjs` | `parseArray` — array-valued arguments |
| `src/cli/index.mjs` | contract consumes the plan; plan in `status` and `status --json` |
| `src/index.mjs` | export plan projection + `EVENT_CONTRACT_VERSION` |
| `tests/planning/` | **new** — 54 assertions (T1, T1-blocking, T2, T3, shim) |

---

## Parked for later (not Wave 2 scope)

`plan_step` evidence is currently **model-declared**: the agent writes the `evidence` string, and
that claim is what lands on the trajectory. The natural next step is to fold it with
**runtime-derived** evidence — the mutating `tool.succeeded` events in the step's window, the
`write` pre-state witness, the `verify` verdict — so step evidence becomes model **+** runtime
rather than model alone. That is the Wave 1 move (replace an assertion with a fold over the log)
applied one level down, and it is squarely on the provenance thesis.

It is queued rather than built because it needs a designed answer to what defines a step's window
when steps are marked out of order, whether runtime evidence may *override* the model's claim,
and how a `plan.revised` re-binds evidence gathered under old step ids. Getting it wrong yields
confident, wrong provenance — worse than the honest model-declared evidence we have.

Recorded in full in [`future-queue.md`](future-queue.md) Q1.

---

## STOP — WAVE 2 COMPLETE. No Wave 3 started.
