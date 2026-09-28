# Wave 3 — Context Maturity + Artifacts: implementation report

Executed 2026-09-05. Version stays `0.1.2`; **nothing republished**.

---

## Summary

| | before | after |
|---|---|---|
| Test suite | 748 / 27 suites | **797 passed, 0 failed / 28 suites** |
| Event contract | v2, 35 types | **v3, 36 types** (`artifact.created`) |
| Compaction | implemented, **OFF**, ran every turn when on | **ON by default, budget-aware**, with provenance |
| Artifacts | none | hashed, provenance-bearing references; **verified on a real run** |
| Verify evidence | lost if compacted | **verdict retained** in the placeholder |
| CI | 0/4 test cells green | **4/4 green** + package validation |

---

## PRECONDITION GATE — **MET** (resolved during this session)

The matrix is **green on all four cells plus package validation** (run `33958602579`):

| cell | at session start | now |
|---|---|---|
| ubuntu × Node 22 | ✗ | **✓** |
| ubuntu × Node 24 | ✗ | **✓** |
| windows × Node 22 | ✗ | **✓** |
| windows × Node 24 | ✗ | **✓** |
| package validation | ✓ | **✓** |

Wave 1 and Wave 2 had **never been pushed**, so CI had never run on them. Four causes were
root-caused and fixed; none was a runtime defect, and two were mine.

1. **`repl` — "got 0 runs."** The helper concatenated stdout+stderr and `JSON.parse`d the result.
   Node 22 prints an `ExperimentalWarning` for `node:sqlite` on stderr, so the parse threw and the
   suite reported the runtime had lost the run. It had not. Now parses stdout alone — the
   product's actual contract — with an explicit assertion of that contract.

2. **`security` — "expected 8, got 7."** Reported by a log-reading helper as a path-traversal
   vulnerability. **It is not one.** Two payloads are Windows-shaped; on POSIX a backslash is an
   ordinary filename character, so `C:\Windows\win.ini` names a file *inside* the workspace and
   writing it is correct containment. The test now asserts the invariant that holds on every
   platform — the outside file is untouched and nothing is created outside the root. It also
   exposed a latent **false pass**: on POSIX those payloads "blocked" only by not existing
   (ENOENT), proving absence rather than containment.

3. **`fencing` exit 13, part one — the heartbeat.** Root-caused by experiment: forcing the Wave 1
   lease heartbeat to fire took fencing from 29/29 to 18 passed / 11 failed. Measured — with a
   20 ms lease and a heartbeat, after the test's 35 ms sleep `B could claim: false`. Both
   scenarios induced lease loss by waiting for a **live** worker to lapse, which is exactly what
   D1 deliberately stopped. Rewritten to model a **dead** worker (reclaim at a future `now`);
   passes 29/29 even with the heartbeat forced to fire.

4. **`fencing` exit 13, part two — a startup race.** The Windows log named it:
   `Detected unsettled top-level await ... await modelStarted`. The loop claimed a lease of
   `7 + random(10)` ms, and the worker's first action is to renew it. If more than ~10 ms elapses
   between claim and worker start — routine on a loaded runner, unreachable on an idle dev box —
   the renew fails, the worker returns `LEASE_LOST` **without ever calling the model**, and the
   top-level await hangs forever. Proven with 40 ms of injected delay:

   ```
   model.invoke() was called: false
   worker result           : failed / lease_lost
   ```

   The tiny lease existed only to force passive expiry, which fix (3) had already made
   unnecessary — so it was doing nothing but creating the race. Now 5 s.

   Added `settledWithin(promise, ms, what)`: a never-settling top-level await is the least
   diagnosable failure there is — no output, no stack, just exit 13 on a runner you cannot attach
   to. The guard converts it into a named assertion failure so the next regression of this class
   explains itself.

**Two fixes proposed from the logs were declined, with reason.** Wrapping the block in an async
IIFE would let the module exit before the work finished, so `summary()` would report the wrong
counts; collecting the iterations and awaiting `Promise.all` still awaits `modelStarted` inside
each iteration, so it hangs exactly as before. The promise not settling was the defect, not how
it was awaited.

**A semantic change worth restating:** since D1, a worker blocked in a long model call holds its
lease for as long as it lives, so a hung-but-alive worker is not reaped. That is deliberate — the
alternative was killing workers that were still working — but "the lease expired" now means *the
process is gone*, not *the call is slow*.

---

## Architecture

