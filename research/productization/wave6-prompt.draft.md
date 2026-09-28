# Session prompt — WAVE 5 "USABLE AUTONOMY + RESOURCE IDENTITY" (merged, the audit's Q4 gate)

Hand this to the executing agent (Claude). Hard scope. This wave makes ORION **safe to auto-allow**
(adoption blocker, audit A4/S3) while giving resources **identity + lifecycle so resume reattaches
rather than reconstructs** (master-plan Wave 5, gates MCP). The audit's Q4 is its explicit gate
("blocking for Wave 5"); the SandboxBackend IS what answers it. Then STOP — no Wave 6 (MCP requires
this wave first).

---

```
Role: Executing agent for ORION (@kernlbase/orion, repo v0/). State entering this wave: package
0.2.0 STAGED (tests/shipped added, verify bypass closed, provider+streaming wired, completion-verdict
fixed, commit ee41579; suite 950/0/31, contract v4/39, MODIFIED working tree nothing but research/
+ results snapshots). NOT published. This wave adds REAL backend-pluggable sandbox isolation + resource
identity, and makes posture a consequence of the boundary. Wave 5 of the master plan merged with the
audit's "usable autonomy" promotion (audit §18 Wave 5).

Read FIRST (source of truth, in order):
  research/productization/ORION-PRODUCTION-COMPETITIVE-AUDIT.md  — S2/S3/S4 (§17.3), the recommended
     sequence §18, Q4 (the explicit wave-5 blocker), §5 grant store, §10 network policy.
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md  — WAVE 5 (line ~360), §7 contract rules,
     §8 manual-test gate, "critical path 1→5→6".
  v0/src/core/recovery/index.mjs   — RecoveryClass, classifyShell, isKnownDangerous (preserve).
  v0/src/sandbox/local/index.mjs   — LocalSandbox + attachCheckpoints + scrubEnv + clamp (preserve).
  v0/src/agent/loop/worker.mjs, v0/src/auth/default/index.mjs  — the S2 seam; F4.5 wired these.
  v0/src/cli/index.mjs  — composition root (audit S1: every test should compose from here).
  research/productization/wave4_5-ship-safety-report.md  — what "shipped configuration" now means.

THE PROBLEM (why this wave exists — audit A4/S3/Q4):
  A4: no isolation ⇒ no safe autonomy ⇒ unusable defaults. ORION cannot be pleasant until it can
      safely auto-allow; the adoption blocker. Default posture escalates every ordinary test command.
  S3: LocalSandbox is documented honestly as containment, not a security boundary. The AUDIT says the
      fix is a SandboxBackend INTERFACE with a real container backend as impl #2, and the default
      posture DERIVED FROM the backend's declared capability: isolated ⇒ auto-allow; not isolated ⇒
      escalate. Posture becomes a consequence of the boundary, not a guess.
  Q4 (THE GATE): "Does a container backend actually enable auto-allow WITHOUT breaking the recovery
      contract?" The pre-state witness, the checkpoints (attachCheckpoints shells to host git), the
      16-point crash matrix — all computed against the CURRENT filesystem identity. A container
      changes that identity. The audit calls this BLOCKING FOR THIS WAVE.

SCOPE (three parts, must ship together — this is THE merged wave):

PART A — SandboxBackend as a real interface (audit S3; the Q4 gate lives here)
  1. Extract a SandboxBackend interface from LocalSandbox WITHOUT breaking it. LocalSandbox stays the
     honest containment impl. The interface must cover what both impls share: read/write/exists/list/
     grep/exec, path containment via _abs, bounded output, env scrubbing, exec timeout, shell
     selection. Decide the shape: does exec stay on the backend, or do tools take a capability object
     (permission to exec) so a READ-ONLY covariate is representable? The authz seam (F4.5: action.command
     populated for any command-bearing tool) must keep working for both impls.
  2. Implement a MINIMAL container backend as impl #2 — the real boundary the audit wants — for
     Linux where available (docker/podman), honest no-op/error elsewhere. "Minimal" means: this is a
     REAL boundary, not cosmetic. Keep it small, zero production deps beyond the container CLI.
     Network policy per domain (audit §10/S4: per-domain approval, no network by default) is PART of
     the container backend contract, not an add-on.
  3. Posture becomes DERIVED: default posture = isolated ? auto-allow : escalate (audit S3). Wire
     createAuthorizer / the worker so the backend's declared capability drives the default, while the
     operator can still override. The dependency is one-directional: backend capability → posture.
  4. THE Q4 GATE: run the FULL 16-point crash matrix (v0/tests/crash/matrix.test.mjs + helpers) inside
     the container backend and assert the audit's Q4 criteria: **zero duplicate effects under crash
     and RECOVERY DECISIONS IDENTICAL to LocalSandbox.** This is the acceptance test of the wave. If
     checkpoint identity (attachCheckpoints shells to HOST git) breaks under the new filesystem
     identity, solve it at the right layer — e.g. the container mounts a git shadow dir that stores
     refs by container-visible path, or sandbox.snapshot/restore receive a container-aware root. Do
     NOT weaken the recovery contract to make the test pass. The recovery contract and ADR-011's
     witness are explicitly preserved (§17.4).

PART B — resource identity + recovery 2.0 (master-plan WAVE 5)
  5. Model external resources (sandbox today, MCP session later) with IDENTITY and LIFECYCLE inside
     the event vocabulary (contract-additive per §7): each resource has a stable id, a lifecycle
     (created → attached → maybe suspended/released), and resume REATTACHES by identity instead of
     reconstructing. Prior art to imitate: TrueForge TurnResourceResolver.
  6. The Rust: what is an ORION "resource"? Define it as a handle to an ambient capability (a
     sandbox, a provider session, later an MCP session) whose loss does NOT corrupt the trajectory —
     because the event log is informative even without the live handle.
  7. Recovery 2.0: extend decideRecovery so an UNSAFE resource that can't be re-attached ESCALATES
     (already correct), but a resource whose identity survived (same id, same snapshot) can be
     re-issued with a witness. Add the smallest new recovery state that makes the crash conspiracy
     (SIGKILL while a resource is mid-lifecycle) recoverable — do NOT grow this beyond what the
     matrix proves. Keep the ADR-011 witness branch intact.
  8. Resume: `orionctl resume <run>` reattaches the sandbox resource by id (or rebuilds it and SAYS
     "reconstructed" honestly in the event), never silently pretending a reconstructed sandbox is the
     same resource. The distinction "reattached vs reconstructed" must be in the event log.

PART C — grant store + live output (audit S2/A4/§5; makes auto-allow survivable)
  9. Grant store: an approval remembered for session / project / command-pattern (audit §5). "npm
     test" approved once, not once per turn. This is what makes the default posture survivable
     BEFORE a real sandbox exists AND makes the container backend's auto-allow not a footgun.
     Persisted where the runtime persists (the store), addressed by project/pattern — and id-scoped
     when a resource grants are about.
  10. Live output during a run (audit Wave-5 bullet): a committed stream of deltas the CLI can show
      incrementally, NOT a fake-terminal render and NOT a contract change if avoidable — check if the
      Wave-4 stream can be the transport.

CONTRACT RULES:
  - Additive ONLY. New event types allowed where the wave genuinely needs them (resource identity
    WILL need lifecycle types; live-output might ride the existing stream events) — version
    additively per §7, document each new type and why. Do NOT rename/delete/retype existing types.
  - The event log and its closed additive vocabulary · recovery contract + ADR-011 witness · zero
    production dependencies (container backend uses an existing CLI only) · honest sandbox docs ·
    replay structural zero-model-call property · `explain` · the `runtime ≠ evaluation` boundary —
    ALL explicitly preserved (audit §17.4).
  - Do NOT grow core/recovery beyond what the crash matrix proves. Do NOT weaken containment.
  - LocalSandbox impl unchanged in behavior; extraction is structural, tested by the same suite green.
  - Product name ORION. research/ stays untracked / out of package commits.

BOUNDARIES (hard stops):
  - NO MCP yet (Wave 6; this wave gates it).
  - NO subagents (Wave 7), NO memory (Wave 8), NO skills.
  - The container backend is MINIMAL and Linux/docker-or-podman only; do NOT build a full isolation
    platform. If docker/podman is absent, the suite SKIPS the live-container matrix (with a clear
    "SKIPPED — no container runtime" marker and a non-live structural test that still asserts the
    interface contract + posture derivation), so the wave is still provable here.
  - Network policy: per-domain, default deny, approval-remembered (that IS the grant store for
    domains). No ambient network.
  - Do NOT publish to npm in this session (0.2.0 stays staged; a release decision is separate).
  - No feature beyond the three parts above. A grant store that grants nothing (unwired) is the exact
    failure class this project keeps making — wire EVERY mechanism to the shipped configuration.

QUALITY / TEST RULES:
  - Full suite green with Git Bash first on PATH: node v0/tests/run-all.mjs → record before (950/0/31)
    and after. Suite count WILL rise (resource-identity tests, grant-store, posture-derivation,
    container-interface structural tests).
  - New tests in the right class: mechanism tests where a mechanism is proven, tests/shipped/ where
    the WIRING is proven (the audit's whole thesis). Add a shipped-config test for: default posture
    follows backend capability at the real CLI entry; a grant store approval actually unblocks npm
    test at strict posture; resume of a killed run reattaches-by-id or reconstructs-and-says-so; live
    output actually appears incrementally at the real CLI.
  - Crash matrix on container = the wave's acceptance test. Summarize per-16-case results in the
    report, identical-decisions column explicitly.
  - Respect the standing §8 manual-testing gate: a real installed build, real model, real fix-the-bug
    run under the container backend if available (else LocalSandbox with the grant store). Never
    self-report; verify the FILE and TEST result on disk.
  - Stray 0x08 check: run a byte scan for 0x08 in every changed file before declaring done (the two
    previous escapes hid a redaction bug and a wiring gap). Report the count per file.

REPORT:
  Write to research/productization/wave5-report.md: per part (A/B/C), what was implemented, the root
  choices (interface shape, identity model, recovery change), the container crash-matrix table (16
  rows × [Local = ? | Container = ? | identical?]), the posture-derivation + grant-store + live-output
  wiring table, the new event types (name + why), suite before/after, contract version (v4 → v?),
  `SKIPPED — no container runtime` markers if applicable, and the Q4 verdict. Then STOP. No Wave 6.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- **This is the merged wave you chose.** It unifies the audit's "usable autonomy" (audit Wave 5) with
  the master plan's "resource identity + recovery 2.0" (master Wave 5) because the audit's Q4 proves
  they are NOT separable: the container backend is what changes the filesystem identity the recovery
  contract is computed against, so you cannot honestly do resource identity until the backend exists.
- **I verified the current state before writing:** recovery/index.mjs (6 classes, AUTO_REISSUE,
  ADR-011 witness branch, classifyShell DEFAULT-DENY, isKnownDangerous separate); LocalSandbox at
  v0/src/sandbox/local/index.mjs (containment + symlink-escape, clamp, scrubEnv, attachCheckpoints →
  host git shadow repo — this is exactly the identity change Q4 worries about); auth seam now gates
  on action.command (F4.5); CLI has the composition root. The crash-matrix test files exist
  (v0/tests/crash/matrix.test.mjs, _helpers/crash-runner.mjs, crash-append.mjs).
- **Deliberate controls written in:** minimal container backend (Linux/docker-or-podman only) with an
  honest SKIP path so the wave is provable in THIS environment even without a container runtime; the
  recovery contract + ADR-011 witness are preserved outright (audit §17.4); the "wire EVERY mechanism
  to the shipped configuration" clause is explicit because that is the failure class this project
  keeps repeating; the 0x08 byte scan is codified so the recurring corruption failure can't hide again.
- After this returns: I verify against the tree the same way (measure, don't trust), then a real
  release decision (0.2.0 publish), then Wave 6 (Skills + MCP) — for which Wave-5 resource identity is
  the declared prerequisite.