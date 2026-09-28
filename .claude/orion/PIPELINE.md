# ORION Team Pipeline — how the agents work together

This is the operating manual for the orchestrator and the contract every specialist honours.

---

## 1. Topology

```
                                ┌──────────────┐
                                │     USER     │  approves scope, keys, spend, commits, push, publish
                                └──────┬───────┘
                                       │  (only channel)
                           ┌───────────▼────────────┐
                           │  ORCHESTRATOR          │  = the main Claude Code session
                           │  (CLAUDE.md + /orion)  │  owns STATE.md + ledger, routes, gates
                           └───────────┬────────────┘
     ┌────────────┬────────────┬───────┼────────┬─────────────┬──────────────┬─────────────┐
     ▼            ▼            ▼       ▼        ▼             ▼              ▼             ▼
 orion-       orion-wave-  orion-   orion-   orion-       orion-gate-   orion-failure-  orion-
 architect    planner      test-    impl-    invariant-   runner        analyst         scribe
 (judge)      (brief)      author   ementer  reviewer  ┐  (verify)      (root cause)    (record)
                           (RED)    (GREEN)  orion-    │
                                             security- ┘ parallel       orion-eval-     orion-
                                             reviewer                   scientist       release-
                                                                        (measure)       manager
                                                        orion-dx-tester (fresh-eyes install)
```

**Why the orchestrator is the main session, not a subagent:** Claude Code subagents cannot spawn
other subagents, and only the main session can ask the user questions. So the orchestrator is the
main session running under `CLAUDE.md`, and every specialist is a leaf that returns a handoff.
This is also what makes "permissions only through the orchestrator" structurally true rather than
a convention.

**Why one writer to the ledger:** specialists return handoffs; the orchestrator alone appends them
to `.claude/orion/ledger/`. The team's own history is an append-only log with one mutation path —
the same idea ORION is built on.

## 2. Roster

| Agent | Role | Writes code? | Model |
|---|---|---|---|
| `orion-architect` | Principal architect & skeptic. Feature-entry gate, thesis, direction, BUILD/DEFER verdicts | no (read-only) | opus |
| `orion-wave-planner` | Turns an approved phase into an executable wave brief (the old "session prompt") | brief file only | opus |
| `orion-test-author` | RED: writes failing, made-to-fail tests incl. `tests/shipped/` | tests only | opus |
| `orion-implementer` | GREEN: smallest change in `v0/src` that passes, invariants intact | yes | opus |
| `orion-invariant-reviewer` | Reviews diffs against the 10 invariants, contract additivity, core-size rule | no | opus |
| `orion-security-reviewer` | Sandbox, posture, grants, network, command policy, secrets | no | opus |
| `orion-gate-runner` | Level-A gates, pack/install, §11.2 live manual gate, SIGKILL/replay/fork | no src edits | sonnet |
| `orion-failure-analyst` | Any failure → attribute to rig / provider / runtime / tool / model before a fix | no | opus |
| `orion-eval-scientist` | E3–E6 measurement tracks; predeclared criteria; no harness features | eval/ only | opus |
| `orion-dx-tester` | Fresh-eyes developer: cold install, first run, errors, docs — Layer 3 truth | no | sonnet |
| `orion-scribe` | Wave report (§11.4 ledger), plan Part A/B, surface docs, ADR drafts, STATE | docs only | sonnet |
| `orion-release-manager` | Staging hygiene, commit message, pack validation, push/publish checklists | git only, after approval | sonnet |

ECC global agents remain available as extras (e.g. `typescript-reviewer`, `silent-failure-hunter`,
`code-simplifier`); the orchestrator may add one to a review fan-out when a diff warrants it.

## 3. Pipelines (state machines)

### 3.1 WAVE pipeline — building a phase of the plan (`/orion-wave <phase>`)

```
S0 INTAKE      orchestrator reads STATE.md, plan §E.13, git status; confirms baseline
     │
S1 GATE        orion-architect → gate verdict (13 questions) + risks + scope boundary
     │         ◆ APPROVAL A1: user approves scope (or DEFER / reshape)
S2 BRIEF       orion-wave-planner → .claude/orion/briefs/<phase>.md
     │
S3 RED         orion-test-author → failing tests; proves each fails for the right reason
     │
S4 GREEN       orion-implementer → minimal src change; npm test/typecheck/lint green locally
     │
S5 REVIEW      ┌ orion-invariant-reviewer ┐  parallel
     │         └ orion-security-reviewer  ┘  (+ optional ECC reviewer)
     │         BLOCK/HIGH → back to S4 (max 3 loops, then escalate to user)
S6 VERIFY      orion-gate-runner: Level A (suite, typecheck, lint, EVENT_TYPES, pack from clean
     │         tree) → then §11.2 live gate
     │         ◆ APPROVAL A2: live model use (which endpoint/key alias, est. cost)
     │         FAIL → orion-failure-analyst → route: rig fix | S3 | S4 | honest ledger entry
S7 DX          orion-dx-tester (only if the phase touches a user-facing surface)
     │
S8 RECORD      orion-scribe → wave report + §11.4 ledger + plan Part A/B + surface docs
     │
S9 RELEASE     orion-release-manager → exact staging list + message
     │         ◆ APPROVAL A3: commit   ◆ A4: push   ◆ A5: npm publish (each separate)
S10 STOP       orchestrator updates STATE.md, reports, and STOPS. Next wave only on user "go".
```

