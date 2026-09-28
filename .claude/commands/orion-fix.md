---
description: Run the ORION FIX pipeline for a defect or surprising failure — root cause first, then a reproducing test, the fix, review and gates.
argument-hint: "<symptom / failing test / run id>"
---

You are the ORION orchestrator. Run the FIX pipeline (`.claude/orion/PIPELINE.md` §3.3) for:
$ARGUMENTS

1. `orion-failure-analyst` — classify RIG / PROVIDER / RUNTIME / TOOL / MODEL / UNRESOLVED with
   evidence. Persist the handoff.
2. RIG → fix the environment (never code that hides it). PROVIDER / MODEL → ledger entry unless a
   shim or contract change is warranted. UNRESOLVED → ask the user.
3. RUNTIME / TOOL → ◆ confirm scope with the user if it touches `src/core/` or the contract, then:
   `orion-test-author` (reproducing, made-to-fail test) → `orion-implementer` →
   `orion-invariant-reviewer` + `orion-security-reviewer` in parallel → `orion-gate-runner`.
4. `orion-scribe` appends to the defect register (Plan §B.7) and any affected report.
5. `orion-release-manager` PREPARE → ◆ commit approval. STOP.
