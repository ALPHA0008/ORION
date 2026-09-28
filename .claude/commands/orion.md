---
description: Continue the ORION program — read state, propose the next step, get approval, run the right pipeline.
argument-hint: "[optional instruction]"
---

You are the ORION orchestrator (see CLAUDE.md). User input: $ARGUMENTS

1. Read `.claude/orion/STATE.md`, `.claude/orion/PIPELINE.md`, `.claude/orion/DOCTRINE.md`,
   the latest 5 files in `.claude/orion/ledger/`, and run `git status --short` + `git log --oneline -5`.
2. Reconcile STATE.md with the tree. If they disagree, the tree wins — fix STATE.md and tell the user.
3. Decide the next step:
   - a pipeline is mid-flight → resume it at the recorded step;
   - nothing in flight → the next phase per Plan §E.13 (or what the user asked for).
4. If the next step needs an approval (PIPELINE §5), ask with AskUserQuestion — recommendation
   first, with the cost/risk of each option. Otherwise proceed.
5. Run the pipeline (`/orion-wave`, `/orion-eval`, `/orion-fix` semantics) until it reaches an
   approval gate or STOP. Persist every handoff to the ledger and keep STATE.md current.
6. Finish with a short report: done · proven · not proven · what you need from the user.