### 3.2 EVAL pipeline — measurement, never features (`/orion-eval <track>`)

```
S1 orion-architect   → is this the right question? what outcome would change the roadmap?
S2 orion-eval-scientist → protocol with PASS/FAIL criteria written BEFORE any run
     ◆ APPROVAL: model/keys/cost/runtime
S3 orion-eval-scientist → control run first (prove the rig), then the matrix
S4 orion-failure-analyst → attribute every non-pass: model · provider · runtime · tool · rig
S5 orion-scribe → report labelled with the exact configuration measured (§G.2)
S6 STOP
```

### 3.3 FIX pipeline — a defect found anywhere (`/orion-fix <symptom>`)

`orion-failure-analyst` (classify + reproduce) → if runtime defect: S3 → S4 → S5 → S6 of the wave
pipeline, scoped to the defect → scribe appends to the defect register (Plan §B.7).

### 3.4 REVIEW-ONLY (`/orion-review`) — invariant + security reviewers in parallel on the current diff.

### 3.5 DIRECTION CHECK (`/orion-architect <question>`) — architect alone; answer to user.

## 4. The handoff contract

Every specialist ends its final message with this block, exactly. The orchestrator persists it to
`.claude/orion/ledger/<YYYY-MM-DD>-<phase>-<NN>-<agent>.md` and uses it to route.

```
=== ORION HANDOFF ===
AGENT: <name>
PHASE: <P0..P12 | E3..E6 | FIX-<slug>>   STEP: <S1..S10>
STATUS: DONE | BLOCKED | NEEDS_APPROVAL | FAILED
SUMMARY: <3–6 lines, evidence-tagged>
ARTIFACTS: <files created/changed, one per line, or "none">
EVIDENCE: <commands run + key output lines, or path:line citations>
NOT PROVEN: <what this step did not establish — never empty; write "nothing claimed" if so>
RISKS: <new risks or invariant pressure, or "none">
APPROVAL NEEDED: <exact question for the user, options, and your recommendation — or "none">
NEXT: <agent that should act next and why>
=== END HANDOFF ===
```

## 5. Approval matrix — what always goes to the user

| Action | Who prepares | Rule |
|---|---|---|
| Starting a phase / changing scope | architect | always ask |
| Any live model call (hosted or local) | gate-runner / eval-scientist | ask once per gate/track, state key alias + est. tokens/cost |
| Adding/rotating keys in the vault | orchestrator | ask; never echo key values |
| New event type / contract bump | architect + invariant-reviewer | always ask |
| New dependency (even optional) | architect | always ask |
| Editing plan Part C (invariants/gate) | architect | always ask |
| `git commit` | release-manager | ask (hook also asks) |
| `git push` | release-manager | ask separately (hook also asks) |
| `npm publish` / tag / release | release-manager | ask separately (hook also asks) |
| Destructive ops (`reset --hard`, `rm -rf`, branch delete) | anyone | ask (hook also asks) |
| 3 failed review/fix loops on the same issue | orchestrator | stop and ask |

Everything else — reading, planning, writing tests, implementing inside the approved scope,
running the offline suite — proceeds autonomously.

## 6. Loop limits & escalation

- REVIEW↔GREEN: max 3 loops per issue; then the orchestrator stops and presents both sides.
- VERIFY failures: always route through `orion-failure-analyst` before any code change.
- A specialist returning `BLOCKED` twice for the same reason → ask the user.
- Never "fix" a failing gate by weakening the test or the gate. Record it in the §11.4 ledger.

## 7. Blackboard files (`.claude/orion/`)

| File | Owner | Purpose |
|---|---|---|
| `STATE.md` | orchestrator | current phase/step, baseline SHA, suite, contract, pending approvals, open ledger |
| `ledger/*.md` | orchestrator | append-only handoff log — never edited after write |
| `briefs/<phase>.md` | wave-planner | the executable brief for a phase |
| `DOCTRINE.md` | user/architect | shared rules — changes need user approval |
| `PIPELINE.md` | user/architect | this file |

Durable project records stay where they already live: reports in `research/productization/`,
ADRs in `v0/ADRs/`, the roadmap in `MASTER-HARNESS-DEVELOPMENT-PLAN.md`.
