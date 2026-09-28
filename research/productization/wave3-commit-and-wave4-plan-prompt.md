# Session prompt — Wave 3 commit (clean unit) — then WAVE 4 planning

Hand this to the executing agent (Claude). One disciplined session: (1) commit Wave 3 as a clean,
verified unit, (2) then produce the WAVE 4 plan (Provider abstraction + streaming + provenance) per the
master plan — NOT Wave 4 implementation. HARD STOP after the plan. No Wave 4 code, no republish.

---

```
Role: Executing agent for ORION (@kernlbase/orion runtime, repo v0/). Waves 1-3 are complete and
verified. Wave 1 = 00b68a6, Wave 2 = 9de5324; Wave 3 (Context maturity + artifacts) is DONE, verified
independently (797 passed / 0 failed / 28 suites; contract v3 / 36 types; CI 4/4 green + package
validation), and sits UNCOMMITTED in the working tree. This session does EXACTLY two things:
(1) commit Wave 3 as a clean unit, (2) write the WAVE 4 plan. Then HARD STOP. No Wave 4 code, no
republish, version stays 0.1.2.

Read first:
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md (§5 WAVE 4, §6 deps, §7, §8 manual protocol)
  research/productization/wave3-report.md
  research/productization/wave2-report.md
  research/productization/future-queue.md   (relevant: step-evidence queue, Qwen adherence eval notes)

──────────────────────────────────────────────────────────────
PART 1 — Commit Wave 3 (clean unit)

Stage ONLY the Wave 3 files. Do NOT use `git add -A`. Do NOT stage research/ (untracked
productization material, never in a package commit) or the incidental time/nonce-variant result
snapshots (results-concurrency.json, results-provider.json, results-repl.json, results-replay.json,
results-security.json, crash-matrix.json, and the new results-context.json if it is nonce churn —
git restore any the suite touched).

Wave 3 files to stage:
  v0/src/core/projection/artifacts.mjs                (new — hashed, provenance-bearing artifact fold)
  v0/src/core/projection/compact.mjs                  (budget-aware compaction; provenance ids; verify-verdict retention)
  v0/src/core/event/index.mjs                         (EVENT_CONTRACT_VERSION = 3; artifact.created; 36 types)
  v0/src/agent/loop/worker.mjs                        (compactContext on by default; budget-aware; artifact creation)
  v0/src/index.mjs                                    (artifact API exports; stale OFF-BY-DEFAULT note corrected)
  v0/tests/context/                                   (new — 50 assertions incl. compaction-replay identity test)
  v0/tests/run-all.mjs                                (context suite registration)
  v0/tests/planning/planning.test.mjs                 (version-assertion relaxed to ">= v2")

Before committing, confirm the full suite is green in a Git-Bash-on-PATH environment:
  node v0/tests/run-all.mjs  →  TOTAL: 797 passed, 0 failed across 28 suites.

Commit message consistent with prior waves (clear one-liner, e.g.):
  "Wave 3: context maturity + artifacts — budget-aware compaction on by default with provenance and
  verify-verdict retention; hashed content-addressed artifacts"

Commit ONLY the staged files. After the commit, run `git status` and report the working tree holds
only the expected untracked research/ and incidental snapshot churn — no stray product modifications.
Do NOT commit anything else.

──────────────────────────────────────────────────────────────
PART 2 — WAVE 4 PLAN (write the plan; do NOT implement)

Produce a Wave 4 implementation plan in a NEW file research/productization/wave4-plan.md. This is the
master plan's WAVE 4 — "Provider abstraction + streaming + provenance". Do NOT write product code.
This is plan-first (plan-first-before-implement is the established discipline). The plan must:

1. STATE THE GOAL precisely from MASTER-HARNESS-DEVELOPMENT-PLAN.md §5 WAVE 4 (cite it). Read that
   section and quote the intent, then restate scope for THIS wave.

2. DESIGN the provider abstraction seam. Context it MUST handle honestly (from wave3/this session):
   - There is currently ONE OpenAI-compatible client (core/model/index.mjs) + a Gemma/vLLM tool-call
     shim (shims/gemma-tool-calls.mjs). Wave 4 abstracts this so providers are pluggable.
   - The seam must keep provider quirks in the shim (the standing rule), keep the model-tool-call
     normalization, and record degradation (never silent fallback — the 'degraded' event).
   - It must preserve event-contract backward-compat: a v1/v2/v3 log still replays (members only ever
     added; version on change).

3. DESIGN streaming. Plan it as DURABLE PARTIAL EXECUTION, not a cosmetic HTTP stream. Must be
   trajectory-native: partial yields and final result both land in the event log as attributable
   events, replay reconstructs without a new model call, and the event contract is versioned if new
   stream.* types are needed. Plan WHERE partial results are stored (inline vs artifact) — connect to
   Wave 3's artifacts (an unpaged/large streamed chunk that overflows a budget should become an
   artifact, not an unbounded inline blob).

4. DESIGN provenance (source event ids on derived events) where the plan §5/§6 call for it, keeping it
   consistent with Wave 2's plan-fold and Wave 3's artifact provenance.

5. BOUNDARIES / NON-GOALS: this is NOT skills, MCP, memory, subagents, multi-TOP model benchmarking, or
   a broad provider catalog. List explicitly what WAVE 4 will NOT do. Do NOT grow core/recovery. Keep
   eval/ out of v0/src product code.

6. DEPENDENCIES (from plan §6): state what Wave 4 builds on (Wave 2 plan-fold, Wave 3 artifacts) and
   what later waves build on it. Note the Qwen/adherence finding from future-queue.md — Wave 4's
   multi-provider seam is what makes per-model plan/verify adherence MEASURABLE; keep that as an
   eval-adjacent consequence, not a Wave 4 deliverable.

7. GATE + MANUAL PROTOCOL (the standing §8 rule — cite it): a real installed-build terminal test with
   a real model must exercise streaming end-to-end (partial yields appear in the log, replay
   reconstructs, no model call), and a second provider must be demonstrably swappable. Define the
   acceptance tests (demanding, not "it streams").

8. RISK + EFFORT from plan §7 for WAVE 4, and an explicit STOP rule (hard stop after implementation,
   no scope creep, no republish unless separately approved).

Constraints:
  - Product name ORION. No renames. Version stays 0.1.2. No republish.
  - This plan file is untracked productization material — never a package commit.
  - Do NOT write any v0/src code in this session. Plan only.

REPORT: Wave 3 commit hash + confirm full-suite gate was green (797/28); the exact Wave-3-only staged
file list; where wave4-plan.md lives and its top-line scope/design decisions; confirmation that no
Wave 4 code was written and nothing was republished. Then STOP.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- **Verified Wave 3 before writing this:** 797/28 reproduced, contract v3/36, artifacts.mjs + compact.mjs
  + worker.mjs budget-aware changes all confirmed on the tree, CI fixes already committed/pushed
  (`f2e2632`→`cd29f67`), Wave 3 uncommitted awaiting this commit.
- **Part 2 is deliberately plan-FIRST** — Wave 4 is more architecturally invasive than 1-3 (provider
  seam + streaming + provenance), so it gets a written plan before any implementation, per the
  established plan-first discipline.
- The Wave 4 plan should lean on future-queue.md (Qwen adherence) and Wave 3's artifacts for the
  streaming-storage decision.
- After this session: push Wave 3 (so CI runs on it), freeze, then run the Wave 4 plan as a separate
  review before Wave 4 implementation.
```
