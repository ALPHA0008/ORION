# Handoff to Claude — Close the two W10 honest gaps (A1 true concurrency, A2 hosted gate)

> Written by opencode (big-pickle) as a supervising handoff. Your job is to IMPLEMENT, then
> RUN, then REPORT. Do not redesign the approach — the design constraints below were settled
> against the existing tests and changing them will either break a shipped invariant or reopen a
> race.
>
> Total scope: two milestones. A1 (code + tests) is provider-independent and should be done
> first. A2 (hosted-model gate) depends on a live model endpoint — see Part 0 for the current
> outage.

---

## Mission

W10 delivered subagents (commit `93703bd`). Two claims in that wave's report remain **honest
gaps**, recorded in its §11.4:

1. **No hosted child ever reached `completed`.** The gate ran into a Hive endpoint outage and a
   Gemini free-tier 429; the success path was only shown via a local stub endpoint.
2. **Two children have never run genuinely concurrently.** The worker executes a turn's tool
   calls in a sequential `for` loop and `spawnChild` is awaited, so "parallelism" is only
   capacity (quotas, leases, WAL) — never simultaneity. This is acceptance criterion #4 of W10.

Your milestones:

- **A1 — make two `subagent` calls emitted in ONE model turn run genuinely concurrently**, with a
  test that PROVES overlap, while preserving every existing invariant.
- **A2 — re-run the W10 §11.2 hosted gate** so a REAL model's child reaches `completed`.

---

## Part 0 — the Hive keys are 500: what actually happened, and the fix

**Do not mark any Hive key exhausted or dead. This is an endpoint outage, not key sickness.**

Evidence (all gathered 2026-09-16):
- A bare probe — `POST https://api.thehive.ai/api/v3/chat/completions` with
  `Authorization: Bearer <key>`, body `{"model":"zai-org/glm-5.3-flash","messages":[{"role":"user","content":"hi"}]}` —
  returns **HTTP 500** for **all six** Hive keys.
- The sixth key (`hive-6`) was **brand new and never used** when the user handed it over, and it
  also returned 500 on its first-ever request. A key that can be `exhausted` returns **429** (rate
  limit) or **403 `insufficient_quota`** on use, not a 500 on a bare probe. A never-used key
  cannot be exhausted.
- Conclusion: `api.thehive.ai` is having a server-side outage affecting all models
  (`zai-org/glm-5.3-flash` included). 500 = server fault.

**The fix that was applied (your situation awareness, not something you need to redo):**
- Graduated the user's new key in as **`hive-6`** in the key vault at
  `C:\Users\abhijith.p\.orion-keys\keys.json` (which is the source of truth for values).
- Probing rule: a **500 is not a key fault** — endpoint-wide 500s leave keys `healthy`;
  only 429/403 `insufficient_quota` marks a key `quotaExhausted`; only a key-specific 401/403
  `invalid_api_key`/`rate_limit_exceeded`-for-that-key marks it dead. Never de-count a key on a 500.
- Vault now holds 16 keys: `hive-1..6` (`https://api.thehive.ai/api/v3`), `gemini-a/b`
  (exhausted daily-counter), `gemini-1..5` (reserve), `groq-1` (gpt-oss-120b, unused),
  `openai-1/2` (dead).

**What A2 needs from you:** the Hive 500 is a provider fault with nothing to fix locally. Try
Hive first when you run A2 (cycle oldest-`lastUsed` first, prefer `hive-6`, one key per UTC day).
If Hive is still 500 on the day you run, fall back to the reserve pool — `gemini-1..5`, then
`groq-1` (`gpt-oss-120b`). The rotation policy and probe helper live in
`research/productization/context-and-key-usage-guidelines.md` (§1–§3).

---

## Part 1 — Milestone A1: true child concurrency

### 1.1 The three load-bearing constraints (read these, do NOT violate them)

1. **The tool contract is synchronous.** `tests/shipped/w10-shipped.test.mjs` calls
   `p.tools.subagent.run({ task })` directly and asserts the RETURNED RENDERED STRING names the
   child and states a terminal `/completed|failed/` status. `spawnChild` is awaited inside the
   tool's `run`, so any design where the tool returns a "pending" promise or a status other than
   terminal breaks the shipped contract. **Fire-and-return is rejected.**
