# Session prompt — WAVE 3 (Context maturity + artifacts)

Hand this to the executing agent (Claude). This is the master plan's WAVE 3: Context Maturity +
Artifacts. It is preceded by a REQUIRED CI-verification precondition gate (from Wave 2's open item).
One disciplined session. HARD STOP at the end. No WAVE 4.

---

```
Role: Executing agent for ORION (@kernlbase/orion runtime, repo v0/). Waves 1 and 2 are committed and
verified. Wave 1 (Truthful Completion) = 00b68a6; Wave 2 (Planning + Verification Loop) = 9de5324.
This session implements the master plan's WAVE 3 — Context Maturity + Artifacts. Do EXACTLY the scope
below. HARD STOP at the end. No WAVE 4, no republish (version stays 0.1.2 unless a deliberate bundled
release is approved — do NOT republish on your own).

──────────────────────────────────────────────────────────────
PRECONDITION GATE — Wave 2 CI must be green first (do this before Wave 3 code)

The repo must be pushed and the GitHub Actions matrix green BEFORE you write Wave 3 product code:
  ubuntu-latest × Node 22, Node 24
  windows-latest × Node 22, Node 24
  for: npm test, npm pack, CLI-execc.

If the matrix is NOT green, STOP and fix ONLY the CI/environment issue (do not start Wave 3). Report
exactly what the remote run showed on each cell. If you cannot reach GitHub from here, say so — the
precondition is: the LOCAL equivalent (Git Bash first on PATH) is green at `node v0/tests/run-all.mjs`
(746 passed, 0 failed / 27 suites), and the remote matrix must be confirmed by the user on push. Do
not treat "can't reach GitHub" as license to skip the check — treat it as an unfinished precondition
and say so.

Read first:
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md (§5 WAVE 3, §6 deps, §2.1, §8 manual
  protocol, the §8 manual-testing gate you added)
  research/productization/wave2-report.md
  research/productization/future-queue.md   (the step-evidence queue is WAVE-3-ADJACENT — reviewed but
  NOT necessarily built this wave; do not overreach)

──────────────────────────────────────────────────────────────
WAVE 3 SCOPE — Context Maturity + Artifacts

From plan §5 WAVE 3: "Turn compaction on by default with budget-aware triggering; add provenance
(source event ids in ...)". The goal: handle long-running execution without losing useful context and
evidence. Two halves:

1) COMPACTION — make it real and safe:
   - Currently compaction exists (core/projection/compact.mjs) but is OFF by default. Turn it ON with
     budget-aware triggering (compact when the log/context exceeds a budget, not on a fixed schedule).
   - Compaction must remain trajectory-native and non-lossy in the dependency sense: a replayed or
     resumed run must STILL reconstruct correctly through compaction. Verify this explicitly against
     the plan-fold (Wave 2) and completion-contract (Wave 1) — a compacted plan must fold identically.
   - Preserve event-contract versioning: compaction is a projection, so it must not silently drop or
     rename members of the frozen type set.

2) ARTIFACTS — durable evidence for long runs:
   - Represent large/derived outputs (file contents, test output, diffs, verification results) as
     ARTIFACT events or artifact references so the trajectory stays legible and replayable WITHOUT
     carrying unbounded inline blobs.
   - Artifacts must be re-referenceable after compaction (evidence integrity), not orphaned.
   - Provenance: attach SOURCE EVENT IDs to derived events where the plan §5 mentions provenance.

BOUNDARIES / NON-GOALS (be disciplined):
   - This is NOT memory, NOT MCP, NOT subagents, NOT multi-provider, NOT streaming. Those are later
     waves. Do not build them.
   - Do NOT grow core/recovery into a general command-policy module (the standing isKnownDangerous vs
     classifyShell boundary note).
   - Do NOT put eval/benchmark logic in v0/src product code.
   - Do NOT over-engineer: compaction + artifacts should be the smallest correct realization of the
     plan's WAVE 3 line. The future-queue step-evidence item is WAVE-3-adjacent; if it cleanly falls
     out of this wave's artifact/provenance work, do it — but do NOT pull it in as a separate feature
     if it inflates this wave.

ACCEPTANCE (demanding, per the standing manual-testing gate):
   - A compaction test that proves a long run (enough events to trigger budget-aware compaction) still
     reconstructs identically under replay and resume AND the plan-fold still folds the same plan.
   - An artifacts test that proves large tool output is stored as a re-referenceable artifact, that a
     verify PASS/FALSE verdict survives compaction, and that provenance links to source event ids.
   - MANUAL TERMINAL PROTOCOL (the gate is a standing rule): real installed package, a real model, a
     long-enough run that compaction actually fires, verify evidence survives, replay with zero model
     calls reconstructs it. Log commands + output.

WRITE the report to research/productization/wave3-report.md. Use the SAME structure and evidence
discipline as wave2-report.md (summary table, verified claims, manual output, deviations/honest
findings, files changed, STOP line).

──────────────────────────────────────────────────────────────
TEST/QUALITY RULES
  - Full suite must go green: Git Bash first on PATH → `node v0/tests/run-all.mjs` → TOTAL: <n>
    passed, 0 failed. Record the before/after suite count (Wave 2 ended at 746 / 27).
  - Add Wave-3 tests as new suite(s) registered in tests/run-all.mjs.
  - Respect the manual-testing gate: every major feature needs a REAL terminal test with a REAL model,
    not just unit tests.
  - Boundaries: no changes to core/recovery beyond what WAVE 3 needs; keep provider quirks in the shim;
    keep policy in the CLI contract.

──────────────────────────────────────────────────────────────
PRESERVATION / CONSTRAINTS
  - Product name ORION. No renames. Version stays 0.1.2. Do NOT republish on your own.
  - v0/src is product code; no benchmark/eval logic there.
  - Do NOT modify event-contract frozen types without versioning (compaction is a projection; keep the
    frozen set intact per plan §7).
  - Keep the "Git for coding harnesses" north star visible: ensure Wave 3 keeps producing attributable
    trajectory + provenance (source event ids) so future team-learning stays physically reachable.
  - research/ stays untracked / out of package commits (never `git add -A`).

REPORT: precondition-gate result (CI/remote status — green or explicitly unverified), what changed,
compaction + artifacts + provenance, suite before/after, evidence for the compaction-replay-identity
test and the artifact evidence-integrity test, manual terminal output, deviations/honest findings,
files changed. Then STOP. No WAVE 4.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- **The precondition gate is the honest crux:** Wave 2's only unverified claim is the real CI matrix.
  The prompt forces Claude to resolve this BEFORE writing Wave 3 code — so we never build Wave 3 on an
  unverified Wave 2. Since Claude may not be able to reach GitHub, the gate falls to you: **you must
  push and confirm the matrix before/while Claude runs this.** If you haven't pushed yet, do that now.
- Using the standing manual-testing gate in §8 (it's now in the plan, so the prompt references it
  as an explicit rule).
- The future-queue step-evidence item is deliberately gated (only if it falls out cleanly, not as a
  scope-inflating force).
- Competion/artifacts are the correct WAVE 3 per the plan and the accepted progression
  (durably → truthfully → intentionally → context/evidence for long runs).
