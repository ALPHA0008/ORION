# Session prompt — WAVE 5 "FOUNDATION HARDENING" (rebaselined plan; everything below writes into this)

Hand this to the executing agent (Claude). Hard scope. This is the wave the rebaselined
`MASTER-HARNESS-DEVELOPMENT-PLAN.md` (2026-09-07 edition) declares the immediate next action of
ORION. It is NOT a feature wave. Every change traces to a defect in the plan's §4 register. W5
exists because every later wave adds a persistence consumer (W6 resources, W9 MCP sessions, W10 child
runs, W11 memory); fixing the persistence boundary now costs a fraction of what it costs after those
consumers exist. Then STOP — no W6.

---

```
Role: Executing agent for ORION (@kernlbase/orion). State entering this wave: package 0.2.0 staged
(unpublished), commit e985769 + local tree clean of v0/; suite 950/0/31; event contract v4/39;
Waves 1-4.5 done and verified. The roadmap has been REBASELINED (2026-09-07). Your source of truth
is the plan you share with the planner:

  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md   (REBASELINED — read §2, §4, §5, §10
     W5, §11 testing policy, §13 security, §1.3 invariants; all defect IDs below are from this file)

The plan's W5 text (verbatim contract, keep within it):

  W5 — FOUNDATION HARDENING. Why first: every remaining wave adds a persistence consumer.
  NOT a feature wave. Every change traces to a defect in §4.
  Scope: A Persistence (P1,P2,P4) · B Store boundary (S1,S2,S3) · C Lifecycle atomicity (R1-R4) ·
        D Runtime (X1-X5,X7) · E Evaluation boundary (E1-E3) · F Extensibility (T1-T3) ·
        G Tooling + docs (Q1-Q3, D1-D3) · H Wave-4 follow-up (one live Anthropic call or a
        recorded decision not to).
  Acceptance (blocking):
    1. A database written by 0.2.0 migrates forward and replays identically. (Invariant 9)
    2. `grep` proves zero raw SQL and zero direct event inserts outside `Store`. (Invariant 1)
    3. A tool call longer than the lease does not lose the lease. (Experiment E2)
    4. `eval/` runs in CI.
    5. Full suite green; `tests/shipped` extended.
  Risk LOW-MEDIUM · Effort impl M · tests M · manual S. Splittable: A+B first, then C+D, then E-H.

THE DEFECTS (each already verified TRUE at source by the planner — do not re-litigate, fix them):

  P1  No schema versioning/migration runner — `CREATE TABLE IF NOT EXISTS` only (store.mjs:20-58).
  P2  No old-DB upgrade test.
  P4  Default durability FULL benchmarked only to 10.3k events; normal to 1M. Owe experiment E1
      (durability full at 100k/1M) — run it, record it.

  S1  Raw SQL outside Store — 6 sites in reaper, 2 in replay, 1 PRAGMA in CLI.
  S2  Direct `INSERT INTO events` bypasses `isKnownType()` — the closed-vocabulary guard
      (reaper.mjs:25, replay/index.mjs:60).
  S3  Storage not swappable without touching 3 modules (enables W13/W14 Postgres later).

  R1  `expireHumanRequests` not atomic — 4 writes across 3 transactions (reaper.mjs:43-48).
  R2  No terminal-state guard there — can force a terminal run to parked.
  R3  `force: true` bypasses fencing in 2 callers, unaudited (store.mjs:217-218, worker.mjs:614,
      reaper.mjs:46). Audit BOTH; emit an event where the bypass is genuinely required.
  R4  `appendStatus()` — the atomic primitive built for this — is not used by the reaper.

  X1  `execFileSync` blocks the event loop, caps at 1 run/process (sandbox/local/index.mjs:123).
      THE weakest decision in the tree. Move to async child_process (spawn/execFile with await),
      preserving the exact error taxonomy (output_overflow, timeout, shell_missing, nonzero_exit)
      and the PATH/git-bash behavior. The sandbox's `exec` must remain a boundary.
  X2  No lease heartbeat on the tool path — `setInterval` cannot fire while blocked
      (worker.mjs:414-544). The D1 wrapper covers model calls; the tool path needs the same.
  X3  Missing `await` on the human-approval resume path (worker.mjs:600, `#consumeHumanAnswers`:
      `const r = this.tools[pend.name].run(pend.args);`). Harmless today because all tools are
      synchronous; the first async tool writes `[object Promise]` into the durable log. Fix it and
      add a test proving an async tool's result is the awaited value, on the resume path.
  X4  `tool.timed_out` declared (contract line 33), consumed in 4 places, emitted nowhere; sandbox
      `kind:'timeout'` collapses to `tool.failed` (worker.mjs:503). Decide: emit it on timeout
      (preferred — the distinction is part of the failure-classification thesis), and emit the
      sandbox timeout kind through on the worker's failure branch.
  X5  No cancellation semantics — a run cannot be stopped cleanly. Add a `run.cancelled` flow:
      cancel tool in flight, mark run cancelled, no partial spawn left. Keep it out of the recovery
      contract's way (cancellation is a deliberate stop, not a crash). If X5 turns out large,
      scope to "clean stop of an in-flight run + no orphan effect" and defer richer semantics.
  X7  Dead ternaries with byte-identical branches (store.mjs:223-225, :243-245). Remove.

  E1  `eval/` is not in CI (ci.yml:24) — the cited second consumer is unguarded.
  E2  `eval/` deep-imports `core/projection`, which the barrel declares non-public
      (eval/metrics/index.mjs:6 vs src/index.mjs:11). Route through public exports where reasonable;
      where it must reach internals, say so explicitly in the barrel rather than claiming it
      validates the public API.
  E3  Eval config ≠ shipped defaults (no completion contract, no compaction) and reports are
      unlabelled. Label every eval report with the configuration measured.

  T1  `MUTATING_TOOLS` duplicates the `effects` property by name (cli/index.mjs:146) — same class
      as the F1 bug. Derive it from `tools[name].effects`.
  T2  Add a general rule + test forbidding capability-metadata duplication.
  T3  `isKnownDangerous` used by tools but absent from public barrel while `classifyShell` is
      exported (src/index.mjs:94). Export it.

  Q1  No type checking. `tsc --checkJs` in CI would catch X3 statically.
  Q2  No coverage measurement despite ~950 assertions.
  Q3  No lint/format.
  D1  docs/ARCHITECTURE.md:41 says "6 tools"; there are 9.
  D2  tools/index.mjs:1 header lists 6.
  D3  current-product-surface.md is pre-Wave-1 and materially wrong.

  H   One live Anthropic API call, OR an explicit recorded decision not to (this is the last
      Wave-4 gap and admission; if you make the call, record endpoint/model/status in the report).

