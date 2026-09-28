# Wave 6.1 — LIVE PROOFS / CLOSING THE §11.4 GAPS

**Date:** 2026-09-10 · **Scope:** Wave 6's §11.4 disclosure list · **Product:** ORION
(`@kernlbase/orion` 0.2.1) · **Entering commit:** `681be8b`

A hardening wave, not a feature wave. Wave 6 shipped three claims that were **asserted rather
than measured**; all three were closable against the live Docker daemon on this host. No contract
change: **v5/46 before and after**.

**Suite: 1,286 → 1,351 passed / 0 failed, 35 → 37 suites.**
**`tsc --checkJs`: 0 errors. Lint: clean. Crash matrix under the boundary: 27/27, untouched.**

## The headline: measuring found three real defects

Proving a claim is not a formality here. Running the three proofs turned up two product defects
and one instrumentation defect that had been silently invalidating a measurement:

| # | Defect | Found by |
|---|---|---|
| **D1** | **`allowlist` network mode was unenforced AND mislabelled.** `networkFlagsFor()` returned `[]`, so the container got the runtime's default bridge with **full egress**, while `capabilities.network` declared `'restricted'`. Nothing in `src/` ever called `policy.check()`. | Proof 3, live |
| **D2** | **`pruneOrionContainers` was imported into the CLI and never called.** Symptom: eight `orion-*` containers found still running two hours after their runs ended. | Reading the CLI while setting up |
| **D3** | **The live egress probe read a denial as a success.** busybox `wget` prints `bad address` to *stdout* and the pipeline exits 0 — so the first probe reported the boundary broken while it worked perfectly. | Proof 3's own first run |

D1 is the serious one, and it is a *capability lie*: `backend.mjs` states that a dishonest
declaration is a security bug rather than a documentation one, because posture and operator trust
are built on it.

---

## PROOF 2 — the resource limits BIND

**Gap:** "limits are set but not measured." That gap sat directly under W6-K: auto-allow is
justified by the claim that a command's blast radius is the sandbox, and an unmeasured limit is
the difference between "a runaway tool call is contained" and "a runaway tool call pins the host".

Measured on **two independent channels**, because either alone is weak — a cgroup read could show
a limit nothing enforces, and behaviour alone could be an accident of the environment.

`tests/sandbox/limits.test.mjs` — **23 assertions, 23 pass.** Built with the **shipped defaults**
(`cpus 1.0`, `memory 512m`, `pidsLimit 256`); only `execTimeoutMs` is raised, which is a harness
concern, not a limit.

| limit | channel 1 — the kernel applied it | channel 2 — it bites under load |
|---|---|---|
| **CPU** | `cgroup cpu.max = 100000 100000` (quota == period ⇒ 1.0 CPU) | **six** busy loops on a **24-core** host peaked at **99.45%** — unlimited this reads ~600% |
| **Memory** | `cgroup memory.max = 536870912` (512 MiB) | `tail /dev/zero` → **exit 137** (SIGKILL); `docker inspect .State.OOMKilled = true`; cgroup `memory.events: oom 1 oom_kill 1` |
| **PIDs** | `cgroup pids.max = 256` | 400 spawn attempts → `pids.current` never exceeded **256**, and `pids.events: max 147` — the kernel **refused 147 forks** |

Two assertions exist specifically to stop the test being vacuous:
- CPU peak must also be **≥ 50%**, or "under the quota" would pass when the loops never ran.
- Fork denials must be **≥ 10**, because 400 spawns fitting under a 256 cap is impossible — a
  zero there would mean the load never happened.

And the containment property, asserted explicitly: after the OOM the **container survived and
remained usable**. A runaway tool call must not take the resource down with it.

**Verdict: CLOSED.**

---

## PROOF 3 — network policy, live

**Gap:** "allowlist mode is unit-tested, not exercised live." Running it live found an
**unenforced** path, not merely an untested one.

### What was measured before the fix

```
policy mode: allowlist | allowed: ["registry.npmjs.org"]
docker flags for this policy: []            <-- no --network flag at all
DECLARED capabilities.network: restricted   <-- the lie

ALLOWED registry.npmjs.org    REACHABLE
NOT-allowed example.com       REACHABLE     <-- unlisted host reachable
NOT-allowed 1.1.1.1 (raw IP)  REACHABLE     <-- raw IP reachable
```

