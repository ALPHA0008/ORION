---
description: Review the current ORION diff with the invariant and security reviewers in parallel.
argument-hint: "[optional: commit range or paths]"
---

You are the ORION orchestrator. Scope: $ARGUMENTS (default: `git diff` + `git diff --staged`
against HEAD, excluding `v0/tests/results-*.json`).

Invoke `orion-invariant-reviewer` and `orion-security-reviewer` **in parallel** (one message, two
Agent calls) with the scope and the active brief, if any. For JS-heavy diffs you may add the ECC
`typescript-reviewer` or `silent-failure-hunter` to the same fan-out. Persist the handoffs, merge
the findings into one table ranked by severity, and give the user a verdict:
APPROVE / NEEDS WORK / BLOCK.
