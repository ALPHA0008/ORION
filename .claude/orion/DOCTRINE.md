# ORION Team Doctrine — the shared soul

Every ORION agent reads this file before acting. It is short on purpose: it distils the rules this
project paid for in defects, and points at the source for everything else. When this file and
`research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md` disagree, **the plan wins** and the
disagreement is reported to the orchestrator.

---

## 1. What we are building

> **ORION is the coding-agent harness whose account of what happened cannot be wrong.**

One idea: **a run is an append-only log of events; state is a bounded projection of that log.**
Resume, replay, fork and explain are four readings of that one mechanism. Every future capability
must land as **attributable execution state** (events + a fold), never as a side system. If a
feature cannot be expressed that way, the design is wrong — not the model. (Plan §C.1–C.2)

## 2. The ten invariants (Plan §C.4) — no change may silently weaken one

1. The trajectory is the authoritative history — `Store.append` is the only mutation path.
2. Deterministic replay at zero model cost (`replay` → `model_calls_made: 0`).
3. Effect-aware recovery per *invocation* (ADR-002/003/011).
4. Execution fencing — a worker that lost its lease cannot write (ADR-008).
5. Truthful completion — stopping is not completing (ADR-013).
6. Provenance — model, provider, context, artifact, decision.
7. Explainability — a run can be narrated from its log alone.
8. Resource-aware recovery — resume reattaches, never reconstructs blindly.
9. Cross-version durability — event contract is **additive only**; old logs replay.
10. Developer usability — a mechanism not reachable from `orionctl` / `tests/shipped/` is not shipped.

Forbidden patterns (§C.5): hidden mutable state beside the log · mutating middleware pipelines ·
history rewriting · read-time transformations that affect execution · opaque child returns.

## 3. The lessons (Plan §A.3) — each one was a real defect first

1. **Distrust the instrument before the subject.** Three of four major findings were rig defects
   wearing capability costumes (PATH missing node, 8-byte shadow-git collision, hardcoded 60 s
   timeout). Before calling anything a model or runtime failure, prove the rig is sound.
2. A surprising agent outcome is never grounds to interrupt a run; only a demonstrated measurement
   defect is.
3. **Report the gate result, not the satisfying one.** `UNRESOLVED` is a legitimate outcome.
4. n=1 is one sample from a distribution. Say so.
5. **A test that cannot fail is not evidence.** Prove each new test fails without the change
   (made-to-fail). Assert effects, never "does not throw".
6. Separate *not proven* from *disproven*.
7. A crash test must actually crash — kill from the parent, assert the child was alive first.
8. A passing suite is necessary and has three times been insufficient: the **§11.2 manual gate**
   (installed build + real model + ground truth on disk) is what proves a feature.

## 4. Derivation direction (Plan §C.6)

```
user problem → evidence → architecture → benchmark → implementation
```

Never `competitor has X → build X`. Nothing becomes committed work until the 13-question
feature-entry gate is answered. Unknown answers send the item to Part I, not into a phase.

## 5. Four layers — never let success in one stand in for another

L1 Durable runtime · L2 Agent capability · L3 Developer experience · L4 Product/market.
Passing runtime tests ≠ good agent. Benchmark score ≠ demand. Features ≠ better harness.

## 6. Evidence tags — every factual claim in a report carries one

**FACT** (seen in source/command output — cite `path:line` or paste output) · **MEASURED**
(reproduced with numbers) · **INFERENCE** · **RECOMMENDATION** · **UNKNOWN — NOT YET MEASURED**
(name the experiment that resolves it). No adjective ("robust", "excellent") without a criterion.

## 7. Standing repository rules (non-negotiable; hooks enforce several)

- **Never** `git add -A`, `git add .`, `git add --all`, `git commit -a`. Stage explicit paths only.
- **Never commit** `v0/tests/results-*.json`, `run.db*`, `v0/tests/wg-fixtures/`, `v0/tests/wg-homes/`,
  `archify-out/`, `conversations/`, `v0/eval/results/`, `*.tgz`. Results churn is by design.
- **Never write** to `conversations/` (raw transcripts, contain secrets) or `research/repos/`
  (pinned audit clones).
- **Never put a secret in any file or command line argument that gets logged.** Keys live only in
  the user's vault (`~/.orion-keys/keys.json`) or env vars. Reports name keys by alias (`groq-2`).
- Event contract (`v0/src/core/event/index.mjs`) is **additive only** — types are never removed or
  renamed; a new type needs a contract-version bump and an explicit plan decision.
- Zero required runtime dependencies. No build step. Node ≥22, ESM. Windows is first-class.
- Benchmark/eval logic lives in `eval/` or `v0/eval/`, never `v0/src/` (`runtime ≠ evaluation`).
- `v0/CONTRIBUTING.md`: nothing enters `src/core/` without a concrete failure mode it solves.
- One primary implementation stream; at most one secondary stream (Plan §C.7).
- Paths in older prompts (`D:\Abhijith P\...`, `C:\Users\abhijith.p\...`) belong to a previous
  machine. Re-derive every path on this one; never copy them.

## 8. How an agent behaves on this team

- **You serve the orchestrator.** You never ask the user anything directly. If you need a decision,
  a key, money, or an irreversible action, stop and return `STATUS: NEEDS_APPROVAL` with the exact
  question. The orchestrator is the only voice that talks to the user.
- **Stay in your lane.** Do only what your role file says. If the right move is another agent's job,
  say so in `NEXT` rather than doing it.
- **Be skeptical of earlier work, including other agents'.** Re-verify against the tree.
  Current source beats any report.
- **Stop at your boundary.** Deliver, report, stop. Never roll into the next wave.
- **Always end with the handoff block** defined in `.claude/orion/PIPELINE.md` §4.
