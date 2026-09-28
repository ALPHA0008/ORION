# Wave 1 — Truthful Completion: implementation report

Executed 2026-09-04 against ORION `v0/` (package `@kernlbase/orion`, version unchanged at
`0.1.2` — **nothing was republished**). Wave 1 scope only; no Wave 2 work started.

---

## 0. Summary

| | before | after |
|---|---|---|
| Test suite | 654 passed / 24 suites | **692 passed, 0 failed / 26 suites** |
| §1.4 scenario (gemma4-31b) | `✓ model_finished`, **file unchanged, test still failing** | **bug actually fixed**, `2 passed`, run completed after real verification |
| Slow local model (qwen3:14b) | `failed — lease_lost` | **`✓ model_finished`**, 12 lease renewals, 0 lease_lost |
| Unperformed work | reported `completed` | **`failed — finished_without_change`** |
| `turn.finished` | in the frozen vocabulary, never emitted | **emitted** (4 in a real run) |

All three defects are fixed and verified on a real terminal against live models.

---

## 1. GATE — suite green before any Wave 1 code

### What was actually wrong

The gate described `security/security` failing with
`syntax error near unexpected token '2'` at `tests/security/security.test.mjs:203`, caused by
`bash` resolving to WSL's `C:\Windows\System32\bash.exe`.

**Reproduced exactly.** Probing both shells with the test's own construct:

```
 FAIL  ...System32\bash.exe  seq    command failed (exit 2): /bin/bash: -c: line 2: syntax error near unexpected tok
 OK    bash                  seq    "line 1\nline 2\nline 3\nline "
```

Two root causes, not one:

1. **`$(seq 1 3000)` is not portable.** `seq` is not in POSIX and is absent from some bash
   builds. `{1..n}` brace expansion is a bashism and *also* misbehaved (`$i` expanded empty).
2. **WSL bash is not a substitute shell at all.** It runs in a different filesystem namespace:

   ```
   ...System32\bash.exe → /mnt/d/Abhijith P/Desktop/harness/v0
   bash (Git Bash)      → D:/Abhijith P/Desktop/harness/v0
   ```

   So even when a command parses, it cannot see the Windows workspace and silently produces
   empty output — worse than failing, because it looks like a product defect.

### Fixes

**(a) Portable loop** — `tests/security/security.test.mjs`. Replaced both `$(seq ...)` uses with
a POSIX `while` loop via a local helper, with the reason recorded in the source.

**(b) Shell preflight** — `tests/run-all.mjs`. A new `preflightShell()` runs once, before any
suite, and fails loudly with the fix rather than letting 24 suites fail confusingly. It checks
the shell can run, can see the directory it is handed, and can evaluate the constructs the
suites use. Verified it discriminates:

```
  CAUGHT  ...System32\bash.exe   out=""
  PASS    bash                   out="row 1\nrow 2\nrow 3"
```

### Gate result

```
$ node tests/run-all.mjs
OK    security/security         41 passed, 0 failed  (16.8s)
...
TOTAL: 654 passed, 0 failed across 24 suites
```

**GREEN.** Wave 1 work began only after this.

---

## 2. D1 — lease lost during a long model call

### Cause

`worker.mjs` renewed the lease only at the **top of each turn** (`:96`), but the model call
happens *inside* the turn and can outlast it. Measured in Wave 0: a realistic agent request took
**28.4 s** against a **30 s** lease. The reaper then treats a still-working run as orphaned.

### Fix

`#withLeaseHeartbeat(runId, leaseToken, fn)` in `src/agent/loop/worker.mjs` wraps the model
call and renews on an interval of `leaseMs / 3`.

Three properties the implementation had to satisfy, each covered by a test:

- **It must actually fire.** My first attempt called `timer.unref()` — reasoning that a
  heartbeat should never hold the process open. Measured, it produced **zero** renewals: an
  unref'd timer does not fire while the event loop is parked awaiting the model's promise, which
  is precisely when it is needed. Removed; the `finally` clears the timer on every path instead.
- **It must not defeat fencing.** `store.renew()` is guarded by both the lease token and
  `lease_expires_at > now`, so a heartbeat cannot resurrect a genuinely reclaimed run. A
  heartbeat that could would be a far worse bug than the one being fixed.
- **It must not leak.** A model call that throws still clears the interval.

### Tests — `tests/leaseheartbeat/` (9 assertions)

