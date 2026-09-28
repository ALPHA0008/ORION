# Session prompt — Wave 2 commit + record-keeping (no feature changes)

Hand this to the executing agent (Claude). One disciplined session: commit the verified Wave 2 as a
clean unit, add the three agreed record-keeping/doc items, then HARD STOP. No new features, no
republish, no Wave 3.

---

```
Role: Executing agent for ORION (@kernlbase/orion runtime, repo v0/). Wave 2 (Planning + Verification
Loop) is COMPLETE and independently verified (746 passed / 0 failed / 27 suites reproduced locally;
T1/T2/T3 pass; manual SIGKILL resume proved plan-as-fold identity; version stays 0.1.2; nothing
republished). This session does EXACTLY two things: (1) commit Wave 2 as a clean unit, (2) make three
agreed doc/record-keeping additions. Then STOP. Do NOT add features, do NOT touch plan logic, do NOT
republish, do NOT start Wave 3. Wave 1 is already committed (00b68a6).

Read first (context, do not modify): research/productization/wave2-report.md,
research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md.

──────────────────────────────────────────────────────────────
PART 1 — Commit Wave 2 (clean unit)

Stage ONLY the Wave 2 files. Do NOT use `git add -A`. Do NOT stage research/ (untracked
productization material, never in a package commit) or the incidental time/nonce-variant result
snapshots (results-concurrency.json, results-provider.json, results-replay.json, results-security.json,
crash-matrix.json — git restore any that the suite touched).

Wave 2 files to stage:
  v0/src/core/projection/plan.mjs                      (new — the plan fold)
  v0/src/core/event/index.mjs                          (EVENT_CONTRACT_VERSION = 2; 4 plan.* types)
  v0/src/agent/tools/index.mjs                         (plan, plan_step tools + emits seam)
  v0/src/agent/loop/worker.mjs                         (emits dispatch; plan+verify system-prompt policy)
  v0/src/agent/model/shims/gemma-tool-calls.mjs        (parseArray for array-valued args)
  v0/src/cli/index.mjs                                 (contract consumes the plan; status/status --json plan)
  v0/src/index.mjs                                     (export plan projection + EVENT_CONTRACT_VERSION)
  v0/tests/planning/                                   (new — 54 assertions: T1/T1-blocking/T2/T3/shim)
  v0/tests/run-all.mjs                                 (new planning suite registration)

Before committing, confirm the full suite is green in a Git-Bash-on-PATH environment:
  node v0/tests/run-all.mjs  →  TOTAL: 746 passed, 0 failed across 27 suites.

Commit message style consistent with Wave 1 (a clear one-liner, e.g.):
  "Wave 2: planning + verification loop — a plan is a fold over plan.* events, survives SIGKILL,
  and the completion contract now consumes it"

Commit ONLY the staged files. After the commit, run `git status` and report that the working tree
contains only the expected untracked research/ and incidental result-snapshot churn (if any) — no
stray product modifications. Do NOT bundle the doc additions of PART 2 into this product commit; they
belong in PART 3 as a separate research-only commit (or staging), see below.

──────────────────────────────────────────────────────────────
PART 2 — Three agreed record-keeping additions (doc/research only, NO code)

Add all three to the research/productization/ records. These must NOT enter any package commit;
keep them under research/ only.

1. Future-research queue — step evidence as model + runtime (park, do not build):
   In wave2-report.md (or a NEW small research/productization/future-queue.md if cleaner), record:
   "plan_step evidence is currently model-declared. Future direction (queue, NOT Wave 2 scope): fold
   model-declared evidence with runtime-derived evidence — e.g. a step that says 'fixed calc.py'
   should also carry the edit-hash / file-changed evidence and the verify PASS from the trajectory,
   so step evidence becomes model + runtime, not model alone. This deepens the trajectory/provenance
   alignment and should be designed, not bolted on."

2. Permanent manual-testing gate (make it explicit in the plan):
   In MASTER-HARNESS-DEVELOPMENT-PLAN.md §8 (manual protocol), add a gate line:
   "No major feature is considered proven until a real installed-build terminal test exercises it
   with a real model. (Established by Wave 1's wiring catch and Wave 2's Gemma array-parsing catch —
   both missed by 700+ automated assertions.)"
   Do not change any product code to do this.

3. The Qwen no-plan finding → Track-A eval note (not a runtime claim):
   In wave2-report.md, make explicit (or add to the eval/ notes): "qwen3:14b skipped calling plan
   and edited directly. Classified as a MODEL-BEHAVIOR / evaluation question, NOT a runtime defect.
   Future eval items: per-model plan adherence, verify adherence, and replanning behavior, measured
   without claiming the harness failed." Do not assert universality in the README.

──────────────────────────────────────────────────────────────
PART 3 — Separate the record-keeping from the product commit

The research/productization/ additions are INTENTIONALLY untracked project material. Confirm they do
not get staged into the Wave 2 product commit (PART 1) or any package commit. If a separate commit for
them is wanted, keep it clearly separate from the runtime commit and note it as research-only. If the
user prefers to leave research/ untracked, leave them untracked and say so.

──────────────────────────────────────────────────────────────
CONSTRAINTS
  - Product name ORION. No renames. Version stays 0.1.2. Do NOT republish.
  - Do NOT modify any v0/src logic in this session beyond what is already on disk (Wave 2 code is
    complete). This session is commit + record-keeping only.
  - Hard stop. No Wave 3 start.

REPORT: commit hash + confirm the full-suite gate was green (746/27), the exact Waves-2-only staged
file list, what the three record-keeping additions say and where they live, and that research/ stayed
out of the product commit. Then STOP.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- **Verified pre-session ground truth:** HEAD is `00b68a6` (Wave 1 committed); Wave 2 files are
  untracked/modified in the working tree; `research/productization/` is untracked by design; the full
  suite reproduces at 746/27 with Git Bash on PATH.
- After this session: **push**, then watch the real CI matrix (Ubuntu×22/24, Windows×22/24) on GitHub.
  CI verification is a separate step from this commit and may surface Windows-only runner issues to
  fix independently — do not let it hold the clean commit.
- Push + CI + freeze are the user's next actions; then Wave 3 (Context Maturity + Artifacts).