### Artifacts — references, not copies

The design decision that matters is what an artifact is **not**. It is not a second storage
system and it copies nothing. The full text of a large tool result **already lives durably** in
its `tool.succeeded` event; the projection merely clamps it before showing the model. What was
missing was *identity*.

```
tool.succeeded (seq 118, 28.1 kB)  ──▶  artifact.created { id, source_seq: 118, sha256, bytes }
                                              │
   outbound message / compaction placeholder ─┘   references artifact:a_0bb7bb21eb
```

That buys three things the clamp alone could not:

- the reader can **see** that content exists and how much was withheld, instead of a silently
  truncated tail;
- a compaction placeholder can point **at** the evidence instead of orphaning it — which is what
  keeps evidence integrity intact once compaction is on by default;
- the sha256 makes it **checkable**: an artifact referenced later is provably the same bytes.

Ids are **content-addressed** (`a_` + sha256 prefix), so the same content yields the same id on
replay, on a fork, and in another process. An artifact id is reproducible evidence, not a
session-local handle. `core/projection/artifacts.mjs` is a pure fold — nothing is stored, so
replay/fork/resume reconstruct the identical artifact set for free.

### Compaction — on by default, budget-aware, with provenance

Three changes:

- **On by default** (`compactContext = true`).
- **Budget-aware**: it no longer runs every turn. It runs when the outbound array actually
  exceeds `contextBudgetBytes` (default 24 000). Measuring real outbound size is the honest
  trigger — turn count says nothing about context pressure, and one enormous result matters more
  than twenty small ones.
- **Provenance**: `context.compacted` now records `elided_tool_call_ids`, `outbound_bytes_before`
  and `budget_bytes`, not merely a count. Without the ids the record says a transformation
  happened but not what it touched, and cannot be audited against the log it describes.

Two evidence rules were added to the placeholder:

- **Verify verdicts survive.** A `verify` result's first line is its verdict
  (`PASS (exit 0) npm test`). Eliding it would discard the proof while keeping the claim — the
  exact failure Wave 1 exists to prevent. The body is still elided; only the verdict is carried.
- **Elided content names its artifact**, so the full bytes stay addressable after compaction.

The safety property is unchanged and now explicitly tested: compaction rewrites **only** the
outbound provider array. It never touches the event log or the projection.

---

## Acceptance tests — `tests/context/`, 50 assertions

```
context/contract-version                                    3
context/artifact-identity-and-provenance                   10
context/artifacts-are-created-for-oversized-output          6
context/compaction-is-budget-aware                          5
context/compaction-never-touches-the-durable-log            3
context/verify-verdicts-survive-compaction                  4
context/elided-content-still-points-at-its-artifact         3
context/THE-BIG-ONE-...                                     16
```

### The compaction–replay identity test (the one the wave turns on)

A run long enough to **actually** trigger compaction, then three checks that would all diverge if
compaction had leaked into the log:

```
PASS  compaction ACTUALLY fired during this run — 12 compaction events over 156 events
PASS  artifacts were created
PASS  the run completed
PASS  replay makes no model calls
PASS  replay reconstructs the same event count
PASS  the plan survived a compacting run
PASS  every plan step is still done — s1.1:done s1.2:done s1.3:done
PASS  step evidence survived
PASS  an independent reader folds the identical plan
PASS  and sees the identical artifact set
PASS  artifact a_4afda4a3f4 still resolves and verifies after compaction   (×5 artifacts)
```

### Evidence-integrity tests

```
PASS  the log still holds full, unelided tool results — largest 16002B
PASS  no placeholder text ever entered the log
PASS  its VERDICT survived in the placeholder
PASS  its body did not — 100B
PASS  the placeholder references the artifact id
PASS  an unknown artifact id is an explicit miss — no such artifact
```

---

## Manual terminal protocol — real installed package, real model

Packed and installed globally; contract v3, 36 types, 52 exports including the artifact API.

### Run 1 — a long run that did **not** trigger compaction (the useful negative)

`gemma4-31b` on a 12 kB module plus a broken `calc.py`. It planned, read, edited, and verified:

```
✓ plan → ✓ read big_module.py → ✓ read calc.py → ✓ edit → ✓ verify PASS (exit 0) py -m pytest -q
✓ model_finished        cat calc.py → return a + b        pytest → 1 passed
```

**But: 0 compactions, 0 artifacts across 134 events.** Measured why:

