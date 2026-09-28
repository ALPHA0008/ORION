# Wave 10 — SUBAGENTS + PARALLEL EXECUTION

**Contract:** v6 / 49 event types — **unchanged**. W10 emits `child.spawned` and `child.finished`,
frozen in the vocabulary since the Wave-1 audit and never written until now.
**Suite:** 2017 → **2253 passed, 0 failed, 49 suites**.
**Dependencies:** unchanged — **0 required**, 1 optional (W9's MCP SDK). This wave added none.

---

## THE PROBLEM

The harness was single-worker: one model loop per run, one context window, one budget. Real tasks
need delegation — survey forty files to answer one question, trace a call chain, check a hypothesis
— and doing that inline burns the parent's context on reading it will never refer to again.

The naive implementation is `spawn('orionctl', ['run', task])`, and the plan rejects it by name:

> "**Parallelism designed, not assumed.** 'Just start more processes' is rejected: event-store write
> contention and resource contention are part of the design." (§10.2 W10)

Three things break in the naive version. Two OS processes contend for one SQLite write lock with a
5-second busy timeout as the only arbiter. Children fight over the same container's CPU and PID
limits that W6 sized for a single run. And the parent's verified work becomes unattributable —
nobody can say which trajectory produced which answer.

There was also a fourth problem, the one that makes delegation a *security* feature rather than a
convenience: **a model that cannot run `bash` has an obvious move available if spawning a child
could grant it one.** Delegation is the most attractive privilege-escalation route in an agent
runtime, and the plan says so directly: "a child inherits a posture, it never widens it" (§13).

---

## CHANGES BY FILE

### `src/core/projection/lineage.mjs` — NEW: the graph is a fold

`projectLineage` folds `child.spawned` + `child.finished` into parent/child state, exactly as
`plan.mjs` folds `plan.*`. There is no children table and no registry.

That is not stylistic. If lineage were a column, a parent resumed in a new process would not know
what it had spawned; `replay` would have to re-execute children to rebuild the graph (violating
Invariant 2 — deterministic replay at **zero** model cost); and `fork` would inherit rows describing
children belonging to a different history. As a fold, all three fall out for free.

`lineageTree` walks across runs — a child may spawn a grandchild — with cycle and depth guards,
because a projection that hangs on a malformed log is worse than one that says so.

### `src/core/child/scope.mjs` — NEW: what a child may do

Every operation moves in one direction. `narrowestPosture` returns the **stricter** of parent and
request. `resolveChildTools` grants only tools the parent **holds** and does not **deny**.
`childAuthOptions` unions denials and returns `grants: null` — a child starts cold, because
"approve this once" must not silently become "approve this for every child the model later spawns".

The subtle one: ungranted tools are added as explicit **denials**, not merely omitted. Restricting
the toolset changes what the model is *offered*; the authorizer must still refuse a call that
arrives by another route. Defence in depth, where the depth is "the policy engine agrees with the
toolset".

`ask_user` is forbidden outright: a child cannot reach a human, so asking would park it holding a
lease and a quota slot while the parent blocks on its result — a deadlock with no participant able
to break it.

### `src/core/child/quota.mjs` — NEW: the bounds, and why each number

| Bound | Value | Why |
|---|---:|---|
| `MAX_LIVE_CHILDREN` | **2** | One is not parallelism; ten is a thundering herd against a single-file store and one container's CPU quota. Two delivers the actual win with countable write-lock contenders. |
| `MAX_CHILD_DEPTH` | **2** | A grandchild is permitted (scope §6); a runaway tree is not. |
| `MAX_CHILDREN_PER_RUN` | **8** | Lifetime cap, so finishing children cannot be used to spawn unboundedly. |
| `DEFAULT_CHILD_BUDGET.tokens` | **120 000** | Smaller than a parent's 500 000 — a child is a bounded sub-task. |
| `CHILD_TIMEOUT_MS` | **600 000** | The parent's protection, not the child's: a child that never terminates holds a slot and a lease forever. |
| `CHILD_MAX_TURNS` | **20** | Half the parent's 40; a sub-task needing more is mis-scoped. |

Config may only make these **smaller** (`resolveQuota` clamps), the same discipline W8 applied to
permission rules. Crucially, `canSpawn` reads the count from the **log**, not a counter, so it is
correct in a process that just resumed a run it did not start.

**The aggregate token check** is the one that is easy to miss: without it, delegation is unmetered
spend — ten children at the per-child cap cost ten times the parent's ceiling while the parent's own
counter reads nearly zero. Delegated tokens are charged to the parent, folded from the log.

### `src/core/child/executor.mjs` — NEW: a child is a real run

Own row in `runs` (populating `parent_run_id`, a column carried since Wave 1 and never written),
own lease, own event stream, own plan, own budget, own completion verdict. Driven by the **same**
`Worker` class through the **same** store under the **same** authorizer.

In-process, not a subprocess: one connection in WAL mode serialises its own writes through a lock it
already owns, and children share the parent's already-acquired container, so a child costs no second
`docker run`. The lease keeps it honest — parent and child hold **separate** leases on **separate**
runs, so Invariant 4 (fencing) is untouched.

`reconcileChildren` handles resume: an in-process child cannot outlive its process, so a `running`
child on resume is gone and is recorded `lost` with an honest reason. A parent that silently forgot
the child it was waiting on would have lost work without saying so.

### `src/core/child/tool.mjs` — NEW: `subagent`

An ordinary tool — `{description, schema, effects, recovery, run}` — so delegation inherits the
event trail, the authorizer and the recovery contract by being *shaped* like a tool. `denyTools:
["subagent"]` forbids it with no new policy syntax.

`Mutating` because a child can do whatever its granted toolset allows; `UNSAFE` because a spawn
interrupted mid-flight has an unknowable outcome — the child may have written half a file.

### `src/cli/index.mjs` — the composition root

`subagent` is composed in `prepareRun`, so it reaches `run`, `resume` **and** each turn of the
interactive session. The completion contract is **injected** (`setChildCompletionContract`) rather
than imported, because the executor is imported *by* the CLI and a direct import would be a cycle —
and the honest-completion rule has to apply inside a child or delegation becomes a laundering route.

### `src/core/run/explain.mjs` — two renderers and one fix

`child.spawned` / `child.finished` had icons but **no text**, so they rendered as blank lines. They
now narrate the delegation, the model, the posture and the grant. Plus the child/fork fix below.

---

## TEST EVIDENCE

```
OK    subagent/scope            89 passed, 0 failed  (0.1s)
OK    subagent/lifecycle        93 passed, 0 failed  (0.7s)
OK    shipped/w10-shipped       51 passed, 0 failed  (5.4s)

════════════════════════════════════════════════════════════
TOTAL: 2253 passed, 0 failed across 49 suites
```

`tsc --noEmit` → 0 errors. `node tests/lint.mjs` → `no problems`.

### Three W9 assertions were made delta-based, not deleted

`shipped/w9-shipped` asserted absolute counts (`toolset is 15`, `toolset is exactly 11`, `mutating
set is bash,edit,write`). W10 legitimately adds `subagent`, which is legitimately Mutating. The
property each assertion protected — *MCP contributes exactly its advertised tools and nothing
mutating* — is intact, so each now asserts the **MCP delta** rather than a total. That is strictly
stronger: it keeps holding as the product grows.

### Two defects found by running the real thing

**1. A parent's denial reached the child's authorizer but not its toolset.** Caught by
`subagent/scope`'s structural loop. A run denying `bash` would still have *offered* `bash` to its
child — policy would have refused the call, but only after the model spent a turn discovering that
delegation is a dead end. Both halves are needed: the authorizer is the guarantee, the toolset is
the reason the model never tries.

**2. `explain` described a child as a fork.** Found by the §11.2 gate. A fork and a child both carry
`parent_run_id`, and until W10 only forks ever did — so a delegated child rendered as
`forked from run_X at event null`, wrong twice over. `forked_from_seq` is the discriminator; a child
now reads `child of run_X (delegated sub-task)`.

---

## MANUAL GATE (§11.2)

`npm pack` → clean install into an empty prefix; `src/core/child/*` and `lineage.mjs` verified
present inside the tarball. Fixture: a three-file call chain (`test.js` → `gamma` → `beta` → `alpha`)
with a genuinely failing test — investigation worth delegating.

### Live hosted model, installed build — run `#2b52926058` (`zai-org/glm-5.3-flash`, key `hive-2`)

```console
$ orionctl run "The test at test.js fails. Use the subagent tool ONCE to delegate a read-only
  investigation ... Then apply the fix yourself with edit, and prove it with verify."

  85  🧠 wants 1 tool call: subagent 2896→308tok
  87  🙋 subagent needs approval
  94  · subagent {"posture":"strict","reason":"The task requires delegating the call-ch…
  95  · delegated to run_5d19b09d2b [zai-org/glm-5.3-flash] posture strict
         tools: read,grep,glob,git,verify,plan,plan_step
         — "Read-only investigation in this workspace. A test …"
  97  · run_5d19b09d2b failed — model_unavailable
  98  ✓ subagent → subagent run_5d19b09d2b — failed tools: read, grep, glob, git, verify,…
 ...
     ✓ edit edited src/gamma.js
     ✓ verify PASS (exit 0) node test.js PASS
 273 ✓ completed — model_finished

status: completed / model_finished   model_calls: 14  tool_calls: 21  tokens: 52656/3372
```

Disk-verified: `report(items) { return Math.round(average(items) * 100) / 100; }`, `node test.js` →
`PASS`, exit 0.

Two things worth noticing. The model **chose `posture: "strict"` for its child unprompted** — it
narrowed the child below its own `auto`, which the lattice permits and the log records. And when the
child failed, the parent **folded the failure and did the work itself**, which is the honest
degradation path rather than a parent inheriting a child's failure.

### A child that completes, and the parent folding its answer — installed build

The hosted child could not complete (provider outage, below), so the success path was driven through
the installed binary against a local endpoint, under a **container** sandbox:

```console
  sandbox: ContainerSandbox  posture: permissive (isolated)
  subagent: spawned run_9f4943e3b1 (7 tools, posture permissive)
  subagent: run_9f4943e3b1 completed (60tok)
  ✓ subagent subagent run_9f4943e3b1 — completed (60 tokens) tools: read,…
✓ model_finished

$ orionctl explain #40eb5623bc
  12  · delegated to run_9f4943e3b1 [stub] posture permissive
         tools: read,grep,glob,git,verify,plan,plan_step
  14  · run_9f4943e3b1 completed (60tok, 1 tool calls)
  20  ✓ completed — model_finished: "Parent done."

$ orionctl explain #run_9f4943e3b1
Run run_9f4943e3b1
  child of run_40eb5623bc (delegated sub-task)     <- the fixed attribution
   6  🧠 wants 1 tool call: verify 20→10tok
   9  · verify {"cmd":"sleep 120"}
  11  ✓ verify → FAIL (exit 1) command timed out after 15000ms and was killed
  16  ✓ completed — model_finished: "child answer"
```

### Killed-child recovery — a clean ledger

```
=== BEFORE recovery (the state a SIGKILL leaves) ===
  children spawned : 1
  still running    : 1  <- the parent is waiting on a ghost
  terminal records : 0
  subagent: run_0782be09ad recorded lost (its process did not survive)

=== AFTER recovery (1 child reconciled) ===
  still running    : 0
  status           : lost
  honest reason    : the process running this child did not survive; the child was not resumed
  provenance kept  : model=stub posture=permissive

=== the parent's log now reads ===
   3  · delegated to run_0782be09ad [stub] posture permissive tools: read,grep — "the interrupted…"
   4  · run_0782be09ad lost — the process running this child did not survive; th…
```

### Honest negative — the hosted child never reached `completed`

Two independent provider failures, neither a harness defect:

- **Hive (`zai-org/glm-5.3-flash`) went down mid-gate.** Every key — `hive-1` … `hive-5` — returned
  `500 Internal Server Error` to a **bare `fetch`** with no harness involved. Before concluding
  this, I reproduced the child failure minimally and tested three request shapes (child prompt/no
  tools, parent prompt/child tools, **parent prompt/parent tools as a control**): all three 500'd,
  including the known-good parent control. That exonerates W10's request construction.
- **Gemini free tier rate-limits the child.** `models/gemini-3.6-flash` ran the child's own plan
  (`plan` → `plan_step` → `verify`, reproducing the failure inside the child's trajectory), then hit
  `429` on its next call — repeatedly, across `gemini-1/3/5`, at roughly the third or fourth
  back-to-back request. Capping `subagents.maxTurns` to 4 did not help: the limit is requests per
  minute, and a child makes them fast.

So: **a live hosted model spawned a child, the child ran its own plan and tools inside its own
trajectory, and the parent folded the outcome and completed the task** — but a hosted child
reaching `completed` with the parent folding a *success* is **unproven**, and is not claimed. The
success path is demonstrated through the installed build against a local endpoint (above).

Vault: keys referenced by id only; `lastUsed` updated for `hive-1/2/3`. Nothing marked
`quotaExhausted` or `dead` — an endpoint-wide 500 is not a key fault.

---

## 0x08 SCAN — EXPLICIT COUNTS

| Check | Count | Status |
|---|---:|---|
| `process.exit` in W10 library paths (`src/core/child/*`, `lineage.mjs`) | **0** | clean |
| stdout writes (`console.log`/`process.stdout`) from those paths | **0** | clean |
| New dependencies (required or optional) | **0** | subagents are the store's own machinery |
| Required dependencies total | **0** | `"dependencies": {}` |
| Non-`node:`/non-relative imports in W10 source | **0** | clean |
| Stray control bytes `0x00–0x08` in W10 source **and** tests | **0** | clean |
| Plaintext secrets in W10 source or tests | **0** | keys referenced by id only |
| **New event types** | **0** | v6 / 49; vocabulary diff vs HEAD is empty |

**Why no new event types:** `child.spawned` and `child.finished` were frozen in the closed
vocabulary during the Wave-1 audit and deliberately never emitted, with a comment saying they were
waiting for "subagents as child trajectories (a later wave)". This is that wave. Lineage lives in
those two payloads, attribution in the existing `tool.*` events, and ADR-004 makes payloads
extensible — so nothing needed inventing.

---

## §11.4 — WHAT IS NOT PROVEN

1. ~~**No hosted child reached `completed`.**~~ **CLOSED 2026-09-16 (milestone A2).** A real
   hosted model's child reached `completed` through the installed build under a container sandbox:
   child `run_561ecd36d7` of parent `#8bc82aa07f`, model `openai/gpt-oss-120b` (key `groq-1`),
   5 560 tokens, 4 tool calls, terminal `run.completed` and `runs.status = completed`. The parent's
   log carries `delegated to run_561ecd36d7 [openai/gpt-oss-120b] posture auto tools: read,grep,glob`
   then `run_561ecd36d7 completed (5560tok, 4 tool calls)`, and the parent **folded the success**
   into its window (`✓ subagent → … completed (5560 tokens)`) with the child's substantive answer
   naming the file, the line, and the replacement.

   **Residual gap — also CLOSED, 2026-09-16 (milestone A3).** The parent's OWN terminal completion
   after folding a child's success is now proven on a hosted model: parent `run_c2d5c197e4` and
   child `run_1eba4c8520`, `openai/gpt-oss-120b` (key `groq-2`), `ContainerSandbox`
   (`--network none`), installed build packed from the working tree. Verified three ways:

   - **`runs` rows** — `run_c2d5c197e4 status=completed`; `run_1eba4c8520 parent=run_c2d5c197e4
     status=completed`.
   - **Event logs** — parent carries exactly one `child.spawned` → one `child.finished`
     (`status: completed`, 1409 tokens, 1 tool call, `model: openai/gpt-oss-120b`) and ends
     `run.completed — model_finished`; the child's own log ends `run.completed — model_finished`.
     26 parent events, 16 child events.
   - **Disk** — the child read `src/rates.js` and reported the express rate as `12.50`; the file's
     line 2 reads `express: 12.50`. The parent's final message, *"The express rate set in
     src/rates.js is 12.50."*, is a concrete finding that matches disk — not reasoning residue.

   **What made the difference, and what it cost:** four earlier attempts died on provider walls, not
   harness faults. Groq's free tier enforces **8000 tokens per minute** (`Limit 8000, Used 7344`)
   and a delegating run that also edits and verifies needs ~11k, so it physically cannot fit;
   Gemini's free tier caps **requests**, and its child over-planned into `max_turns`. The closing
   run is therefore a pure delegation — parent delegates once, folds the answer, and replies — which
   is both the canonical subagent shape and small enough to fit the window. The edit-and-verify half
   was separately demonstrated in attempts 2 and 3 (`✓ edit edited src/rates.js` after the child
   completed) before the same ceiling stopped them.
2. ~~**Two children have never run genuinely concurrently.**~~ **CLOSED 2026-09-16 (milestone A1).**
   The worker now dispatches a maximal run of CONSECUTIVE `delegates: true` calls as one
   `Promise.all` batch, so sibling children genuinely overlap; everything else keeps the sequential
   path and its per-call cancel checkpoint, so X5 and the escalation invariants are untouched.
   `tests/subagent/parallel.test.mjs` proves overlap with a **barrier**, not a stopwatch: each
   child's first model call waits for its sibling, and the assertion is **peak simultaneous
   occupancy** (2). Verified by falsification — disabling the batch drops peak to 1 and the suite
   fails loudly. The spawn gate became atomic (`Store.reserveChildSpawn`) so three racers cannot
   pass `MAX_LIVE_CHILDREN`; a three-way race spawns exactly 2 and refuses the third with
   `cannot delegate … already running`.

   **Residual, narrower gap:** concurrency is proven for *sibling delegates within one turn*. Two
   independent top-level runs writing the same store concurrently is still untested (see item 3),
   and store integrity under the batch is asserted structurally (contiguous, gap-free, duplicate-free
   seqs) rather than benchmarked.
3. **Store contention is argued, not measured.** No benchmark of concurrent writers; the design
   rests on one in-process connection owning its own lock.
4. **A grandchild is tested at the projection level only.** `lineageTree` handles depth 2 and
   `canSpawn` enforces it, but no live run has actually spawned a grandchild.
5. **The killed-child trace is deterministic, not a real SIGKILL mid-flight.** Three attempts to
   kill a real run mid-child lost the race against the child's own 15 s tool timeout. The
   reconciliation path is driven directly against the installed build with exactly the state a
   SIGKILL leaves (a spawn with no finish), which is the state that matters — but the kill itself
   was not the trigger.
6. **Cancellation is tested in-process, not via the CLI.** There is no `orionctl cancel <child>`;
   a parent cancels by aborting its own signal, and the child's timeout is the backstop.
7. **`childModel` is wired but never exercised live.** A child can run a different model
   (recorded as provenance); no gate ran parent and child on different providers.
8. **Budget enforcement is checked at spawn, not continuously.** `canSpawn` refuses when the
   aggregate would exceed the parent's ceiling; a child that overruns *during* its run is bounded
   by its own budget and turn cap, not re-checked against the parent's.
9. **No test of a child whose lease is stolen mid-run.** The fencing invariant is inherited from
   the Worker rather than re-proven for children.

---

## VERDICT

**Ship.** All seven scope items are implemented and reached through the composition root; acceptance
1, 2, 3, 5, 6, 7 are demonstrated, 8 partially (live model, live delegation, live lineage — but the
hosted child blocked by a provider outage), and 4 is **capacity-proven rather than
simultaneity-proven** and recorded as this wave's main gap.

The two defects the wave found were both about *agreement between layers*: a denial that reached
policy but not the toolset, and a lineage column that two different features interpreted two
different ways. Neither would have been caught by testing the new code alone — the first came from a
structural loop asserting an absence, the second from running the real binary and reading what it
printed.

The most important thing this wave did **not** do is invent state. A child is a real run, lineage is
a fold, quotas read from the log, and the contract is untouched at v6/49 — because the vocabulary
had been waiting for this wave since Wave 1.

**Not started, per the stated boundary: no W11, no W12.**

---

# ADDENDUM — 2026-09-16: closing the two honest gaps (A1, A2)

**Suite:** 2253 → **2305 passed, 0 failed, 50 suites**. `tsc --noEmit` 0. Lint clean.
**Contract:** still **v6 / 49** — concurrency needed no new event type.

## A1 — true child concurrency

### `src/agent/loop/worker.mjs` — the dispatch amendment

The turn's tool loop keeps its sequential shape and its per-call cancel checkpoint, but a maximal
run of **consecutive** `delegates: true` calls is dispatched as one `Promise.all` batch.

Batching the *whole* `tool_calls` array was rejected outright: it would start a turn's second tool
the instant the first began, and `tests/leaseheartbeat` (346-407) requires that a signal aborting
DURING the first tool leaves the second **never started**. Restricting the batch to delegates keeps
that path byte-for-byte, and is safe precisely because a child can never escalate — `ask_user` is
refused to children — so a delegate batch cannot park mid-way and cannot violate "no events after
`run.paused`". A lone delegate is a batch of one, i.e. the ordinary sequential path.

### `src/core/run/store.mjs` — `reserveChildSpawn`, an atomic gate

Concurrency turned the spawn gate into a race. The quota verdict was folded in `executor.mjs`
**outside any transaction**, so three racers could each read "0 running" before any `child.spawned`
committed and all three would spawn — past `MAX_LIVE_CHILDREN`, the one bound standing between
delegation and a thundering herd against a single-file store.

The verdict, the child's `runs` row, its `run.created` and the parent's `child.spawned` now commit
in **one** immediate transaction. Racers serialise on the write lock, so the second folds a log that
already contains the first's spawn. A refusal writes nothing — no half-born child. The lease is
checked inside the same transaction, so fencing (Invariant 4) still holds.

### `src/core/child/executor.mjs` — route through the gate

The pre-flight `canSpawn` and the two separate writes collapse into one `reserveChildSpawn` call.
Policy resolution (posture, tools, auth) is unchanged, and everything after the spawn — claim,
Worker, run, `child.finished` — is untouched.

### `tests/subagent/parallel.test.mjs` — NEW (45 assertions)

The proof is a **barrier, not a stopwatch**: a timing assertion passes on a fast sequential machine
and flakes on a slow concurrent one. Each child's first model call enters a rendezvous and waits for
its sibling; under sequential dispatch the first waits for a sibling that cannot start until it
finishes, and the barrier's timeout converts that deadlock into a loud failure.

**A weakness in the first version was found by falsifying it.** Disabling the batch and re-running,
the naive assertion (`cumulative arrivals === 2`) still **passed** — sequentially the first child
enters, times out, fails, and the second then arrives. The assertion is now **peak simultaneous
occupancy**, which is 2 only under genuine overlap:

| | peak occupancy | verdict |
|---|---:|---|
| batching enabled | **2** | PASS |
| batching disabled (falsification) | **1** | FAIL — "dispatched SEQUENTIALLY, not concurrently" |

Five blocks: the barrier proof; a three-way race that spawns exactly `MAX_LIVE_CHILDREN` and refuses
the third with `cannot delegate … already running`; a cancel before the batch (parks, zero spawns,
nothing after `run.parked`); a `[subagent, read]` turn proving the detector does **not** absorb a
trailing ordinary tool; and store integrity (every parent seq exactly `index+1`, no gaps, no
duplicates, stable on re-read). Nothing asserts *which* child finished first — that is genuinely
nondeterministic.

`tests/shipped/w10-shipped.test.mjs` gains one block (51 → 58) proving the same batch path through
the real composed toolset at the composition root.

### A1 verification

```
subagent/parallel                    w10 parallel: 45 passed, 0 failed  (45 assertions)
subagent/lifecycle                   w10 lifecycle: 93 passed, 0 failed  (93 assertions)
subagent/scope                       w10 scope: 89 passed, 0 failed  (89 assertions)
leaseheartbeat/leaseheartbeat        leaseheartbeat: 45 passed, 0 failed  (45 assertions)
escalationgate/escalationgate        escalationgate: 28 passed, 0 failed
shipped/w10-shipped                  w10 shipped: 58 passed, 0 failed  (58 assertions)
integration/provider                 provider / real-HTTP: 53 passed, 0 failed  (53 assertions)

TOTAL: 2305 passed, 0 failed across 50 suites
tsc --noEmit → 0 errors      lint → no problems
```

The X5 and escalation suites pass **unchanged**, which is the point: the batch is narrow enough not
to touch them.

## A2 — a hosted child reached `completed`

**Provider probe at gate time (all 16 vault keys):**

```
hive-1 … hive-6   500 {"status_code":500,"message":"Internal Server Error"}   <- endpoint outage
gemini-a/b, 1-5   200
groq-1            200
openai-1/2        (marked dead, skipped)
```

Hive's outage persists across all six keys, including the never-used `hive-6` — a bare probe
returning 500 is a server fault, so **no key was marked exhausted or dead**. `gemini-a/b` probed 200
(their daily counter had reset), so their stale `quotaExhausted` flags were cleared; `lastUsed` was
updated for the three keys this gate actually used.

**The result — `#8bc82aa07f`, installed build, `ContainerSandbox` (`--network none`):**

```
  sandbox: ContainerSandbox  posture: permissive (isolated)
  subagent: spawned run_561ecd36d7 (3 tools, posture auto)
  subagent: run_561ecd36d7 completed (5560tok)
  ✓ subagent subagent run_561ecd36d7 — completed (5560 tokens) tools: rea…

  27  · delegated to run_561ecd36d7 [openai/gpt-oss-120b] posture auto tools: read,grep,glob
  28  · run_561ecd36d7 completed (5560tok, 4 tool calls)
  43  ✓ completed — model_finished   (in the CHILD's own log)

  child runs.status = completed
```

The child's answer, produced after four real tool calls inside its own trajectory:

> **File:** `src/gamma.js` · **Line to change:** 3 (the `report` function) · **Current line**
> `function report(items) { return average(items); }` · **Corrected line** …

Worth noting: the parent narrowed its child to **3 tools and `posture auto`** — stricter than its
own `permissive` — unprompted, and the lattice recorded it.

**What is closed:** a real hosted model's child reaching `completed`, and the parent folding that
success into its window.
**What is not (at the time of A2):** the parent's own terminal completion afterwards — closed
subsequently by A3, below.

## A3 — the closing gate: parent AND child both `completed`

Proven by parent `run_c2d5c197e4` / child `run_1eba4c8520` — full evidence in §11.4 item 1.

### A defect the gate found: an empty search path silently meant "nothing"

Hosted models kept calling `glob {"path": "", "pattern": "**/*.js"}` — `""` being the obvious way to
say "the workspace root" — and getting back:

```
(no matches)  [INCOMPLETE RESULT] 1 director(y/ies) unreadable and SKIPPED:  (error)
```

A default parameter (`path: start = '.'`) fires only when the argument is **absent**, so an explicit
`""` sailed past it and resolved to an unreadable directory. Both `grep` and `glob` had it, and it
is the worst failure mode a search tool has: the model reads "(no matches)" as *"the string is not in
this project"* rather than *"I could not look"* — the very dishonesty the `[INCOMPLETE RESULT]`
contract exists to prevent. It burned several gate attempts and real provider budget before being
traced.

Fixed at both entry points (an empty or whitespace path means the root); `tests/search/search.test.mjs`
gains a regression block (83 → 94 assertions) that also asserts a *named* subdirectory still scopes
the walk, so the fix cannot degenerate into "everything is root".

This is a **W8-era defect**, not an A1 or A3 regression — found only because a live model used the
tool the way a live model actually does.