OWNERSHIP / BOUNDARIES:
  - The event contract is ADDITIVE ONLY (v4/39 frozen). Only X4's tool.timed_out and X5's
    run.cancelled are new-type candidates, and each must document why. Do NOT retype existing types.
  - Invariants (plan §1.3) must never weaken: Store.append the only mutation path, replay
    equivalence, effect-aware recovery (ADR-002/003/011), fencing, truthful completion, provenance,
    explain-ability, cross-version durability, developer usability.
  - Do NOT redesign LocalSandbox's containment or the recovery contract. X1 is mechanical (async,
    same taxonomy), not a redesign. Q4 (container backend) is W6, NOT this wave.
  - Do NOT build W6 scope early (no SandboxBackend impl#2, no resources, no network policy, no
    posture derivation, no live-output rendering). W6 is gated on this wave, not stolen by it.
  - No new features. Every change names its §4 defect.
  - research/ and archify-out/ stay untracked / out of package commits.
  - Product name ORION. npm publish is NOT in this wave (0.2.0 publish decision is separate).

QUALITY / TEST RULES:
  - Full suite green with Git Bash first on PATH: node v0/tests/run-all.mjs → record before (950/0/31)
    and after. Suite count may rise.
  - Where W5 touches the recovery/fencing paths (C, D), the crash matrix must be EXTENDED (new
    cases for the tool-path heartbeat, the resume-await, the atomic expire path), not merely re-run.
  - Add `tests/shipped/` assertions for the acceptance items that are user-visible (see below).
  - Respect the standing §11 manual gate: a real installed build, a real model (openai-compat), real
    fix-the-bug run; verify the FILE and TEST result on disk; assert no duplicated effect across a
    SIGKILL + reap + resume. Document commands + observed output.
  - Stray 0x08 byte scan on every changed file before done (two recurrences hid a bug and a gap).
  - Q1 note: `tsc --checkJs` in CI — install typescript as a devDependency ONLY if needed for the
    check; keep runtime zero-dep. The check is a CI gate, not a shipped dependency.

W5 ACCEPTANCE CHECKLIST (verbatim from the plan — make each provable in your report):
  [ ] 1. A database written by 0.2.0 migrates forward and replays identically. (Invariant 9)
  [ ] 2. `grep` proves zero raw SQL and zero direct event inserts outside `Store`. (Invariant 1)
  [ ] 3. A tool call longer than the lease does not lose the lease. (Experiment E2)
  [ ] 4. `eval/` runs in CI.
  [ ] 5. Full suite green; `tests/shipped` extended (at minimum: the tool-path heartbeat, the async
         resume path, the migration/replay, and the async-exec sandbox each get a shipped-path probe).

REPORT:
  Write to research/productization/wave5-foundation-harding-report.md: per defect grouped A-H, the
  fix + the test that proves it; the migration test (0.2.0-DB → forward → replay) output; the
  `grep` proof of zero raw SQL/direct inserts outside Store; the E2 lease-survival measurement; the
  eval-in-CI result; X4/X5 decision records; the 0x08 scan results; suite before/after; contract
  version (v4 → v?; unchanged expected); and the manual-gate commands+output. Then STOP. No W6.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- **This replaces the old wave5-prompt.md.** The rebaselined plan renamed the merged
  autonomy+resource-identity wave to **W6** and made Foundation Hardening the new W5 (it had "no home
  for any of this" — migrations/Store/async/eval-in-CI are not feature-shaped). The old merged prompt
  is preserved as `wave6-prompt.draft.md` for when W6 arrives.
- **I verified the plan's defect register against source before writing this prompt.** Confirmed
  true: X1 (execFileSync:123), X3 (worker.mjs:600 no-await), X4 (tool.timed_out declared/never
  emitted), X7 (dead ternaries), R1/R3 (expireHumanRequests 3-tx, force:true at reaper:46 +
  worker:614), S1/S2 (raw SQL + direct INSERT at reaper.mjs:25, replay/index.mjs:60), E2
  (eval/metrics/index.mjs:6 deep-import). Also reviewed all five archify-out diagrams — accurate
  against source, including one that documents X3 itself.
- **Preservation audit passed.** Every old W1-W11 capability has a home in W1-W14. Nothing stripped.
  New additions (search/glob, config/rule file, production ops, Postgres backend, cancellation,
  retention) were never in the old plan.
- **Reminder for the publish sequence:** the plan §20 now says "Publishing 0.2.0 is the
  highest-value non-engineering action available and should follow W5." So the order is: W5 (this)
  → verify → publish 0.2.0 → W6.