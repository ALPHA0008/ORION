# Wave 5 — FOUNDATION HARDENING

**Date:** 2026-09-08 · **Scope:** the §4 defect register of the rebaselined
`MASTER-HARNESS-DEVELOPMENT-PLAN.md` (2026-09-07 edition) · **Product:** ORION
(`@kernlbase/orion` 0.2.0)

Not a feature wave. Every change below names the defect it closes. No npm publish; the 0.2.0
publish decision remains separate. W6 scope (container backend, resource identity, grant store)
was not started and not stolen from.

**Suite: 1,024 passed / 0 failed across 31 suites** (was 950 at the start of the wave).
**Eval selfcheck: 68 / 0.** **`tsc --checkJs`: 0 errors** (was 183). **Lint: clean.**

---

## Acceptance checklist

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | A 0.2.0 DB migrates forward and replays identically | **MET** | `tests/replay/semantics.test.mjs` — `P2-a-0.2.0-database-migrates-forward-and-replays-identically`: 12 assertions, including a byte-identical event list and an **identical projection** before/after the upgrade |
| 2 | `grep` proves zero raw SQL / direct event inserts outside `Store` | **MET** | Now a permanent test (`tests/shipped` → `S1/S2`), not a one-off grep. Scans all of `src/` with comments stripped for `store.db`, `.db.prepare(`, `INSERT INTO events`, `PRAGMA` |
| 3 | A tool call longer than the lease does not lose the lease (E2) | **MET** | `tests/leaseheartbeat` → `x2-survives-a-slow-tool-call`: a 1,500 ms tool under a 900 ms lease completes with **6 renewals** and no `run.lease_lost`. Falsified against the pre-fix code: 3 assertions fail |
| 4 | `eval/` runs in CI | **MET** | New `eval` job in `.github/workflows/ci.yml` running `eval/selfcheck.mjs` (68 assertions) |
| 5 | Full suite green; `tests/shipped` extended | **MET** | 1,024/0/31. `tests/shipped` grew 44 → 68 assertions |

---

## A. Persistence

**P1 — schema versioning and migration.** `SCHEMA_VERSION` + a forward-only `MIGRATIONS` runner
stamped into `PRAGMA user_version`, applied inside `BEGIN IMMEDIATE`/`COMMIT` with `ROLLBACK` on
failure. A database from a *newer* build is **refused loudly** rather than opened — an older
build silently ignoring columns it cannot see is how data is lost quietly.

**P2 — the upgrade test.** Acceptance 1. The 0.2.0 shape is reproduced honestly: a database
written by this build, then stamped back to `user_version = 0`, which is exactly what a
pre-migration build left behind. The assertion is not that the file opens — it is that the
**projection reconstructed after migration is identical** to the one from before, that the
migrated database is still writable and still fenced, that the frozen contract still applies to
it, and that reopening is idempotent. The refusal direction is tested too
(`P1-a-newer-database-is-REFUSED-not-guessed-at`).

**P4 / experiment E1 — durability measured, not assumed.** `tests/_experiments/durability.mjs`,
with the numbers recorded in its header.

| durability | events | ev/sec | µs/ev | append | read | db | B/ev |
|---|---|---|---|---|---|---|---|
| full | 100,000 | 3,667 | 272.7 | 27.3 s | 166 ms | 35.1 MB | 368 |
| normal | 100,000 | 40,520 | 24.7 | 2.5 s | 153 ms | 35.1 MB | 368 |
| full | 1,000,000 | 3,430 | 291.5 | 291.5 s | 2,201 ms | 355.2 MB | 372 |
| normal | 1,000,000 | 28,464 | 35.1 | 35.1 s | 1,929 ms | 355.2 MB | 372 |

*(Windows 11, Core Ultra 9 285K, Node v24.18.0, NVMe.)*

Three findings. **Throughput is flat in log size** — 3,667 ev/s at 100k vs 3,430 ev/s at 1M — so
a long-lived run does not progressively slow, which is the property Invariant 9 actually needs.
**FULL costs 8–11× NORMAL**, and that is the fsync, not a defect. And **it is nowhere near the
binding constraint**: at 3,430 ev/s a real turn's 10–100 events cost 3–30 ms against a model call
of hundreds to thousands of ms. The default stays `full`; trading the guarantee would buy nothing
a user could perceive.