2. **The X5 cancel invariant.** `tests/leaseheartbeat/leaseheartbeat.test.mjs:346-407`: a
   two-tool turn where the signal aborts DURING the first tool must still let the first reach its
   terminal event, and **the second must never start** (`eq('only the first tool call ran', calls, 1)`,
   `eq('exactly one tool call started', started.length, 1)`, and the park must be recorded AFTER
   the tool resolved). **Full-batch `Promise.all` over a turn's whole `tool_calls` array is
   therefore REJECTED** — it would start the second tool the instant the first starts, violating
   `calls === 1`.
3. **Escalation parks and stops.** `tests/escalationgate/escalationgate.test.mjs` asserts no
   events after `run.paused` and that the model is never called again after an escalation. A
   child can never escalate: `ask_user` is in `CHILD_FORBIDDEN_TOOLS` (`src/core/child/scope.mjs:41`),
   so a batch containing only `delegates` tools can never park mid-way. This is what makes batching
   subagents safe.

### 1.2 The design (settled — implement exactly this)

**Amendment to the worker's tool-dispatch loop:** keep the sequential, per-tool loop with its X5
cancel checkpoint, but when the model emits CONSECUTIVE `delegates: true` tool calls in one
response, dispatch that maximal run of consecutive delegates as a `Promise.all` batch. A delegate
is declared via the existing `delegates: true` flag on the tool — already set for `subagent`
(`src/core/child/tool.mjs:65`). Do NOT touch `tool.mjs`.

Why this is correct:
- The classic parallel-delegation shape IS consecutive calls (`[subagent A, subagent B]`), so the
  batch captures the real use case.
- Non-delegate tools — including anything that can escalate — keep the sequential path verbatim,
  so X5 and escalation semantics are unchanged byte-for-byte. A single `subagent` with no delegate
  sibling is also sequential (a batch of 1 is just the normal path).
- Each batch member's `#runToolCall` awaits its child to terminal and records its own full tool
  lifecycle under its own `tool_call_id` — sync contract intact, no orphan, no abandonment.
- The batch cannot park mid-way (delegates never escalate) and cannot exceed `MAX_LIVE_CHILDREN`
  because the spawn gate is now atomic (see 1.4).
- Parent-side event appends from two batch members interleave; SQLite's single IMMEDIATE
  transaction per append keeps `seq` contiguous. "tool A succeeded" and "tool B succeeded" may
  land in EITHER order — assertions must never depend on which child finished first.

### 1.3 Change 1 — `src/agent/loop/worker.mjs`, the tools dispatch block

Find this (currently ~lines 472–482):

```js
      // ---- tools ----
      //
      // X5 checkpoints bracket the dispatch but never interrupt a single call: the model has
      // already responded, so stopping here wastes nothing and abandons nothing. Between calls
      // the previous one has reached its terminal event, so there is no orphan to recover.
      for (const tc of resp.tool_calls) {
        const c = this.#checkCancelled(runId, leaseToken, signal, 'before tool call');
        if (c) return c;
        const paused = await this.#runToolCall(runId, leaseToken, tc);
        if (paused) return paused;
      }
```

Replace with (keep the existing comment, APPEND to it so reviewers see the W10-A amendment):

```js
      for (let i = 0; i < resp.tool_calls.length; i++) {
        const tc = resp.tool_calls[i];
        const c = this.#checkCancelled(runId, leaseToken, signal, 'before tool call');
        if (c) return c;

        // W10-A — TRUE child concurrency. Consecutive delegates (`subagent`) in one response are
        // dispatched as a concurrent batch: overlapping sibling children is the whole point of the
        // delegation class. Everything else keeps the sequential order and per-call cancel
        // checkpoint, so the X5 "the second must never start" invariant and the "no events after
        // run.paused" invariant are untouched. A delegate can never escalate (children may not ask
        // a human — scope.mjs CHILD_FORBIDDEN_TOOLS), so a batch cannot park mid-way.
        const next = resp.tool_calls[i + 1];
        if (this.tools[tc.name]?.delegates !== true || !next || this.tools[next.name]?.delegates !== true) {
          const paused = await this.#runToolCall(runId, leaseToken, tc);
          if (paused) return paused;
          continue;
        }

        const batch = [tc];
        while (i + 1 < resp.tool_calls.length
               && this.tools[resp.tool_calls[i + 1].name]?.delegates === true)
          batch.push(resp.tool_calls[++i]);

        const results = await Promise.all(batch.map(t => this.#runToolCall(runId, leaseToken, t)));
        // A stop (lease lost) from any member ends the run; first in batch order wins so the
        // decision is deterministic.
        const stopped = results.find(r => r);
        // A cancel that landed while the batch ran stops the run now, before any later call in
        // this turn — for ordinary tools nothing changes.
        const c2 = this.#checkCancelled(runId, leaseToken, signal, 'after delegation batch');
        if (c2) return c2;
        if (stopped) return stopped;
      }
```