```
PASS  the model call really did outlast the lease  — 1517ms call vs 900ms lease
PASS  the run did NOT die as lease_lost  — model_finished
PASS  the lease was renewed during the call  — 5 renewals
PASS  a second worker was able to reclaim the run
PASS  the original worker did not report success after losing the lease  — failed/lease_lost
PASS  the lease is no longer being renewed after the run ended
```

---

## 3. D2 — the CLI reported success for work it did not do

### Cause

The ADR-013 gate exists and is tested, but `completionContract` defaults to `null`
(`worker.mjs:41`) and **the CLI supplied none**, so it was inert.

### Fix

`defaultCompletionContract(store, runId)` in `src/cli/index.mjs`, wired into **all three**
execution paths: `run`, `resume`, and the REPL turn.

The predicate reads the **durable event log**, not the filesystem:

| observed | verdict |
|---|---|
| a mutating tool succeeded | satisfied — the world changed |
| only read-only tools ran, no mutation attempted | satisfied — analysis really was the job |
| a mutation was attempted, none succeeded | **not satisfied** |
| nothing ran at all | **not satisfied** ← the §1.4 case |

**A design correction worth recording.** My first version made `requires_world_change` true only
once the model had *attempted* a mutation. That is conservative and wrong: in the §1.4 failure
there were **zero** tool calls, so it would not have engaged and the bug would have survived the
fix. The predicate now treats "did nothing at all" as unsatisfied while still allowing genuine
read-only tasks — catching the measured failure without fabricating failure in the opposite
direction.

Reading the log rather than scanning the workspace is what keeps this **replay-equivalent**: a
replay or a fork on another machine reaches the same verdict from the same events, which a
`statSync` sweep never could.

### Also changed

`src/cli/index.mjs` now only dispatches when it **is** the program
(`if (path.resolve(process.argv[1]) === ...)`). Previously importing it ran the CLI and exited
the importing process, so tests could not assert against the CLI's own wiring — they would have
had to reconstruct it, which is exactly how the original defect escaped notice.

---

## 4. D3 — provider shim never wired

### Cause

`shims = []` (`model/index.mjs:26`) and the CLI passed none, so vLLM/Gemma tool calls returned as
raw text were never parsed. The loop saw "no tool calls, finish_reason=stop" and stopped.

### Fix

`selectShims(modelName, env)` in `src/cli/index.mjs`:

- `ORION_SHIMS=gemma` — explicit opt-in; `ORION_SHIMS=none` — explicit opt-out.
- Otherwise **auto-detect** on a `gemma` model name. A user pointing at a self-hosted Gemma has
  no way to learn this flag exists until it has already cost them a run.

The worker already appends `degraded` when `resp.ext.shimmed` is set, so a firing shim is never
invisible — confirmed live below.

---

## 5. `verify` tool

New read-only tool in `src/agent/tools/index.mjs`. `bash` could already run a test command, but
its result is indistinguishable in the log from `ls`. `verify` records the command, exit status
and a **PASS/FAIL verdict** as ordinary `tool.succeeded` / `tool.failed` events, so "did the work
hold up?" is machine-readable evidence rather than prose.

**A correction found while implementing.** The guard was first written as
`classifyShell(cmd) !== SAFE_RETRY`. Measured, that refuses every real test command:

```
  UNSAFE  py -m pytest -q
  UNSAFE  npm test
  UNSAFE  make test
```

`classifyShell` answers a *different* question — "is re-running this after a crash safe?" — and
default-denies, which is right for recovery and useless as a permission gate. Added
`isKnownDangerous(cmd)` to `core/recovery`, exposing only the explicit denylist, and gated
`verify` on that instead. Behaviour now:

```
  registered tools: read, grep, write, edit, bash, verify, ask_user
  PASS case : "PASS (exit 0) echo hello\nhello\n"
  refuses   : verify refuses a command with known side effects: rm -rf /tmp/zz
  FAIL case : "FAIL (exit 0) echo hi\nexpected substring not found: ..."
```

A failing check is a **result**, not a tool error — the agent must be able to read it and act.

---

## 6. Dead vocabulary

- **`turn.finished` — now emitted.** Appended after the model round-trip *and* its tool calls,
  which is when a turn is genuinely over. A turn that ends by terminating the run does **not**
  get one: `run.completed`/`run.failed` is its terminator, and emitting both would misreport a
  truncated turn as clean. Verified live: 4 emitted in a real multi-turn run.
- **`child.spawned`, `child.finished`, `context.retrieved` — documented as RESERVED** in
  `src/core/event/index.mjs`, with the wave that will emit each. They are kept rather than
  removed because the set is frozen and removal would break replay of older logs.

`EVENT_TYPES` remains **31 and frozen** — the contract is unchanged.

