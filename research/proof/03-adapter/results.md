# Experiment 3 — Results: External Harness Adapter

**Tests H-06** (external agent loops can be normalized into the proposed event model without
destroying fidelity).
**Artifacts:** `adapter.mjs` · `test-fidelity.mjs` (20 checks) · `fidelity-results.json` ·
`adapter.md` · `event-fidelity.md`

---

## 1. Verdict

> **H-06 — PARTIALLY SUPPORTED, with one hard limit.**
>
> Control flow normalizes cleanly: an external run becomes a valid event log, and **replay, fork
> and explain all work on it** (tests 5.1–5.4). But two things were learned that change the design:
>
> 1. **The closed 31-type vocabulary is not viable** — it loses 33 field kinds including cost,
>    latency, cache accounting and diagnostics. `core types + extensible payload` preserves 54/56.
> 2. **Crash recovery on a rented loop is turn-level, not tool-level** — the SDK emits no
>    "tool started" signal, so an in-flight tool is invisible and the orphan-recovery machinery
>    from Experiments 2 and 4 has nothing to act on. **This is a property of the external protocol,
>    not a fixable adapter defect.**

```
RESULT: 18 passed, 2 failed
```
The 2 "failures" are the intended demonstration — checks 4.1 and 4.3 assert that *closed* mode
**cannot** answer cost and cache questions. They failing is the finding.

---

## 2. What worked

| Check | Result |
|---|---|
| 1.1 stream normalized without error | 14 SDK messages → 13 core events |
| 1.2 every emitted type is in the closed vocabulary | **all valid** — the invariant holds |
| 1.3 projection derives a terminal state | `completed` |
| 1.5 permission denial → `tool.denied` | pass |
| 1.6 rate limit + api retry → `degraded` | 2 events |
| 1.7 SDK compaction → `context.compacted` | pass |
| 3.2 core event types identical in both modes | pass — extensions do not perturb the reducer |
| 5.1 replay deterministic on an adapted run | pass |
| 5.2 point-in-time replay | pass (`seq=6`, `status=pending`) |
| 5.3 **fork an adapted run** | pass |
| 5.4 explain renders full history | pass |

A rendered adapted history — this is what "explain" gives you for a run our loop never executed:
```
  1 run.created        {"scope":"external","principal":"sdk","ext":{"session_id":"s1"...
  2 turn.started       {"input":"build the mini project","ext":{"uuid":"u1"}}
  3 model.responded    "Creating a.txt" tools=1
  4 tool.requested     {"tool_call_id":"tu1","name":"Write",...}
  5 tool.succeeded     Write -> wrote a.txt
  6 degraded           model: rate limited
  7 degraded           model: api retry #1
  8 model.responded    "Now editing" tools=1
  9 tool.failed        Bash !! permission denied
 10 context.compacted  {"trigger":"auto","ext":{"pre_tokens":40000}}
 11 model.responded    "Done: created a.txt." tools=0
 12 run.completed      success
 13 tool.denied        Bash DENIED permission_denied
```

**That output is the strongest single piece of evidence for the thesis in this experiment.** A run
executed entirely by someone else's agent loop is now inspectable, replayable and forkable in our
model. Renting the loop while owning the history is demonstrably possible.

---

## 3. The two findings that change the design

### 3.1 Closed vocabulary: reject

| | closed | extension |
|---|---|---|
| field kinds lost | **33** | **2** |
| fields preserved as ext | 0 | 54 |
| cost answerable | no | `$0.0123` |
| TTFT answerable | no | `410 ms` |
| cache hit answerable | no | `cache_read=900` |
| thinking blocks | no | yes |

The lost set in closed mode is: `total_cost_usd`, `usage`, `modelUsage`, `ttft_ms`, `duration_ms`,
`duration_api_ms`, `num_turns`, `stop_reason`, `api_error_status`, `structured_output`,
`cache_read_input_tokens`, `cache_creation_input_tokens`, `thinking_blocks`, `session_id`, `uuid`,
`parent_tool_use_id`, `pre_tokens`, and provider-specific config.

**Decision: event *types* stay closed (31); event *payloads* become extensible.** This preserves the
property that the reducer is total and replay is deterministic (verified by 1.2 and 3.2), while
keeping the data an operator needs.

**Promote two things from `ext` into core**, because every provider has them and they answer
first-order questions: **cost/usage** and **latency** on `model.responded` / `run.completed`.

### 3.2 Tool-level recovery is impossible on a rented loop

```
tool.requested=1  tool.started=0  terminal=3
projection at crash point: pending_tool_calls = []
```

Our own loop emits `tool.started` between authorization and execution, which is precisely the window
a crash falls into — and Experiment 4 test B proved recovery works there
(`orphaned write (SAFE_RETRY) -> reissue`). The SDK has no equivalent message: it emits
`can_use_tool` (before the decision) and then a `tool_result` (after completion), with nothing in
between.

So for adapted runs:
- **Detectable:** the turn was in flight.
- **Not detectable:** which tool was executing, with what arguments, and whether its effect landed.
- **Only safe action:** escalate or restart the whole turn.

**This asymmetry should be surfaced in the adapter's capability set**, exactly as QM declares
capability gaps rather than pretending parity (`LESSONS.md` L-02):

```
capabilities: { recovery_granularity: 'turn' }    // our own loop: 'tool'
```

It also retro-explains an audit finding: QM's durability is run-level (lease → reaper → requeue the
whole run) rather than step-level. QM rents four loops, so **run-level is the only granularity
available to it.** That was previously read as a design choice; it is better understood as a
consequence of renting.

---

## 4. Implication for the architecture

The interesting consequence is that **owning the loop and renting the loop are not
interchangeable** — they buy different guarantees:

| | own loop | rented loop |
|---|---|---|
| replay | yes | yes |
| fork | yes | yes |
| explain | yes | yes (richer, if extensions kept) |
| resume after crash | **tool-level** | **turn-level only** |
| cost/latency data | whatever we record | richer than ours (provider-native) |

This argues for the built-in loop being the **default and the reference**, not a fallback — because
it is the only configuration where the full recovery story holds. External adapters are then a
genuine feature ("bring your existing agent, get history and forking") with an honestly declared
weaker guarantee, rather than an equal peer.

That is a modest but real revision to `DECISION-MATRIX.md` D-02, which framed own-vs-rent as
symmetric.

---

## 5. Threats to validity

1. **The message stream is a reconstruction from `sdk.d.ts`, not a live capture** (no credentials).
   Type inventory, field names and shapes are real; the sequence is authored. A live run could
   surface message types I did not model — though it could only *add* to the lost set, not shrink it.
2. **n = 1 adapter.** The brief asked for one. Codex uses `responses-api` and OpenCode its own
   format; QM keeps a distinct `transcriptFormat` per adapter, which suggests real divergence.
   **The `tool.started` absence may not generalise** — a different vendor might expose it, which
   would make recovery granularity a per-adapter capability rather than a universal limit. Untested.
3. **The 100-type headline overstates the gap.** Many SDK types are control-plane/UI
   (`set_color`, `reload_plugins`, `file_suggestions`) and belong in no durable log. The
   agent-relevant subset is ~20–25. The field-level ledger (§3.1) is the honest measure.
4. **No live external process was driven, killed, or resumed.** §3.2 is demonstrated by projection
   over an adapted log, not by killing a real SDK subprocess.