No other change to `worker.mjs`. `#runToolCall` is untouched; the batch is dispatched at the same
point the sequential loop would have, after a cancel checkpoint.

### 1.4 Change 2 — `src/core/run/store.mjs`, the atomic spawn gate (`reserveChildSpawn`)

**Why it is needed.** With a concurrent batch, two (or three) `spawnChild` calls race. The old
gate in `executor.mjs` folded the lineage OUTSIDE any transaction, so three racers could all read
"0 running" before any `child.spawned` committed and all three would spawn — blowing past
`MAX_LIVE_CHILDREN = 2`. The fix: the quota verdict, the child's `runs` row, the child's
`run.created` and the parent's `child.spawned` all commit in ONE IMMEDIATE transaction, so racers
serialise on the write lock and the second racer sees the first's `child.spawned`.

**Imports** (top of store.mjs, next to the existing `../event/index.mjs` import):

```js
import { canSpawn } from '../child/quota.mjs';
import { QuotaError } from '../child/quota.mjs';
```

> Verify no import cycle before finalising: `quota.mjs` imports only
> `../projection/lineage.mjs`; `lineage.mjs` does not import `store.mjs`. If you find otherwise,
> stop and resolve structurally rather than pushing a cycle.

**New method on `Store`** (place it next to `createRun`):

```js
  /**
   * Atomically reserve one child spawn for `parentRunId`.
   *
   * Under ONE write transaction it: (1) verifies the parent's lease is live (fencing),
   * (2) recomputes the delegation quota verdict from the LOG so racing spawns serialise on the
   * write lock and can never exceed the live/total/depth ceilings, (3) creates the child's `runs`
   * row with `parent_run_id` set, (4) appends `run.created` on the child's own trajectory and
   * (5) appends `child.spawned` on the parent's. If the gate refuses, NOTHING is written and
   * `QuotaError` is thrown (the parent asked for something it may not have). If the parent no
   * longer owns its lease, `LeaseLostError` is thrown.
   */
  reserveChildSpawn(parentRunId, leaseToken,
    { runId, task, scope = 'personal:local', principal = 'local',
      quota, depth = 1, parentBudget = null, parentTokens = 0,
      spawnedPayload = null, at = Date.now() } = {}) {
    const spawned = spawnedPayload ?? {};
    return this.tx(() => {
      if (!this.#leaseIsLive(parentRunId, leaseToken)) throw new LeaseLostError(parentRunId);
      const verdict = canSpawn(this.events(parentRunId), { quota, depth, parentBudget, parentTokens });
      if (!verdict.ok) throw new QuotaError(verdict.reason, { kind: verdict.kind });

      this._insRunFull.run(runId, parentRunId, null, scope, principal, 'pending', 0, at, String(task));
      const childSeq = Number(this._maxSeq.get(runId).m) + 1;
      this._insEvent.run(runId, childSeq, 'run.created', at, null,
        JSON.stringify({ scope, principal, parent: parentRunId, forked_from_seq: null, task: String(task) }));
      const parentSeq = Number(this._maxSeq.get(parentRunId).m) + 1;
      this._insEvent.run(parentRunId, parentSeq, 'child.spawned', at, null, JSON.stringify(spawned));
      return runId;
    });
  }
```

Notes:
- Do NOT call `this.append(...)` inside the tx body — `append` starts its own IMMEDIATE
  transaction and nested `BEGIN` throws. Use `_maxSeq` + `_insEvent` directly, exactly as
  `reclaimStale`/`appendStatus` already do inside their `tx(...)`.
- `childSeq`/`parentSeq` allocated inside the tx are each `MAX(seq)+1` for the respective run.
- If you prefer to keep the child row lineage column name in the row consistent with `createRun`,
  note `_insRunFull` already sets `parent_run_id` — recheck the argument order in `#prepare()`
  (`id, parent_run_id, forked_from_seq, scope, principal, status, attempts, created_at, task`).

### 1.5 Change 3 — `src/core/child/executor.mjs`, route `spawnChild` through the atomic gate

