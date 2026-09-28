# AGENTS.md — ORION

Instructions for any coding agent working in this repository (Claude Code, opencode, Codex, …).

## What this repository is

**ORION** (`@kernlbase/orion`, CLI `orionctl`) — a durable, replayable, event-sourced agent
runtime, plus the research that produced it. Positioning: *the coding-agent harness whose account
of what happened cannot be wrong.*

| Path | What |
|---|---|
| `v0/` | the product — Node ≥22, ESM, zero required deps, no build step, published to npm |
| `v0/src/core/` | event contract, store, projections (folds), recovery, replay, lease/reaper, child runs |
| `v0/src/agent/` | worker loop, model providers + shims, tools |
| `v0/src/sandbox/` | local containment, container backend, network policy, shadow-git checkpoints |
| `v0/src/cli/` | `orionctl` verbs: run · list · status · resume · answer · explain · replay · fork · rerun · reap · doctor |
| `v0/tests/` | `run-all.mjs` fail-closed runner, ~50 suites, `shipped/` wiring gates, `real-model/` (manual) |
| `v0/ADRs/` | architecture decision records, each with the evidence that forced it |
| `eval/`, `v0/eval/` | benchmark/evaluation harnesses — never imported by `v0/src` |
| `research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md` | **the single authoritative roadmap** |
| `research/productization/` | wave prompts, wave reports, contracts (event, tool, recovery, security, provider, CLI) |
| `PROJECT-JOURNEY.md`, `V0-READINESS.md` | how the project got here; current readiness |
| `conversations/` | raw chat transcripts — **read-only, contains secrets, never commit, never copy from** |
| `research/repos/` | pinned clones of audited systems — read-only |

## Commands (run from `v0/`)

```bash
npm test               # node tests/run-all.mjs — full fail-closed suite
npm run typecheck      # tsc --noEmit
npm run lint           # node tests/lint.mjs
node src/cli/index.mjs <verb>   # run the CLI from source (not the shipped path — see below)
```

Windows: the sandbox shells out to bare `bash`; Git Bash's `bin/` must precede WSL's
`System32\bash.exe` on PATH, and `node` must be on PATH for the `verify` tool.

## Rules every agent follows

1. **The master plan is the roadmap.** Work only on the phase the user approved. Current sequence:
   P0 baseline integrity → P1 provider truth → P2 isolation debt → P3 provenance → P4 E5
   measurement → evidence-selected P5–P9 → P10 → P11 → P12 (Plan §E.13).
2. **Ten invariants (Plan §C.4) must never be weakened** — trajectory is authoritative; replay at
   zero model cost; per-invocation recovery; fencing; truthful completion; provenance;
   explainability; resource-aware recovery; additive contract; shipped-path reachability.
3. **Everything lands as events + a fold.** No hidden mutable state, no history rewriting, no
   read-time transforms that affect execution.
4. **Event contract is additive only** (`v0/src/core/event/index.mjs`, currently v6/49).
5. **Feature-entry gate (Plan §C.6):** no capability becomes work until its 13 questions are
   answered. Derive from user problem → evidence → architecture → benchmark → implementation.
6. **Tests:** write the failing test first; prove it fails without the change; assert effects;
   add a `tests/shipped/` assertion for anything a user can reach.
7. **A passing suite is not proof.** Major features need the §11.2 live gate: installed build,
   real model, ground truth on disk, SIGKILL/resume, replay with zero model calls, fork.
8. **Distrust the instrument first.** Classify any failure as rig / provider / runtime / tool /
   model before changing code.
9. **Reports state what is NOT proven** (§11.4) and tag claims FACT / MEASURED / INFERENCE /
   RECOMMENDATION / UNKNOWN.
10. **Git hygiene:** stage explicit paths only (never `git add -A`/`.`); never commit
    `v0/tests/results-*.json`, `run.db*`, `wg-fixtures/`, `wg-homes/`, `archify-out/`,
    `conversations/`, `v0/eval/results/`, `*.tgz`. Commit, push, and publish only with explicit
    user approval.
11. **Secrets:** never write a key into a file, event, log, report or command argument. Keys live
    in the user's vault (`~/.orion-keys/keys.json`) or env vars; refer to them by alias.
12. **Zero required runtime dependencies**; no build step; Windows is first-class.
13. **Stop at the phase boundary.** Deliver, report, stop. Never start the next phase unasked.

## The agent team

This repo ships a Claude Code agent team in `.claude/` — an orchestrator (the main session, see
`CLAUDE.md`) routing twelve specialists through gated pipelines. Operating manual:
`.claude/orion/PIPELINE.md`. Shared rules: `.claude/orion/DOCTRINE.md`. Live position:
`.claude/orion/STATE.md`. Agents in other tools should read those three files and honour the same
handoff contract (PIPELINE §4) when contributing to the same phase.
