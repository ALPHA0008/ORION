# Session prompt — Wave 1 closure + CI fix + WAVE 2 (Planning + Verification Loop)

Hand this entire prompt to the executing agent (Claude). It is the plan/supervision directive from the
planner. One disciplined session. Hard stop at the end.

---

```
Role: Executing agent for ORION (@kernlbase/orion runtime, repo v0/). This is a three-part session:
(A) fix CI, (B) commit Wave 1, (C) implement WAVE 2 — Planning + Verification Loop (per the NEW master
plan). WAVE 1 (Truthful Completion) was verified independently (692 tests / 26 suites green,
real-terminal model runs) and is a clean, self-contained, tested unit awaiting commit. Do EXACTLY this
sequence. Hard stop at the end. No WAVE 3.

IMPORTANT TERMINOLOGY: The historical files research/productization/wave2-*.md (dated 03-09-2026:
"@kernlbase/harness, grep fixes, honest runtime docs") describe the OLD packaging wave that was ALREADY
COMMITTED (commit 6f6afcc, later renamed to Orion in a450be8). They use a different, superseded
numbering. The AUTHORITATIVE plan is MASTER-HARNESS-DEVELOPMENT-PLAN.md, whose WAVE 2 = "Planning +
verification loop". Reference that plan's WAVE 2, NOT the old wave2-*.md files (history only).

Read first:
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md (§5 WAVE 2, §6 deps, §2.1, §8 manual protocol)
  research/productization/wave1-report.md

──────────────────────────────────────────────────────────────
PART A — Step 0: Fix Windows CI shell path (SMALL, do first)

The security-suite bash failure is solved locally via preflightShell() in v0/tests/run-all.mjs
(it detects an unusable/WSL-filesystem bash and fails loudly). But CI on windows-latest still runs with
`bash` resolving to C:\Windows\System32\bash.exe (WSL) or none, because Git Bash's bin/ is not on PATH.
Fix .github/workflows/ci.yml so the windows jobs use a real Git Bash that (a) runs the shell, (b) sees
the checked-out workspace path. Use a robust approach (e.g. ensure Git\cmd\..\bin is on PATH for the
step, or set the `shell` for the test step to a Git-Bash shell), and confirm the suite passes in that
shell. Do not rely on the Windows default shell.

PART A gate (Step 1): CI green on BOTH ubuntu-latest and windows-latest, Node 22 and 24 — npm test,
npm pack, CLI-execc. If you cannot run GitHub CI locally, state clearly what you verified vs. what must
be checked on push, and make the .yml change exact and minimal. The local equivalent that MUST pass:
with Git Bash's bin/ first on PATH, `node v0/tests/run-all.mjs` reports TOTAL: <n> passed, 0 failed.

──────────────────────────────────────────────────────────────
PART B — Step 2 & Step 3: final local acceptance, then commit Wave 1

Step 2 (final local acceptance, installed-package-shaped): npm pack the local tarball, install it in a
clean dir, and run orionctl --version / --help / doctor, plus one real run on a fresh broken calc.py
that now must ACTUALLY fix the file (or fail truthfully), and one slow-model run that must NOT
lease_lost. Record output.

Step 3: Commit ONLY Wave 1 (the verified working tree: v0/src/agent/loop/worker.mjs,
v0/src/cli/index.mjs, v0/src/agent/tools/index.mjs, v0/src/core/recovery/index.mjs,
v0/src/core/event/index.mjs, v0/tests/security/security.test.mjs, v0/tests/run-all.mjs,
v0/tests/leaseheartbeat/, v0/tests/truthfulcompletion/, plus the non-time-variant results files). Do
NOT bundle Wave 2 in this commit. Keep research/ and the incidental time/nonce-variant result
snapshots OUT (git restore them, as Wave-2 did). Write a clear message. Do not publish/republish.

──────────────────────────────────────────────────────────────
PART C — Step 4: WAVE 2 — Planning + Verification Loop

Goal (from plan §5 WAVE 2): the smallest useful plan abstraction as a DERIVED structure over the
authoritative event log — NOT a workflow engine, NOT a side system. Planning must be representable as
plan.* trajectory events so a plan is durable, replayable, forkable provenance, exactly like
completionContract in Wave 1. Effort L/M; risk: over-engineering — keep it minimal. Splittable:
planning, then replanning.

Design constraints:
  1. Plan = goal → ordered steps; each step has: state (pending/active/done/failed), dependency,
     evidence, retry count.
  2. Replanning: a failed step may revise the step list MID-run; the revision itself is a recorded
     trajectory event (old plan / new plan / reason). Nothing is held only in memory.
  3. Wire the `verify` tool into the DEFAULT system prompt so the agent prefers it after a mutating
     step that needs validation — closing the Wave-1 flagged gap. Keep the guidance precise and small
     (prompt policy, not a framework).
  4. CRITICAL: the plan must live on the durable trajectory such that survival across a crash is
     provable — a plan reconstructed by replay/resume must be identical to the one at crash time.

Acceptance tests — the DEMANDING version, not "a plan exists":
  T1 (happy path): task → plan → execute step → verify → PASS → advance → next step → ... → completed.
     Assert each step's verify evidence is in the trajectory and the completion contract consumed it.
  T2 (fail/replan): a step → verify FAIL → the agent replans (new event) → new action → verify PASS →
     complete. Assert the replan is a recorded event and the old plan is preserved.
  T3 (crash/resume): mid-plan, kill/reset the worker → resume → the recovered run reconstructs the SAME
     plan from the trajectory and continues → verify → complete. Assert replay of the final run also
     reconstructs the plan identically. This is the architectural test that matters most: the plan is
     trajectory, not ephemeral JSON.

Manual terminal protocol (real installed package, per plan §8): run T1/T2/T3 against a real model on
the broken calc.py, plus the deliberate mid-plan kill→resume. Record every command + observed output +
file/test ground truth. Write research/productization/wave2-(planloop).md (do NOT overwrite the old
wave2-final-report.md history — use a distinct filename).

──────────────────────────────────────────────────────────────
PRESERVATION / CONSTRAINTS
  - Product name ORION. No renames.
  - v0/src is product code; no benchmark/eval logic there.
  - Do NOT republish. Version stays 0.1.2 this session (a deliberate release will bundle Wave 1 + Wave 2
    later).
  - Keep the "Git for coding harnesses" north star in mind but do NOT build Wave 11 content. Only ensure
    Wave 2 continues producing attributable trajectory events so future team-learning remains physically
    reachable.
  - If plan.* needs new event types, version the event contract explicitly (plan §7); do not silently
    grow the frozen set.
  - Watch the recovery-module boundary (isKnownDangerous vs classifyShell concern): if Plan/Replan
    policy helpers are needed, put them in a plan module — do NOT grow core/recovery into a general
    command-policy module.

REPORT: Part A result (CI exact change + local green + what must be checked on push), Part B commit
hash, Part C what changed + T1/T2/T3 evidence (esp. T3 crash/resume/replay identity) + manual output
file. Then STOP. No WAVE 3.
```

---

## Planner notes (for the user — do not paste into the agent prompt)

- **Verified ground truth before writing this:** git log shows the old "Wave 2" packaging was committed
  (`6f6afcc`) and renamed to Orion (`a450be8`); the current package is `@kernlbase/orion@0.1.2`; Wave 1
  (Truthful Completion) is **not yet committed**; CI exists on disk and is tracked; the two new Wave-1
  suites and `selectShims`/`isKnownDangerous` are present in the working tree.
- The label collision (historical wave2-*.md vs plan's WAVE 2) is resolved by the terminology note at the
  top of the prompt.
- Part C is intentionally demanding (T1/T2/T3, especially T3 crash/resume/replay-identity) so the plan
  is proven to be trajectory, not ephemeral JSON.