Replace the current gate + creation block with ONE call. Current structure (lines ~86–141):

- `resolveQuota`, `events` read, `parentState` read;
- `canSpawn` pre-flight → throws `QuotaError`;
- policy: `narrowestPosture`, `resolveChildTools`, `childAuthOptions`;
- `childId = childRunId()`;
- `store.createRun(childId, { parent: parentRunId, task })`;
- `store.append(parentRunId, 'child.spawned', {...})`.

New structure (keep the policy block, drop the old pre-flight and the two separate writes):

```js
  const quota = resolveQuota(quotaCfg);
  const parentState = project(store, parentRunId);

  // ── policy: strictest of parent and request, tools the parent actually holds ────────
  const childPosture = narrowestPosture(parentPosture, requestedPosture);
  const { tools: childTools, granted, refused } = resolveChildTools(tools, allowTools,
    { denyTools: authOptions?.denyTools ?? [] });
  const childAuth = childAuthOptions(
    { ...authOptions, availableTools: Object.keys(tools ?? {}) },
    { granted, posture: childPosture });

  const childId = childRunId();
  const childBudget = quota.budget;
  const childModel = makeModel ? makeModel(modelName) : null;

  // ── the gate, ATOMIC — and the child's durable birth, in ONE transaction ──────────
  // Nothing is written when the gate refuses: a refused spawn leaves no run row and no
  // child.spawned (W10-A: a racing parallel batch can never exceed the live ceiling). The verdict
  // is computed inside the store's write transaction, so two racers serialise on the write lock —
  // the second sees the first's child.spawned. Throws QuotaError (the parent asked for something
  // it may not have) or LeaseLostError.
  store.reserveChildSpawn(parentRunId, parentLeaseToken, {
    runId: childId,
    task: String(task),
    quota, depth,
    parentBudget,
    parentTokens: parentState?.budget?.tokens ?? 0,
    spawnedPayload: {
      parent_run: parentRunId,
      child_run: childId,
      task: String(task),
      reason: reason ? String(reason) : null,
      scopes: {
        tools: granted,
        mutating: mutatingGrants(childTools),
        refused: refused.map(r => r.name),
        deny_tools: childAuth.denyTools.length,
      },
      model: modelName ?? childModel?.name ?? null,
      provider: provider ?? childModel?.provider ?? null,
      posture: childPosture,
      isolated: isolated ?? sandbox?.capabilities?.isolated ?? false,
      depth,
      budget: childBudget,
    },
  });

  log?.(`  subagent: spawned ${childId} (${granted.length} tools, posture ${childPosture})`);
  for (const r of refused) log?.(`  subagent: refused \`${r.name}\` — ${r.why}`);
```

Everything AFTER the old `store.append(child.spawned,...)` (the claim/Worker/run/child.finished/
return block, lines ~143–231) stays **identical**. Clean up now-unused imports: `canSpawn` is no
longer called here (keep `resolveQuota`; drop `QuotaError`/`canSpawn` from the import if they
become unused — the tsc `--noEmit` pass will tell you).

### 1.6 Change 4 — NEW suite `v0/tests/subagent/parallel.test.mjs`

Model it on `tests/subagent/lifecycle.test.mjs` (same helpers: `scripted`, `say`, `call`,
`parentRun`, `base`, the `setChildCompletionContract` injection via
`defaultCompletionContract` from `../../src/cli/index.mjs`). The parent is driven by a REAL
`Worker` whose `tools` is `{ ...parentTools, subagent: makeSubagentTool(ctx) }` where
`ctx = { store, makeModel, depth, quota }`. Children are real `Worker` loops with stubbed models,
running the shared parent sandbox (a `note.txt` already in the workspace, like lifecycle).

Rig sketch:

```js
import { Worker } from '../../src/agent/loop/worker.mjs';
import { makeSubagentTool } from '../../src/core/child/tool.mjs';
const { defaultCompletionContract } = await import('../../src/cli/index.mjs');
setChildCompletionContract((store, childRunId, childTools) =>
  defaultCompletionContract(store, childRunId, { tools: childTools }));

