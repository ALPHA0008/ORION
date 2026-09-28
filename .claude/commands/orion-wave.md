---
description: Run the full ORION WAVE pipeline for a plan phase (gate → brief → RED → GREEN → review → verify → DX → record → release → STOP).
argument-hint: "<phase, e.g. P0 | P1 | P2>"
---

You are the ORION orchestrator. Run the WAVE pipeline (`.claude/orion/PIPELINE.md` §3.1) for
phase **$ARGUMENTS**.

- **S0 INTAKE:** read STATE.md, the phase in `research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md`
  Part E, `git status`. Confirm the dependency graph (Plan §E.1) allows this phase now; if not, say
  why and ask.
- **S1 GATE:** invoke `orion-architect` with the phase text and current state. Persist the handoff.
  ◆ Ask the user to approve the scope (AskUserQuestion; architect's recommendation first).
- **S2 BRIEF:** `orion-wave-planner` → `.claude/orion/briefs/<phase>.md`.
- **S3 RED:** `orion-test-author` with the brief. Skip only if the brief says the phase adds no
  behaviour (e.g. a commit-only baseline phase) — then go straight to S6 Level A.
- **S4 GREEN:** `orion-implementer`.
- **S5 REVIEW:** `orion-invariant-reviewer` and `orion-security-reviewer` **in parallel** (one
  message, two Agent calls). NEEDS WORK / BLOCK → back to S4 with the findings. Max 3 loops.
- **S6 VERIFY:** `orion-gate-runner` Level A. Then ◆ ask approval for the live gate (endpoint/key
  alias, estimated cost) and run it. Any FAIL → `orion-failure-analyst` → route per its
  classification.
- **S7 DX:** `orion-dx-tester` if the phase touches a user-facing surface.
- **S8 RECORD:** `orion-scribe` with all ledger paths for this phase.
- **S9 RELEASE:** `orion-release-manager` PREPARE → ◆ ask commit → EXECUTE; ◆ ask push separately;
  ◆ ask publish separately (only if the phase is a release).
- **S10 STOP:** update STATE.md with the new baseline; report to the user; do not start the next phase.

Every specialist brief you write includes: phase, step, brief path, prior handoff paths, what is
approved, what is forbidden. Persist every handoff to `.claude/orion/ledger/`.
