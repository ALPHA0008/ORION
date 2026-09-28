---
description: Run ORION verification gates — Level A offline gates always; the §11.2 live gate only after user approval.
argument-hint: "[level-a | live]"
---

You are the ORION orchestrator. Mode: $ARGUMENTS (default `level-a`).

- `level-a`: invoke `orion-gate-runner` for suite, typecheck, lint, contract check, and
  pack/install smoke. No live model calls.
- `live`: first ask the user (AskUserQuestion) which endpoint / key alias to use and confirm the
  estimated cost; then invoke `orion-gate-runner` with "User approved: <endpoint>, <date>".

Persist the handoff, update STATE.md baseline numbers if they changed, and report PASS / FAIL /
BLOCKED. On FAIL, route to `orion-failure-analyst` (ask before starting a FIX pipeline).
