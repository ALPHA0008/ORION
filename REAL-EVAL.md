# REAL-EVAL — Capability Measurement on Pinned Real Repositories

Objective evaluation of the agent against **real third-party source code**, at pinned commits,
verified by each repository's own test suite. No LLM judge. All behavioural metrics come from the
durable event log.

This replaces the synthetic suite as the source of **capability claims**. The synthetic suite
([EVAL.md](EVAL.md)) remains the fast deterministic regression/mechanism suite.

## Reproduce it

```bash
# Requirements: git, Node 24+, network access to github.com and registry.npmjs.org
export HARNESS_BASE_URL=http://<host>:8000/v1
export HARNESS_API_KEY=<key>
export HARNESS_MODEL=<model>

node eval/real/cli/index.mjs list                    # 22 tasks over 5 repositories
node eval/real/cli/index.mjs bracket                 # validate every task (expect 22/22 valid)
node eval/real/cli/index.mjs run --label my-baseline # run them
node eval/real/cli/index.mjs report eval/real/reports/my-baseline.json
node eval/real/cli/index.mjs compare <a.json> <b.json>
```

Useful filters: `--repository camelcase`, `--difficulty hard`, `--tasks id1,id2`, `--repeat 3`.

`run` exits 2 if no model is configured or if git/node/npm registry are unreachable. It never
silently falls back to a scripted model.

First run clones and installs (~4 min total); afterwards a bare mirror and a per-(repo,commit)
dependency install are cached, and each task provisions in ~0.3s.

## Results

| run | success | easy | medium | hard | tokens/success |
|---|---:|---:|---:|---:|---:|
| [`v0-real-baseline`](eval/real/reports/v0-real-baseline.json) | **31.8%** (7/22) | 3/4 | 4/10 | 0/8 | 46,997 |
| [`v0-real-iteration01`](eval/real/reports/v0-real-iteration01.json) | **63.6%** (14/22) | 4/4 | 8/10 | 2/8 | 69,507 |

Iteration 01 = paged `read` (`offset`/`limit`). **7 improved, 0 regressed.**

For context, the same agent scores **17/17 (100%)** on the synthetic suite — which is why that
suite cannot be used for capability claims.

## How it works

```
pinned repo + SHA → bare mirror (cached)
                  → isolated checkout
                  → node_modules linked from a per-(repo,commit) install
                  → defect injected
                  → agent runs (V0 runtime)
                  → repo's own test suite + hidden tests
                  → trajectory metrics from the event log
                  → PASS / FAIL / TIMEOUT / INFRA_FAILURE
                  → environment destroyed
```

### Every task is bracketed before it can score

| gate | procedure | must yield |
|---|---|---|
| preflight-negative | mutated repo, no fix | `FAIL` |
| oracle-positive | mutated repo + known-good solution | `PASS` |

A task failing either gate is **excluded**, never counted as an agent failure. This rejected 5 of
27 candidate tasks whose defects the repository's own suite could not observe.

### Anti-gaming

- Test files are byte-compared before and after; editing or deleting one is a **FAIL**.
- Hidden tests are written only at verification time — unreadable and unmodifiable during the run.
- The verifier never reads the agent's prose. Claimed completion with an unchanged world FAILS.

### Evaluator invariants (permanent)

`node eval/real/setup/invariants.test.mjs` — 18 assertions pinning the evaluator's own behaviour:
broken verifier → INFRA, unreachable repo → INFRA, no edits → FAIL, wrong solution → FAIL,
confident prose + wrong state → FAIL, tampered tests → FAIL, correct solution → PASS.

## Layout

```
eval/real/
├── repositories/   pinned url + SHA + install + test command
├── tasks/          schema.mjs (bracketing contract), index.mjs (22 tasks)
├── environments/   mirror/checkout/dep caching, INFRA_FAILURE boundary
├── evaluators/     verification + failure classification
├── runners/        harness-agnostic runner (V0 today)
├── setup/          bracket.mjs, invariants.test.mjs, merge.mjs
├── reports/        committed results
└── cli/            list | bracket | run | report | compare
```

## Limitations — read before quoting any number

- **Injected defects, not historical bugs.** Real bugs are subtler and more distributed.
- **Five small JavaScript libraries.** No compiled languages, services, frameworks, or monorepos.
  **Results do not generalise to large or polyglot codebases.**
- **One model**, which required a compatibility shim on essentially every response.
- **One runner.** No comparative claim against any other harness is made.
- **22 tasks, single-repeat.** Variance is unmeasured.

Not claimed: benchmark leadership, parity with any other harness, or general-purpose capability.

## Documents

- [`research/eval-real/methodology.md`](research/eval-real/methodology.md)
- [`research/eval-real/repository-selection.md`](research/eval-real/repository-selection.md)
- [`research/eval-real/baseline.md`](research/eval-real/baseline.md)
- [`research/eval-real/failure-analysis.md`](research/eval-real/failure-analysis.md)
- [`research/eval-real/capability-gap.md`](research/eval-real/capability-gap.md)
- [`research/eval-real/summary.md`](research/eval-real/summary.md)