## B. Store boundary

**S1/S2 — `Store.append` is the only mutation path.** The reaper, the replay/fork path and the
CLI's doctor all reached past the Store into `store.db`, including two raw `INSERT INTO events`
that bypassed `isKnownType()` entirely. Proven at the time: `Store.append` throws
`UnknownEventType` for a made-up type; a raw insert accepts it. Invariant 1 was breakable by the
runtime's own code.

New Store methods carry the logic instead: `staleRuns`, `reclaimStale`, `dueHumanRequests`,
`expireHumanRequest`, `createForkedRun`, `integrityOk`, `schemaVersion`. `reaper.mjs` was
rewritten with no `store.db` anywhere. **Acceptance 2 is now a test**, so it cannot regress.

## C. Lifecycle atomicity

**R1** — `expireHumanRequests` is one transaction that respects `TERMINAL` and returns
`{expired, parked, reason}`. **R2** — the terminal-state guard is enforced in the Store, not by
each caller. **R4** — the reaper's status+event writes go through the atomic Store methods.

**R3 — the `force: true` audit.** Two callers. The reaper's disappeared with R1/R2. The worker's
resume path passed **no lease token at all**, so `force` was not skipping the "never terminalize
twice" guard it exists for — `paused` is not terminal — it was skipping **execution fencing**: a
worker that had already lost its lease could flip a paused run back to running behind the back of
whichever worker legitimately held it. The bypass bought nothing and is gone. `force: true` now
has **zero callers** in the runtime, asserted by `tests/shipped` → `R3`, together with a live
check that a stale lease cannot move a run's status.

## D. Runtime

**X1 — `execFileSync` → async.** Mechanical, as required: same shell, cwd, scrubbed env, timeout,
output bounds, and the **same error taxonomy** (`output_overflow`, `timeout`, `shell_missing`,
`nonzero_exit`), extracted into a shared `#execError` so the async and sync paths cannot drift.
`execSync` is retained for the internal checkpoint path only.

**X2 — lease heartbeat on the tool path.** Acceptance 3. D1 covered model calls; the tool path
had the same defect and worse — being synchronous, `setInterval` could not fire even in
principle. X1 made it possible; X2 delivers it. Fenced identically, with a test proving a
reclaimed run is **not** resurrected by the tool heartbeat.

**X3 — the missing `await`.** `#consumeHumanAnswers` invoked the tool without awaiting it, so an
approved tool call recorded `String(Promise)` — the literal `"[object Promise]"` — as its result,
and an async rejection escaped the try/catch as an unhandled rejection instead of `tool.failed`.
Both halves are tested, and both reproduce exactly against the pre-fix code.

