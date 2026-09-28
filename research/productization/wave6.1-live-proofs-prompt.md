# Session prompt — WAVE 6.1 "LIVE PROOFS / CLOSE THE §11.4 GAPS"

Hand this to the executing agent (Claude). This is a SHORT hardening wave: it does NOT add product
feature, does NOT change the contract, and does NOT touch Wave 7 scope. It exists because Wave 6
(the execution environment) shipped three claims that were **asserted, not measured**, and this
project's rule is "measure, don't trust". We close them against the live docker daemon that IS
present on this device (Docker 29.5.3, Windows/WSL2), and we re-run the manual gate under the
container backend. After this returns and I verify, the decision point is W7.

---

```
Role: Executing agent for ORION (@kernlbase/orion, repo v0/). State entering this wave:
  package 0.2.1 PUBLISHED and verified on npm. Commit 681be8b "Wave 6: execution environment,
  resource identity, Recovery 2.0" is HEAD (parent 551885e). Suite 1286/0/35, contract v5/46.
  Wave 6's §11.4 (research/productization/wave6-execution-environment-report.md) disclosed FOUR
  gaps; THREE of them are closable on THIS device right now (a docker daemon is running — verified
  live: docker 29.5.3, server reachable). The fourth (Linux-native / podman) is a platform claim
  this Windows/WSL2 host cannot exercise; it stays a disclosure.
  Working tree: nothing modified except untracked research/ + archify-out/ and the timing-only
  results-*.json snapshot refreshes from the W6 verification run (leave them alone).

Read FIRST (source of truth, in order — all paths from repo root):
  research/productization/wave6-execution-environment-report.md — §11.4 is the gap list; Q4,
    the 8-point crash matrix, and the §11.2 manual gate are the reference work being extended.
  v0/src/sandbox/container/index.mjs   — the container backend: acquire() passes --cpus/--memory/
    --pids-limit (lines ~155-157), networkFlagsFor() decides --network none vs bridge, exec()
    error taxonomy, reattach() by identity, idempotent release().
  v0/src/sandbox/network.mjs           — two-layer policy: HARD_BLOCKED (checked first, not
    overridable), then mode none/deny/allowlist; networkFlagsFor = the docker flags.
  v0/src/sandbox/local/index.mjs       — LocalSandbox (impl #1) the gate is currently run against.
  v0/tests/crash/matrix-container.test.mjs — the live container acceptance test; its SKIP-when-
    no-runtime pattern is the template for the new live tests. detectRuntime() gates on a real
    runtime; never report green when skipped.
  v0/tests/_experiments/q4live.mjs     — the W6 live-proof experiment; the model for these.
  v0/src/cli/index.mjs                 — composition root; makeSandbox()/ORION_SANDBOX selection.
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md §11 (testing policy incl. 11.2
    manual gate, permanent) and §11.4 (honest disclosure of what was NOT exercised).

THE PROBLEM (why this wave exists):
  Wave 6 earned its Q4 PASS and I verified it independently, but three of its claims are
  unstated-strength. All three are provable on the live daemon in front of you:

  GAP 2 — resource limits are "set but not measured". --cpus/--memory/--pids-limit are passed and
    the container starts; nothing proves they BIND. Under auto-allow (W6-K), an unmeasured limit
    is the difference between "a runaway tool call is contained" and "a runaway tool call pins the
    host". This is the exact load-bearing property autonomy pays for.
  GAP 3 — network allowlist mode is unit-tested only. The shipped default (--network none) is
    live-verified; the allowlist mode — the one operators turn on when a run needs egress — is not.
    A hole there is the exfiltration route.
  GAP 4 — the §11.2 manual gate ran on LocalSandbox, not the container. The container is where
    auto-allow is PROMISED; the end-to-end real-model proof of it (real install, real model, real
    SIGKILL, reattach by identity, no duplicate effect) has never been demonstrated under the very
    boundary the claim lives on.

SCOPE — exactly three proofs. No product change unless a proof reveals one is needed:

  PROOF 2 — the limits bind. Live experiment (template: q4live.mjs), against a real container
    started with the SAME constructor defaults the shipped path uses (do not special-case the
    test):
      a) CPU: run a busy loop (e.g. `while :; do :; done` or node -e 'for(;;){}') inside the
         container, sample its container-level cpu usage for several seconds, and assert it does
         NOT exceed the configured quota — measured, not eyeballed (docker stats or the cgroup
         cpu.stat/cpu.max read from inside the container, both if available; the assertion must
         be the artifact, not a screenshot).
      b) MEMORY: allocate far past the configured --memory inside the container; assert the
         container is killed (OOM, exit 137 / "Killed") or the process is denied the allocation —
         i.e. the limit produced an observable, unbusiness-as-usual outcome. Assert explicitly
         that it was NOT business-as-usual.
      c) PIDS: fork-bomb-lite (`while :; do (c=: &); done` or `node -e 'for(;;){new Promise(r=>r())}'`
         spawning) past --pids-limit; assert new block()/fork() is refused (EAGAIN/killed), not
         silently admitted.
    Each assertion FAILS the experiment when the limit does not bite. A green experiment is an
    automated artefact, not a log read.
  PROOF 3 — network allowlist works LIVE, wired to the shipped path. Against a real container
    launched with a REAL allowlist policy through makeSandbox()/the composition root (not a raw
    docker call):
      a) a destination that IS allowed (a local server reachable from the container's bridge
         network, or a companion container on the same bridge — choose what the docker/WSL2 setup
         actually supports) succeeds.
      b) an explicitly non-allowed destination fails (default-deny holds live).
      c) a HARD_BLOCK destination (e.g. 169.254.169.254 or 127.0.0.1) stays denied even when the
         policy claims to allow it — the strongest claim in network.mjs proven against a live
         container, not just the unit test.
    If the shipped wiring makes allowlist unreachable from the CLI in this environment, fix the
    WIRING (that is the failure class this project repeats); do not fake the test.
  PROOF 4 — the §11.2 manual gate UNDER the container backend. Re-run the Wave 6 manual gate with
    the real container backend (ORION_SANDBOX=container), same discipline as wave6 §11.2:
    real installed tarball → install into a clean directory; real model via Ollama (qwen3:14b or
    the model you used in W6) — an endpoint, not a script; a real task that edits a real file;
    SIGKILL the worker, timed by POLLING the workspace until the real edit has landed (not a
    wall-clock guess); let the lease expire; reap; resume. Assert from the FILESYSTEM and the
    event log, never from what the runtime self-reports:
      - the resume REATTACHED to the running container by identity (resource.reattached for the
        same resource_id — a second process bound to the surviving container, proven by the
        container's own filesystem marker if available, matching W6-H/I/J).
      - the file the model edited is fixed on disk; the test file passes on disk.
      - the effect landed EXACTLY ONCE (no duplicate — grep the edit count).
      - final status is what the system says it is. NOTE the expected difference from the W6 gate:
        under the container, posture is permissive/auto, so the verify command ("node test.mjs")
        should be AUTO-ALLOWED, not paused for a human. If it pauses instead, that is a WIRING
        defect (posture did not follow the backend) — report it and fix it. If it auto-runs, that
        is the W6 thesis demonstrated end-to-end: the boundary changed, not the authorization.
      - the container is cleaned up or deliberately left, and the report says which.
    Run the gate, capture the transcript exactly as W6's §11.2 did (phases 1-4), and keep the
    failure of the first attempt in the report if one occurs (the W6 gate's first run found defect
    5; honesty about a failed first run is the norm, not the exception).

CONTRACT RULES (unchanged from W6):
  - Contract stays v5/46. NO new event types, NO version bump, NO renames. This wave proves, it
    does not extend.
  - No change to LocalSandbox behaviour. The storage layer (store.mjs) is untouched.
  - Product name ORION. research/ + archify-out/ stay untracked.
  - The crash matrix (crash/matrix-container, 27 assertions live) MUST stay green untouched — it
    is the W6 acceptance test and this wave does not weaken it. The full suite (1286/0/35) must be
    green before and after; write down both numbers.

BOUNDARIES (hard stops):
  - NO Wave 7 scope (no skills, no parallel-safe orchestration, no subagents, no MCP, no memory).
  - NO npm publish. NO contract change. NO new features. If a proof FAILS, you fix the defect the
    proof reveals and re-run the proof; you do not ship around it.
  - Linux-native (bare metal Linux docker) and podman are STILL NOT exercised — this is a Windows/
    WSL2 host. The report states this again. You are NOT expected to close gap 1.

QUALITY / TEST RULES:
  - New live proofs follow the established pattern: an experiment/test that FAILS when the claim
    is false, skips LOUDLY ("SKIPPED — no runtime") when it cannot run, and never reports green
    while skipped. Same detectRuntime()-gated shape as crash/matrix-container.
  - If a mechanism seems to grant/allow/auto-allow/live-route in the test but not at the real
    CLI, that is the wired-at-composition-root failure class — fix the CLI wiring, not the test.
  - Full suite green with Git Bash first on PATH: node v0/tests/run-all.mjs; record before
    (1286/0/35) and after.
  - Stray 0x08 scan: byte-scan every changed/untracked file for 0x08 before declaring done;
    report the count per file.

REPORT:
  Write research/productization/wave6.1-live-proofs-report.md:
  - One section per proof (2, 3, 4): what was measured, the exact assertion, the artefact (or
    transcript/verdict-table for the gate), pass/fail, and — if a proof FAILED first — the defect
    found, the fix, and the re-run.
  - The §11.4 ledger: list the FOUR original gaps and the disposition of each (closed / closed /
    closed / still standing disclosure).
  - The manual-gate transcript in the W6 §11.2 format, INCLUDING the container's auto-allow of
    the verify command (or the posture-wiring defect if it did not).
  - Suite before/after (1286/0/35 → ?), crash-matrix-container still green, contract confirmed v5/46.
  - What was STILL not exercised (Linux-native/podman gap 1; no live Anthropic; anything new the
    proofs discovered they could not test here).
  Then STOP. No W7.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- **Why not W7:** the rebaselined plan's W7 (skills, parallel-safe orchestration) is the first wave
  that will run MANY agentic loops for real minutes at a time under auto-allow. Shipping W7 on top
  of "limits set not measured, allowlist unit-tested only, real-model gate on LocalSandbox only" is
  exactly the assert-not-measure move this project exists to avoid. Three of the four gaps are
  closable in a single sitting on this machine — a docker daemon is confirmed running.
- **Gap 1 is deliberately NOT closable and NOT required.** Windows/WSL2 cannot exercise Linux-native
  or podman. It stays in every §11.4 ledger until someone runs on a Linux host. Any attempt to
  "close" it here would be fabrication.
- **Gate 4's tell:** under LocalSandbox the W6 gate ended `paused / awaiting_human`; under the
  container it should end auto-allowed for the verify command. If it does not, posture did not
  follow the backend and that is a shipped-wiring defect to fix, not to narrate around.
- After this returns I verify against the tree the same way (measure, don't trust): the proofs run
  green live, the report's assertions are real artefacts, the game isn't self-reported green,
  suite/crash-matrix/contract all hold, 0x08 scan clean. Then the decision point is W7 as planned.