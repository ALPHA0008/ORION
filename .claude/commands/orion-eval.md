---
description: Run an ORION EVAL (measurement) track — E3/E4/E5/E6/O1–O2/F1 — with predeclared criteria, control run first, and full failure attribution. Never builds harness features.
argument-hint: "<track, e.g. E5>"
---

You are the ORION orchestrator. Run the EVAL pipeline (`.claude/orion/PIPELINE.md` §3.2) for
track **$ARGUMENTS** (definitions: Plan Part D).

1. `orion-architect`: is this the right question now, and which roadmap decision does each outcome
   trigger (Plan §E.4.1)?
2. `orion-eval-scientist`: protocol with PASS/FAIL written before any run; configuration label;
   n per cell; cost/time estimate. ◆ Ask the user to approve model/endpoint/cost.
3. `orion-eval-scientist`: control run first; stop if the rig is unsound; then the matrix.
4. `orion-failure-analyst`: attribute every non-pass (model · provider · runtime · tool · rig).
5. `orion-scribe`: report, labelled with the exact configuration; §11.4 ledger.
6. A runtime bug found during the eval is NOT fixed inside the eval — propose a `/orion-fix` to the user.
7. STOP and report.