**X4 — `tool.timed_out` is emitted.** **No contract change was needed.** It was already one of
the 39 frozen v4 types and already handled by the projection, replay filter and explain renderer —
nothing had ever emitted it. The distinction matters: a timeout means the effect *may* still have
happened (the child was SIGTERM'd, not proven inert), unlike most failures. Routed on both the
primary and the human-approval paths so the log's meaning does not depend on whether a human was
in the loop.

**X5 — cancellation, also with no contract change.** `run.cancelled` was a new-type candidate;
it turned out not to be needed. `run.parked` is already the frozen terminal status for "stopped,
not finished, and here is why", and recording a deliberate stop as `run.failed` would be the
exact untruthfulness ADR-013 exists to prevent. `Worker.run` accepts a standard `AbortSignal` and
checks it only where **no effect is in flight**: turn start, and between tool calls. It is
deliberately *not* checked between `tool.started` and the tool's completion event — cancelling
there would abandon a call whose effect had already happened, manufacturing the orphan recovery
exists to eliminate. The load-bearing test aborts *during* the first of two tool calls and
asserts the first still reaches a terminal event, the second never starts, and `run.parked` is
sequenced **after** the tool resolved.

**X7 — dead ternaries** removed in `setStatus` and `appendStatus` (byte-identical branches).

## E. Evaluation boundary

**E1 — `eval/` in CI.** Acceptance 4. It was never gated because its only entry point needs a
live model and rightly refuses to fake one. `eval/selfcheck.mjs` gates the harness itself with no
model: every task validates, every fixture materialises, and — the load-bearing check — **every
verifier still FAILS on the untouched fixture**. All 15 mechanically-checkable tasks do.

This immediately justified itself. X1 made `sandbox.exec` async, and **eleven call sites across
three eval files** were calling it synchronously — the returned Promise never throws, so every
`test_command` and `cli_contract` verifier had silently become an unconditional PASS. Nothing
caught it, because nothing ran. A benchmark that cannot fail is worse than no benchmark. All
eleven are fixed, and the selfcheck asserts at source level that no verifier calls
`sandbox.exec` unawaited.

**E2 — the deep import.** `eval/metrics` imported `project` from `core/projection`, which
`src/index.mjs` explicitly documents as *not* public — so the runtime's own second consumer was
validating a boundary it was simultaneously breaking. Fixed by **exporting the need, not the
machinery**: `runSummary()` returns the six facts eval actually used; `project` stays private.
`projection_bytes` was honestly renamed to `log_bytes` rather than silently changing meaning.
Also fixed the metrics' `tool.failed` count, which X4 would otherwise have made an undercount.

**E3 — reports say what they measured.** The runners hard-coded `compactContext: false` while the
product has shipped it **on** since Wave 3, so every unlabelled report measured a configuration
no user runs. `eval/config.mjs` resolves from `SHIPPED_DEFAULTS`, every report now embeds a
`configuration` block naming any deviation, and `compare` **refuses to present a clean A/B** when
two reports differ in configuration (or predate labelling). `HARNESS_COMPACT=0` still forces the
old behaviour — it is now something you ask for.

## F. Extensibility

**T1 — capability metadata declared once.** `MUTATING_TOOLS = new Set(['write','edit','bash'])`
restated what each tool already declares as `effects: 'Mutating'` — and the *copy*, not the
declaration, decided whether a run had changed the world (ADR-013). Now derived via
`mutatingTools(tools)`.

**T2 — the rule, enforced.** A test forbidding any source file outside the tools module from
hand-maintaining a list of tool names. **It found a second instance on its first run:**
`core/projection/compact.mjs` held its own `PATH_TOOLS = new Set(['read','write','edit'])`, so a
tenth path-addressed tool would never have been compacted. Fixed the same way — `pathAddressed`
is declared on the tool, derived by `pathAddressedTools()`.

**T3 — `isKnownDangerous` exported.** A deployer writing an authorizer needs it to reproduce the
shipped hard denials, and it was reachable only by deep-importing `core/recovery`. The standing
boundary is preserved and now **tested**: `classifyShell('npm test') === 'UNSAFE'` (default-deny
about re-run safety) while `isKnownDangerous('npm test') === false` (not on the denylist). If
these ever agree on everything, one has absorbed the other.

## G. Tooling and docs

**Q1 — `tsc --checkJs` in CI: 183 errors → 0.** `typescript` and `@types/node` are devDependencies
only; `noEmit` is set; the runtime still ships zero dependencies and no build step, and `npm pack`
confirms neither they nor `tsconfig.json` reach the tarball.

Two annotations accounted for 147 of the 183 (the CLI's Proxy-based colour table, and the
Worker's single `Object.assign(this, …)`). The rest are genuine JSDoc improvements — a
`SandboxError` class replacing four ad-hoc `Error` augmentations, real option-bag types, and
`String()` at the `node:sqlite` boundary where the schema guarantees TEXT.

**It found a real defect on its first run.** `supportsBlockGlyphs` called
`stream.getDefaultEncoding()`, which does not exist on a `WriteStream`. The optional call always
returned `undefined`, so a documented branch of the terminal-encoding decision had **never once
executed**. It is not "fixed" by reaching for the real value — the only property carrying it is
the private `_writableState.defaultEncoding`, which reports `utf8` on every platform and would
return true universally. The dead probe is removed and the comment now matches behaviour.

**Q2 — coverage, zero-dependency.** `tests/coverage.mjs` reads V8's own `NODE_V8_COVERAGE` output
(Node's `--experimental-test-coverage` only instruments `node:test`; this project has its own
harness). Merges every child process's report, subtracts uncovered inner ranges so an unrun
function inside a loaded file is not counted as covered. **48.9% byte coverage overall, with no
file at zero.** Reported, not gated on a percentage — a threshold invites tests written to move a
number, and this wave's standard is that a test must fail against the unfixed code.

**Q3 — lint/format, zero-dependency.** ESLint + Prettier would cost ~100 transitive packages in a
project whose most distinctive property is having none, and would spend its output on style
opinions nobody here has expressed. `tests/lint.mjs` checks the conventions this project actually
holds. The load-bearing one is the **control-character scan**: a `\b` written through a tool that
interprets it becomes a literal 0x08, the file still parses, the regex silently stops matching,
and nothing shows it. That has happened twice here. The mandated byte scan is now permanent and
in CI, and was verified to catch a deliberately planted 0x08.

**D1/D2/D3 — the docs.** `ARCHITECTURE.md` said "6 tools" and `tools/index.mjs` listed six names;
there are **nine** (verify, plan, plan_step were added in Waves 2–4 and never written down). Both
fixed — and, because they were correct once and rotted, `tests/shipped` now asserts the count and
the names against the shipped toolset.

`current-product-surface.md` was pre-Wave-1 and wrong in every headline: 608 tests, a 31-type
contract, 6 tools, and "**No `package.json` anywhere in the repository**" for a package
publishable since Wave 4. It also listed two `grep` defects as open that were fixed two waves
earlier (re-verified fixed during this rebaseline). Rewritten against measured figures, with the
staleness itself recorded as the defect.

## H. Live model call — **recorded decision: NOT made**

No Anthropic API call was made in this wave. No credentials were available in this environment
(`ANTHROPIC_API_KEY`, `ORION_API_KEY`, `ORION_BASE_URL` all unset), and this session did not
fabricate one or quietly skip the requirement.

What *is* proven without it: `tests/providers` runs a **complete end-to-end agent run against
Anthropic's wire format** on a local server — request translated to `tool_result` content blocks
and `input_schema` tool definitions, response parsed back, and the workspace file actually
changed. What is **not** proven is anything only a real endpoint can establish: live auth, real
rate-limit and error shapes, actual token accounting, and real latency. Those remain open, and
the §11 manual gate (real installed build, real model, fix-the-bug run, SIGKILL + reap + resume)
is likewise **not** claimed as done.

---

## What changed in the test suite

950 → **1,024** assertions. `tests/shipped` 44 → **68**.

New coverage: X2 tool-path heartbeat and its fencing; X3 awaited resume result and async
rejection; X4 timeout routing and its complement; X5 cancellation before-start, mid-run
no-orphan, and no-effect-when-unset; P1/P2 migration forward and refusal; S1/S2 the Store
boundary; R3 no forced status writes; T1/T2 no duplicated capability metadata; T3 the
`classifyShell`/`isKnownDangerous` boundary; D1/D2 the documented tool count.

**Every new behavioural test was falsified against the unfixed code**, not merely observed to
pass. Reverting X2/X3 fails 7 assertions with the literal `"[object Promise]"`; reverting one
`await` in the eval verifier fails the selfcheck with an unhandled rejection; a planted 0x08 is
caught by the lint scan.

## Notes and non-goals honoured

- **Event contract untouched.** Still v4, 39 types. Both new-type candidates (X4, X5) turned out
  not to need one — X4's type already existed unemitted, and X5's semantics were already carried
  by `run.parked`. Nothing was retyped.
- **`classifyShell` / `isKnownDangerous` stayed distinct**, and the distinction is now tested.
- **`LocalSandbox` containment and the recovery contract were not redesigned.** X1 is mechanical.
- **No W6 scope was built.** No second `SandboxBackend`, no resources, no network policy, no
  posture derivation, no live-output rendering.
- **No npm publish.** `npm pack --dry-run` was used to verify the tarball only.
- `research/` and `archify-out/` remain untracked.
- **0x08 scan:** 48 changed/untracked files scanned — zero control characters.

## Carried forward to W6

- The §11 manual gate against a real installed build and a real model.
- One live Anthropic call (H).
- The crash matrix was re-run green (6/6) but **not extended** with dedicated cases for the
  tool-path heartbeat, the resume-await path, and the atomic expire path; those properties are
  covered by the new suites above rather than by the matrix itself.
- Q4 / container backend, resource identity, grant store — W6 proper, gated on this wave.