```
WINDOW / MSG_CLAMP  : 40 / 2000
messages in window  : 28
outbound bytes      : 6354        (default budget 24000)
largest tool result : 1565        (artifact threshold 4096)
```

This is a real finding, not a defect. `read` is **paged** at 1 500 B and every message is
**clamped** at 2 000 B, so an ordinary run's whole context is ~6 kB — far under any sensible
budget. **ADR-001's bounded projection was already doing the job.** Compaction and artifacts are
second-order mechanisms that engage only when a *single* result escapes those bounds. Lowering
the thresholds so the feature "looks used" would be tuning to flatter the feature; compacting
6 kB helps nothing.

The realistic trigger is a tool whose output is **not** paged: `bash` and `verify` are clamped by
the sandbox at 64 kB, not 1.5 kB.

### Run 2 — the realistic workload, artifact confirmed

A test emitting ~29 kB of output:

```
✓ plan → ✓ read → ✓ edit → ✓ verify PASS (exit 0) py -m pytest -q -s noisy_test.py
✓ model_finished
```

Ground truth: `return a + b`, `2 passed`. And the artifact, read back from the durable log by a
separate process:

```
run              : run_ccc8782086 | events: 135
artifact.created : 1

 a_0bb7bb21eb  verify  28.1kB  py -m pytest -q -s noisy_test.py
   resolves: true | sha256 verified: true | full bytes: 28759
   provenance -> event #118 | preview: "PASS (exit 0) py -m pytest -q -s noisy_test.py\ncheckin"

plan: r1 SATISFIED | 4/4 steps

replay → model_calls_made: 0 | status: completed | events: 135
```

An artifact created by a real model on real output, resolving through its provenance link with a
**verified sha256**, in a run that still replays at zero model calls.

---

## Deviations and honest findings

1. **The precondition gate was not met when Wave 3 code began.** Wave 3 proceeded on explicit
   instruction while Windows CI was red. The matrix went green later in the same session
   (run `33958602579`), so the gate is now satisfied — but the ordering was not what the brief
   specified, and is recorded here rather than smoothed over.

2. **Compaction does not trigger on ordinary runs, by design of the layer beneath it** (measured:
   6 354 B outbound against a 24 000 B budget). Reported rather than tuned away. If a future
   measurement shows real runs pressing the window, the budget is one number to change —
   `contextBudgetBytes` on the Worker.

3. **`read` never produces artifacts** because it is paged below the threshold. Artifacts are for
   unpaged output — `bash`, `verify`. This is a consequence of ADR-012's paging, not a gap.

4. **Two test-side defects found during acceptance, both my own.** The hand-built message arrays
   used the internal `{name, args}` tool-call shape while `compactMessages` reads the OpenAI wire
   shape (`tc.function.name`) — which is what the worker actually emits. The name silently came
   back empty and the verify-verdict rule looked broken when it was not. Separately, the long-run
   test issued 8 identical reads and tripped the no-progress detector, **correctly**; interleaving
   a write fixed it and is also more realistic.

5. **The frozen set grew to 36 and the contract to v3**, documented in-source with what each
   version introduced. Members are only ever added, so a v1 or v2 log still replays.

6. **Step evidence remains model-declared.** Folding it with runtime-derived evidence
   (`future-queue.md` Q1) is adjacent to this wave's provenance work but was **not** pulled in —
   it needs a designed answer to step windowing and override semantics, and inflating Wave 3 with
   it was explicitly out of scope.

7. **Not republished.** Version stays `0.1.2`; manual tests used a locally packed tarball.

---

## Files changed

| File | Change |
|---|---|
| `src/core/projection/artifacts.mjs` | **new** — identity, hashing, provenance, resolution |
| `src/core/projection/compact.mjs` | provenance ids, verdict retention, artifact references |
| `src/core/event/index.mjs` | contract **v3**, `artifact.created` |
| `src/agent/loop/worker.mjs` | compaction on by default + budget-aware; artifact creation |
| `src/index.mjs` | artifact API exported; stale "OFF BY DEFAULT" note corrected |
| `tests/context/` | **new** — 50 assertions |
| `tests/run-all.mjs` | suite registered |
| `tests/planning/planning.test.mjs` | version assertion relaxed to ">= v2" so later waves need no edit |

Committed separately beforehand (CI, not Wave 3): `f2e2632`, `f728a48`, `2e70054`, `add72cf`.

---

## STOP — WAVE 3 COMPLETE. No Wave 4 started.