---

## 7. Manual testing (real terminal, installed binary)

Package built with `npm pack` and installed globally; `orionctl --version` → `0.1.2`.
Installed build confirmed to carry the new tool: `read, grep, write, edit, bash, verify, ask_user`.

### Test 1 — the §1.4 scenario, `gemma4-31b` (the run that used to lie)

Baseline: `FAILED test_calc.py::test_add - assert -1 == 5`.

```
$ orionctl run "The test test_add in test_calc.py is failing. Read calc.py, fix the bug ..."
Run #4534ef38e3
  ⚠ [model_adapter] provider response required a shim: gemma-native-tool-calls
  ✓ bash .: __pycache__ calc.py test_calc.py
  ⚠ [model_adapter] provider response required a shim: gemma-channel-markers+gem
  ✓ read 1|def add(a, b): 2| return a - b
  ✓ edit edited calc.py
  🙋 bash cannot be safely retried after a crash. Run it? py -m p
paused — awaiting_human
```

Ground truth **on disk**:

```
$ cat calc.py
def add(a, b):
    return a + b        ← ACTUALLY FIXED

$ py -m pytest -q
..                    [100%]
2 passed in 0.02s
```

Approve and resume → `✓ model_finished`, after the agent itself ran the suite (`2 passed`).

Trajectory: `turn.started 1 · turn.finished 4 · degraded 6 · 56 events`.

**Before Wave 1 this exact command reported `✓ model_finished` with the file untouched.**

### Test 2 — slow local model, `qwen3:14b` (the run that used to die)

```
$ orionctl run "Read calc.py and fix the add function so it returns a + b."
Run #99a57d9c6e
  ✓ read 1|def add(a, b): 2| return a - b
  ✓ edit edited calc.py
✓ model_finished
```

```
$ cat calc.py
def add(a, b):
    return a + b

lease events: 12      lease_lost count: 0
replay → status: completed | events: 31 | model_calls_made: 0
```

**Before Wave 1 this failed as `lease_lost`.** Replay still costs zero model calls.

### Test 3 — unperformed work must fail (CLI integration, in-suite)

A stub endpoint returning prose with `tool_calls: []` — exactly what the live vLLM returned:

```
PASS  orionctl did NOT print a success tick
      ... [completion_contract] model stopped before the declared objective was satisfied
      ... failed — finished_without_change
PASS  the file on disk is genuinely unchanged
```

---

## 8. Full regression

```
$ node tests/run-all.mjs
TOTAL: 692 passed, 0 failed across 26 suites
```

New suites: `leaseheartbeat` (9), `truthfulcompletion` (29). Prior 654 all still pass.

---

## 9. Files changed

| File | Change |
|---|---|
| `tests/security/security.test.mjs` | POSIX loop instead of `$(seq ...)` |
| `tests/run-all.mjs` | `preflightShell()`; registered 2 new suites |
| `src/agent/loop/worker.mjs` | D1 heartbeat; emit `turn.finished` |
| `src/cli/index.mjs` | D2 contract wired to run/resume/REPL; D3 `selectShims`; import-safe dispatch |
| `src/agent/tools/index.mjs` | `verify` tool |
| `src/core/recovery/index.mjs` | `isKnownDangerous()` |
| `src/core/event/index.mjs` | RESERVED types documented (set unchanged, still 31) |
| `tests/leaseheartbeat/`, `tests/truthfulcompletion/` | new suites |

---

## 10. Deviations from the brief

1. **The gate's premise was partly different from what I found.** The suite was already green on
   this machine (Git Bash first on PATH). Rather than declare the gate satisfied, I reproduced
   the described failure by forcing WSL bash and fixed **both** causes — the non-portable
   construct *and* the missing preflight — so the failure cannot recur silently on a machine
   where PATH differs.
2. **The CLI needed an import guard** (§3) to make the wiring testable. Small, but a change to
   `src/cli/index.mjs` beyond pure wiring; behaviour as a program is unchanged (`--version`,
   `--help`, bare-TTY REPL all verified).
3. **`isKnownDangerous()` added to `core/recovery`** (§5) — a new export, needed because
   `classifyShell` cannot serve as a permission gate.
4. **`verify` is not yet used by the default system prompt.** The tool exists and is registered;
   teaching the model to prefer it is prompt work I judged outside "wire the mechanisms".
5. **Nothing was republished.** Version remains `0.1.2`; the manual tests used a locally packed
   tarball. Publishing is a separate, explicit decision.

---

## STOP — WAVE 1 COMPLETE. No Wave 2 work started.
