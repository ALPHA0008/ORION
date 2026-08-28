# Real-Repository Benchmark Methodology

How the real-repository numbers are produced, and exactly what they are and are not evidence for.

## Pipeline

```
repository (pinned URL + SHA)
      ↓  bare mirror, cached once
isolated checkout at exact commit
      ↓  node_modules attached by link from a per-(repo,commit) install
defect injected (mutate)
      ↓
agent runs (V0 runtime, frozen)
      ↓
objective verification (repo's own suite + optional hidden tests)
      ↓
trajectory metrics from the event log
      ↓
PASS / FAIL / TIMEOUT / INFRA_FAILURE
      ↓
environment destroyed
```

## Injected defects, not historical commits

**This is the most important limitation, stated up front.** Tasks are built by injecting a defect
into a pinned commit of a real repository, then requiring that repository's own test suite to pass
again. They are **not** SWE-bench-style historical bug/PR pairs.

Why: historical tasks need per-project issue↔PR linkage and per-commit environment resolution
(the dependency set that existed at that commit, for that language toolchain). That is not
reliably reproducible in this environment.

What this buys and costs:

- **Buys:** the agent reads and reasons about genuine third-party source it has never seen, in a
  real dependency tree, verified by a real test suite. Far stronger than fabricated fixtures.
- **Costs:** defects are single-point and adversarially chosen by us, not naturally occurring.
  Real bugs are often subtler, more distributed, and accompanied by messier context.

Capability claims must carry this caveat. Historical tasks remain the next credibility step.

## Bracketing — every task is validated before it can score

Each task must pass two gates, run against the real environment:

| gate | procedure | must yield |
|---|---|---|
| preflight-negative | mutated repo, no fix | `FAIL` |
| oracle-positive | mutated repo + known-good `solution()` | `PASS` |

A task failing either gate is **excluded**, never counted as an agent failure. Without both, a
"failure" could equally mean the task is impossible or the verifier is broken.

**This gate did real work.** Of 27 candidate tasks written, **5 were rejected**: the defect landed
but the repository's own suite could not observe it (three in `ansi-styles`, which ships only 10
tests, plus one each in `slugify` and `p-limit`). Had they been scored, the agent would have been
blamed for tasks that were unsolvable through the available oracle. The final set is **22/22
valid**.

## Verification

Deterministic only; no LLM judge. The evaluator never reads the agent's prose — an agent that
says "I fixed it" and changed nothing must FAIL, so world state is always what is checked.

Methods: `test_command`, `file_state`, `repo_invariant`, `hidden_test`, `composite`.

## Anti-gaming

The agent's sandbox is rooted at the checkout, so it *can* edit the repository's tests. Before
verification, every test file is compared byte-for-byte against a snapshot taken after mutation
and before the run. Weakening or deleting a test is a **FAIL**, not a pass.

Hidden tests (`isnum-hidden-contract`) are written into the tree **only at verification time**, so
they cannot be read, targeted, or edited during the run. This catches solutions that satisfy the
visible suite while violating the stated contract — for example a lazy `Boolean()` coercion that
accepts `{}` and `true`.

## Evaluator invariants (permanent tests)

`eval/real/setup/invariants.test.mjs` — **18 assertions**, kept permanently because the evaluator
is part of the product's credibility:

| situation | required outcome | verified |
|---|---|---|
| broken verifier (throws) | `INFRA_FAILURE` | ✓ |
| unknown verification method | `INFRA_FAILURE` | ✓ |
| unreachable repository | `InfraFailure` raised | ✓ |
| agent changed nothing | `FAIL` (`no_edits_made`) | ✓ |
| wrong solution | `FAIL` | ✓ |
| successful tool call, wrong world state | `FAIL` | ✓ |
| confident final prose, wrong world state | `FAIL` | ✓ |
| agent rewrote a test file | `FAIL` (anti-gaming) | ✓ |
| agent deleted a test file | `FAIL` (anti-gaming) | ✓ |
| correct solution | `PASS` | ✓ |
| hidden test absent during run, enforced after | both | ✓ |

## INFRA_FAILURE boundary

Excluded from the capability score: repository unreachable, dependency install failure, missing
toolchain, verifier unable to launch, unrelated network failure. An agent is never blamed for npm
being down.

A crash inside the **runtime** is deliberately *not* INFRA — it surfaces as `runtime_failure` so
harness defects cannot hide as environment noise.

## Environment isolation and performance

Fresh checkout per task; environment destroyed afterwards. Two caches make this affordable:

- a **bare mirror** per repository (one network clone, reused by every task);
- one **dependency install** per (repo, commit), attached to each checkout by directory
  junction/symlink rather than copied.

The link matters: `camelcase`'s tree is 15,325 files / 124 MB, and copying it made a single
bracketing pass take 402s. Linking took provisioning from **13.2s → 0.3s**.

`destroy()` unlinks the junction *before* the recursive remove — verified by counting shared-cache
entries before and after (145 → 145), because a recursive delete through the link would have
destroyed the cache for every other task.

## Test runner vs linter

Four repos declare `"test": "xo && ava"`. `xo` is a linter; running it would fail a task for
unrelated style opinions. Tasks invoke `npx ava` / `npx mocha` directly. Deliberate, documented
deviation.

## Known limitations

- **Injected, not historical, defects** (above).
- **Five small JavaScript libraries.** No compiled languages, services, frameworks, or monorepos.
  Results do not generalise to large or polyglot codebases.
- **One model** (`gemma4-31b` via vLLM), which required a compatibility shim on essentially every
  response. Harness behaviour and model behaviour are not separated.
- **One runner.** No comparative claim against any other harness is made (section 20).
- **22 tasks, mostly single-repeat.** Enough to locate a dominant bottleneck; not enough for
  confident per-category rates or small effects.
- **Difficulty labels are hypotheses**, checked in [baseline.md](baseline.md).