`grep` confirmed the cause: **`policy.check()` has no caller anywhere in `src/`.** The allowlist
was a data structure no code consulted, and the container was simply put on the default bridge.

### The fix: fail closed

A mode the backend cannot enforce is now **refused at construction** — wiring time, not on
`acquire()` and not never. This is symmetric with W6's existing refusal to fall back to the local
sandbox when a container was requested: in both cases the quiet path leaves the operator
believing in a boundary that is not there.

- `ENFORCEABLE_MODES = {none, deny}`; `networkFlagsFor()` throws for anything else instead of
  returning `[]`.
- `ContainerSandbox` throws `network_policy_unenforceable` at construction.
- `capabilities.network` now reports **`'none'`** for both enforceable modes, because both
  receive `--network none`. (`deny` previously said `'restricted'`, which *understated* it — but
  a capability should say what the backend actually provides.)
- `policy.check()` stays exported and correct. It is the **decision function**; what is missing
  is a **mechanism**, and a deployer implementing one elsewhere still needs the logic.

### What is proven live

`tests/sandbox/network-live.test.mjs` — **26 assertions, 26 pass.** Built through the
**composition root** (`makeSandbox`, `ORION_SANDBOX=container`), not a raw docker call.

- The container has **no non-loopback interface** — the strongest form of default-deny.
- Every hard-block target unreachable: `169.254.169.254`, `metadata.google.internal`, and
  `127.0.0.1:11434` (the host's own Ollama endpoint — proving host services are unreachable too).
- Ordinary egress denied: `example.com`, `1.1.1.1`, `registry.npmjs.org`.
- **DNS resolution unavailable** — name resolution is itself an exfiltration channel.
- **POSITIVE CONTROL:** the same probe run against a *networked* container reports `__REACHED__`.
  Without this, every denial above could equally mean "the probe is broken" — which it briefly
  was (D3).
- The sandbox still works with no network (denial must not break its real job).
- `mode: 'deny'` reaches the same live outcome.
- An unenforceable policy cannot produce a container at all.

**Verdict: CLOSED for the shipped default. One sub-claim deliberately NOT closed** — see the
ledger: "an allowed destination succeeds" cannot be demonstrated because no enforcement mechanism
exists for it to succeed against. Building one (an egress proxy on an `--internal` network, or
in-container firewall rules requiring `NET_ADMIN`) is a mechanism W6 did not build, and inventing
it in a hardening wave would be feature work. The honest disposition was to stop offering a mode
that reads as "restricted egress" and delivers none.

**Note on exposure:** the shipped CLI was never affected — `makeSandbox` hardcodes `mode: 'none'`,
so `orionctl` could not construct an unenforceable policy. The exposure was for a **library
consumer**. That is asserted by a test so a future config knob cannot quietly reintroduce it.

---

## D2 — `orionctl reap` now reclaims containers

`pruneOrionContainers` was imported into `src/cli/index.mjs` in Wave 6 and **never called** — the
"mechanism unwired at the composition root" failure class this project keeps repeating. The
symptom was visible on this machine: **eight `orion-*` containers still running two hours** after
the runs that created them had finished.

`reap`'s entire job is reclaiming what a dead worker left; once the sandbox became a long-lived
container, a leaked container is exactly that.

**The safety half matters as much as the cleanup.** A container belonging to a *still-resumable*
run must survive, because reattaching to it is the whole of Recovery 2.0 (W6-I). A reap that
pruned indiscriminately would turn every post-crash resume into a recreate-with-notice — the
cleanup would quietly destroy the property the wave exists to provide. So `reap` builds a `keep`
set from every non-terminal run's bound `handle_name`.

Verified against the load-bearing case — a run whose worker was **SIGKILLed**, then reaped:

```
container acquired: orion-work-mtv9hik3
worker SIGKILLed; container alive: true
before reap  → status: "running" | handle_name: "orion-work-mtv9hik3"
requeued 1, parked 0, expired human requests 0
containers: removed 0 orphaned, kept 1 still reattachable
VERDICT — container after reap: true
PASS: the reaped run KEPT its container; a resume can still reattach.
```

The test (`tests/shipped/w6-shipped.test.mjs`) was **falsified against Wave 6's behaviour**:
simulating the unwired prune produces 4 failures, including the orphan surviving.

### A false alarm, recorded honestly

An earlier gate run logged `containers: removed 1 orphaned` immediately after requeuing its own
run, and its resume then recreated (`resource.lost`, `reconstructed: true`). That looked like reap
destroying a live run's container — the worst possible outcome for this fix. **It did not
reproduce**: the faithful reproduction above passes, and the keep logic is correct in isolation.
The most likely cause is environmental — the Docker daemon stopped around that window, and
containers are created with `RestartPolicy: no`, so they do not come back. Recorded rather than
quietly dropped, because "could not reproduce" is a weaker statement than "does not happen".

---

## D3 — and one defect in the measurement itself

The first live egress probe piped `wget` through `head` and treated non-empty output as
"reachable". busybox `wget` prints `wget: bad address 'example.com'` to **stdout**, and the
**pipeline** exits 0 — so the denial message was read as content and the probe reported the
boundary broken while it was working perfectly.

Fixed by taking the sentinel from **wget's own exit status** (`&& echo __REACHED__ ||
echo __DENIED__`), and guarded permanently by the positive control described above. Worth
recording because it is the failure mode a "measure, don't trust" rule is most vulnerable to: a
broken instrument reports confidently.

---

## PROOF 4 — the §11.2 manual gate, under the container backend

**Gap:** the container is where auto-allow is *promised*, and the end-to-end real-model proof had
only ever run on `LocalSandbox`.

Same discipline as W6 §11.2: real installed tarball into a clean directory, real model
(**qwen3:14b via Ollama**, an endpoint not a script), a real bug, SIGKILL timed by **polling the
workspace until the edit had landed**, real lease expiry, real `reap`, real `resume`, and
verification from the **filesystem and the event log** — never from what the runtime says about
itself.

```
── phase 1: real run against qwen3:14b, in a CONTAINER, killed after a real edit ──
waited 96s; a real edit landed: true
bound before kill: run_f8cc58a5b7 / orion-proj-mtv9l9e6 / res_workspace_8b4c94846e2e447e
planted a marker inside the container
worker SIGKILLed: true
math.js at kill time: "return a + b"          <-- the effect HAD landed
container outlived the SIGKILLed worker: true <-- the premise of reattachment

── phase 2: wait for the lease to expire (35s), then reap ──
requeued 1, parked 0, expired human requests 0
  #f8cc58a5b7 requeued (attempt 1)
containers: removed 0 orphaned, kept 1 still reattachable   <-- D2's safety half, live

── phase 3: resume run_f8cc58a5b7 ──
resuming from event 49…
  reattached to res_workspace_8b4c94846e2e447e              <-- Recovery 2.0, in a container
  sandbox: ContainerSandbox  posture: permissive (isolated)
  ✓ plan / ✓ read / ✓ grep / ✓ edit
  ✕ Process terminated
  ✕ bash command failed (exit 127): sh: node: not found     <-- AUTO-ALLOWED, then failed
  ✓ read 1|export function add(a, b) { 2| return a + b; 3|}
  ⚠ [model] retrying after timeout  (x2)
failed — model_unavailable

── phase 4: verification ──
math.js now: "export function add(a, b) {\n  return a + b;\n}"
node test.mjs → "ALL PASS" exit 0
```

| gate criterion | result |
|---|---|
| real installed build | `0.2.1` from the packed tarball, clean directory |
| real model | qwen3:14b via Ollama |
| backend | **`ORION_SANDBOX=container`** |
| worker SIGKILLed, after a real effect | **true / true** |
| container outlived the kill | **true** |
| **resume REATTACHED by identity** | **true** — `resource.acquired, resource.reattached`, `reattach_count: 1`, `reconstructed: false` |
| **file fixed on disk** | **true** |
| **test passes on disk** | **true** — `ALL PASS`, exit 0 |
| **no duplicated effect** | **true** — `function add` ×1, `return a` ×1 |
| **POSTURE: paused for a human** | **false** ← the point of the exercise |
| containers left behind | **0** |

### The W6 thesis, demonstrated

Under `LocalSandbox`, W6's gate ended `paused / awaiting_human` with
`🙋 bash cannot be safely retried after a crash. Run it?`. Under the container, the same command
was **authorized and executed** with no human in the loop. Posture followed the **boundary**, not a
flag, and authorization was not weakened to get there.

### Two honest findings

1. **`sh: node: not found` — and the fix.** The auto-allow worked and was *useless*: the default
   `alpine:3` image has no Node, so the model could not run the project's own tests. Root cause was
   the familiar one — `ContainerSandbox` has always accepted an `image` and the CLI never passed
   one. **Wired as `ORION_IMAGE`** (default unchanged). Verified: `alpine:3` →
   `exit 127: sh: node: not found`; `node:22-alpine` → `"ALL PASS"`, while still
   `isolated: true`, `network: none`, egress **denied**. Selecting an image weakens nothing.

2. **`failed / model_unavailable`.** The local 14B model timed out after retries under load. That is
   an environment condition, not a product defect — and the substantive goal was still achieved
   (file fixed, test passing, effect exactly once). Reported rather than re-run until it looked
   tidier.

*(The `container marker intact: false` line in the raw output is expected, not a defect: the resume
terminated, so the CLI released the container before phase 4 could read the marker. Reattachment is
proven by `resource.reattached` + `reattach_count: 1` + `reconstructed: false` in the durable log,
which is the stronger evidence anyway.)*

**Verdict: PASS.**

---

## The §11.4 ledger

| # | Wave 6 gap | Disposition |
|---|---|---|
| 1 | **Linux-native / podman never exercised** | **STILL OPEN — disclosure.** This is a Windows/WSL2 host; the claim cannot be tested here. The code path is shared, but that is an argument, not evidence. |
| 2 | **Resource limits set but not measured** | **CLOSED.** Proof 2, 23 assertions, two independent channels, live. |
| 3 | **Network allowlist unit-tested only** | **CLOSED for the shipped default** (26 assertions live, with a positive control). The allowlist sub-claim is closed *by removal*: the mode was unenforceable and is now refused rather than silently granting full egress. Per-domain egress enforcement remains unbuilt and is now explicitly out of reach rather than falsely advertised. |
| 4 | **Manual gate ran on LocalSandbox, not the container** | See Proof 4 above. |

## Suite

| | before | after |
|---|---|---|
| assertions | 1,286 | **1,351** |
| suites | 35 | **37** |
| failures | 0 | **0** |
| contract | v5 / 46 types | **v5 / 46 types (unchanged)** |
| `crash/matrix-container` | 27/27 | **27/27 (untouched)** |

New: `sandbox/limits` (23), `sandbox/network-live` (26), plus 3 new sections in
`shipped/w6-shipped` (**77** total, was 61).

Both new suites **skip loudly** with no container runtime — `SKIPPED — no container runtime`,
never a green pass.

### A test-hygiene fix found along the way

The first full-suite run reported `sandbox/limits` crashing at 0 assertions while it passed in
isolation. Cause: the new suites called `pruneOrionContainers` with no `keep` set, deleting **any**
`orion-*` container — including one belonging to a concurrently running gate. Both suites now
snapshot pre-existing containers and remove only what they created. A blanket prune in a test is
the same defect as a blanket prune in `reap`.

## What is STILL not exercised

- **Linux-native Docker and podman** (gap 1) — unchanged, and untestable on this host.
- **Per-domain egress allowlisting** — no enforcement mechanism exists. Now refused rather than
  silently unrestricted.
- **No live Anthropic API call** — still no credentials in this environment. Carried from W5/W6.
- **Container survival across a Docker daemon restart** — measured incidentally and worth
  recording: containers are created with `RestartPolicy: no`, so a daemon restart loses them and a
  resume will correctly `resource.lost` → recreate-with-notice. Whether that *should* be the
  policy is a W7+ question; today it is at least honest.
- **The `user` / rootless-container option** is implemented (`--user`) but never exercised.