function delegationRig({ parentModel, makeChildModel, maxTurns = 5 } = {}) {
  const p = parentRun('par');                       // from lifecycle pattern: sandbox+store+run+lease+tools
  const subagent = makeSubagentTool({ store: p.store, makeModel: makeChildModel });
  const worker = new Worker(p.store, {
    sandbox: p.sandbox, store: p.store,
    authorize: createAuthorizer({ posture: 'auto', denyTools: [], escalateTools: [],
       denyCommandPatterns: [], protectedPaths: [] }),
    tools: { ...p.tools, subagent },
    model: parentModel,
    leaseMs: 120_000, maxTurns,
  });
  return { p, worker };
}
const seqs = (store, runId) => store.events(runId).map(e => e.seq);
const contiguous = (store, runId) => seqs(store, runId).every((s, i) => s === i + 1);
```

The child model for the concurrency proof — a **barrier**: every child's FIRST invoke blocks
until BOTH children have entered. If the worker dispatched them sequentially, the first child
would wait the full timeout, its model call would throw, and BOTH children would fail — so the
test fails loudly and deterministically under a sequential implementation.

```js
function barrierChild(barrier, answer = 'the child answer') {
  let first = true;
  return { name: 'barrier-child', provider: 'test', capabilities: new Set(['tools']),
    async invoke() {
      if (first) { first = false; barrier.enter(); await barrier.promise; }
      if (!first) return say(answer);
      return call('read', { path: 'note.txt' });
    } };
}
const makeBarrier = (n, timeoutMs = 2_000) => {
  let entered = 0; let resolve, reject; const timer = setTimeout(() =>
    reject(new Error('barrier timed out — children were run sequentially, not concurrently')), timeoutMs);
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { enter() { entered += 1; if (entered === n) { clearTimeout(timer); resolve(true); } },
           get promise() { return p; } };
};
```

> Corollary: a child must do REAL work for the honest-completion contract to judge it completed —
> exactly like lifecycle's `workingChild` (`read` a file, then `say`). A child that answers with
> no tool calls is judged `finished_without_change` (a shipped rule, by design).

**Test blocks (exactly these five):**

1. **`w10/parallel: two siblings in one turn run CONCURRENTLY (barrier proof)`**
   - `parentModel = scripted([twoSubagents('a','b'), say('both done')])` where `twoSubagents`
     returns one response with TWO `tool_calls` both named `subagent`.
   - Run the worker; assert: parent `completed`; exactly 2 `child.spawned` and 2 `child.finished`,
     both with status `completed`; **`sawBoth === true` is the overlap proof** (both children
     entered their first model invoke before either left it); parent log `seq` contiguous; each
     child log is internally contiguous and ends terminal; `projectLineage` shows `spawned 2 /
     finished 2 / running 0`; the parent log contains NO `model.*` events. Never assert *which*
     child finished first.
2. **`w10/parallel: a three-way race can never exceed the live ceiling`**
   - Parent emits THREE `subagent` calls in one turn (children are plain `workingChild`-style, no
     barrier). Run it. Assert: exactly 2 `child.spawned` and 2 `child.finished`; exactly ONE
     `tool.failed` whose `error` contains `cannot delegate` and mentions `already running`; the
     refused child has no `runs` row and no `child.spawned`; parent `completed`; `projectLineage`
     `spawned 2`. Do NOT assert which two succeeded — the order is nondeterministic by design.
3. **`w10/parallel: a cancel before the batch parks with no child spawned`**
   - Parent model returns TWO `subagent` calls AND aborts the run's `AbortController` before
     returning (the `#checkCancelled` "before tool call" checkpoint then fires). Assert: parked,
     reason `cancelled`, ZERO `child.spawned`, ZERO `tool.started`, no events after `run.parked`.
4. **`w10/parallel: a lone delegate followed by an ordinary tool stays SEQUENTIAL`**
   - Parent emits `[subagent, read]` in one turn. Assert: exactly 1 spawn+finish (child completed),
     and `child.finished.seq < tool.succeeded(read).seq` — proving the batch detector does not
     absorb a trailing non-delegate, and `turn.finished` arrives after both.
5. **`w10/parallel: store integrity under concurrent children`**
   - Reuse test 1's run (or a fresh identical run). Assert: every parent event `seq` is exactly
     `index+1` (no gaps, no duplicates — the "no corrupt/block-write" acceptance), every child log
     is contiguous, and re-reading events returns identical count (no lost appends).

Also add ONE shipped-level block to `tests/shipped/w10-shipped.test.mjs` (read that file first;
match its rig — a real `prepareRun`/model-factory composition whose model endpoint is dead):
parent model asks for two subagents in one turn, each child fails fast (model unreachable), and
assert BOTH children spawned, BOTH finished (`failed`), the parent completed, and both child ids
are present in `child.spawned`. This proves the parallel path through the composition root.

### 1.7 What must NOT change (guard against regressions)

- `tests/leaseheartbeat/leaseheartbeat.test.mjs` X5 suite (346–407) — must pass **unchanged**.
- `tests/escalationgate/escalationgate.test.mjs` — must pass **unchanged** (single-tool turns;
  your batch only engages on consecutive delegates).
- `tests/shipped/w10-shipped.test.mjs` existing blocks and the sync contract — must pass
  **unchanged**. Additive-only.
- Contract is **v6/49** — no new event types. The concurrency work needs none: `tool.started`/
  `succeeded`/`failed`, `child.spawned`/`child.finished`, `turn.finished` already exist.
- `tests/integration/provider.test.mjs:308` has a turn with two `read` calls; that now runs
  concurrently — no ordering assertion exists there, but scroll past it to be sure you did not
  assume order anywhere downstream.
- Do not reformat foreign files, do not add comments elsewhere, do not change `tool.mjs`.

### 1.8 Verify A1 (run from `v0`)

```powershell
$env:PATH = "C:\Users\abhijith.p\AppData\Local\Programs\Git\bin;C:\Users\abhijith.p\AppData\Local\Programs\Git\usr\bin;$env:PATH"
node tests/subagent/parallel.test.mjs
node tests/subagent/lifecycle.test.mjs
node tests/leaseheartbeat/leaseheartbeat.test.mjs
node tests/escalationgate/escalationgate.test.mjs
node tests/shipped/w10-shipped.test.mjs
node tests/integration/provider.test.mjs
npm test
npm run typecheck
npm run lint
```

Baseline before you start: **2253 passed / 0 failed / 49 suites**, `tsc` 0 errors, lint clean
(commit `93703bd`). New suite adds count; every existing number must stay green. Targets:
no regression in `leaseheartbeat`, `escalationgate`, `subagent/*`, `shipped/w10`.

---

## Part 2 — Milestone A2: hosted child reaches `completed`

When a live provider is available (Hive recovered, else `gemini-1..5` reserve, else `groq-1`):

1. Re-run the W10 §11.2 hosted gate following the procedure in
   `research/productization/wave10-subagents-parallel-prompt.md` (fixtures under
   `v0/tests/wg-fixtures`, per-gate homes under `v0/tests/wg-homes`, results written to
   `v0/tests/results-*.json`). Key rotation per `context-and-key-usage-guidelines.md` (§1: one key
   per UTC day, oldest `lastUsed` first; prefer `hive-6`; alternate keys between runs).
2. The **objective fact this gate must prove**: a REAL-model child reaches status `completed`,
   the parent folds the success into its own answer, and the paper trail verifies on disk —
   child log ends with `run.completed`; parent log has `child.spawned` then `child.finished`
   (status `completed`); `projectLineage` shows `finished 2` (with its siblings, proving the
   `MAX_LIVE_CHILDREN` cap under a real batch).
3. Record the outcome in `research/productization/wave10-subagents-parallel-report.md` §11.4 —
   update the two entries this milestone closes (true concurrency; hosted completion), leaving the
   ledger honest. Refresh the key table in `context-and-key-usage-guidelines.md` if any `lastUsed`
   or state changed.

If NO provider is live on the session (Hive still 500, reserves rate-limited), DO NOT fake it:
run A1 fully, then report A2 as **blocked on provider availability** with the exact probe result.

---

## Definition of done + report-back

Report back, in order:
1. A1 diff summary (the 3 code files + new test suite + shipped addition), each file with the
   commit-worthy summary of what changed and WHY.
2. Full verification output pasted: the 6 targeted suites + `npm test` aggregate (counts),
   `npm run typecheck` (0 errors), `npm run lint` (clean). If `npm test` shows the new suite
   added tests, confirm total = baseline + new.
3. The Hive/provider probe result at A2 time (one line: status code), and A2's verdict — either
   the hosted-child-completed evidence (run id, status, disk cite) or "blocked, provider 500".
4. Any deviation you had to make from this spec and the reason.

**Standing rules for the whole session:** do NOT commit unless the user asks; do NOT `git add -A`;
do NOT touch `v0/tests/results-*.json` (they are uncommitted churn by design); `research/`,
`archify-out/`, `research/corpus/` stay untracked; never echo key values from the vault; the event
vocabulary is a closed set — no new types without a contract change.