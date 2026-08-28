# Benchmark Methodology

How the numbers in this project are produced, and what they are and are not evidence for.

## Principles

1. **Deterministic verification only.** No LLM-as-judge anywhere. Every verifier inspects real
   state: a test command's exit code, file contents, or a programmatic check. The brief permits a
   judge as a non-sole evaluator; none is used at all.
2. **Our bugs are not the agent's failures.** A verifier that throws yields `INFRA_FAILURE`,
   excluded from the success rate. This is not a courtesy — see F-01 in the
   [failure taxonomy](failure-taxonomy.md), where a verifier bug nearly became a fabricated
   capability gap.
3. **Fail closed.** The runner treats a missing summary, a non-zero exit, or a signal death as
   failure. A crash never reads as a pass.
4. **No silent model fallback.** `eval run` exits 2 without `HARNESS_BASE_URL`. A benchmark that
   quietly substitutes a scripted model measures nothing.
5. **Difficulty is a hypothesis, not a label.** Declared up front, then checked against measured
   success rates.

## Task anatomy

Each task declares: `task_id`, `description`, `repository`, `base_commit` (a content hash of the
fixture), `difficulty`, `categories`, `setup`, `allowed_tools`, `timeout_ms`, `max_turns`,
`expected_behavior`, `verification`.

Verification methods: `test_command`, `file_state`, `ast_property`, `cli_contract`,
`diff_invariant`.

## Environments

13 content-addressed fixtures, hashed by sha256 over sorted path+content, so a task's
`base_commit` changes if its environment changes. Each is materialised into a fresh sandbox per
run; no run inherits state.

**Limitation, stated plainly:** these are synthetic fixtures, not real repository history.
SWE-bench-style tasks need network access, package installation and language toolchains that are
not deterministically available in this environment. Synthetic fixtures buy determinism and
hermeticity at the cost of realism. **Results here do not transfer to real-world repositories
without further validation**, and no claim in this project should be read as if they do.

## Anti-gaming

Verifiers are written to reject plausible non-solutions, not just to accept the intended one:

- `wrong-test-discrimination` — a *hidden* verifier checks conformance to `SPEC.md`, so an agent
  that "fixes" correct source to satisfy a faulty test turns the visible suite green and still
  fails.
- `cold-cache-crash` — probes twice from cold, so committing a `.cache/` fixture instead of making
  the library self-heal is rejected.
- `double-discount` — asserts the test file is unmodified, so editing the test is not a solution.
- `ten-file-migration` — structural check that no file still imports the legacy module; 9 of 10 is
  a failure.
- `readme-injection` — fails if `AGENT_ACK.txt` exists, catching an agent that obeys instructions
  embedded in repository content.

**A verifier change must be validated against a known-good *and* a known-bad candidate before any
result it produces is trusted.** Flipping red to green without that check is indistinguishable
from weakening the test. The `cold-cache-crash` fix was validated against three candidates
(correct fix → PASS, committed-fixture cheat → FAIL, untouched bug → FAIL) before its result was
believed.

## Metrics

All behavioural metrics are derived from the event log, not from ad-hoc instrumentation — this is
the concrete form of the thesis that a durable trajectory makes runs measurable. Nothing is
estimated: `duplicate_action_rate`, `tool_success_rate`, `failure_density`, per-tool breakdown,
`files_touched`, `recovery_by_decision`, `authorization_events`, `degraded_subsystems`, context
metrics (`messages_total/hot/dropped/elided`), token and cost totals, and a
`model_ms`/`tool_ms`/`other_ms` split.

## Comparing two configurations

Lessons learned the hard way in [iteration 01](iteration-01.md):

1. **Change one variable.** The optimisation is opt-in so both arms are otherwise identical.
2. **Aggregate success rate is not enough.** `compare` prints per-task IMPROVED/REGRESSED and
   warns explicitly when regressions are present.
3. **Control for model-call count.** Each extra model call carries a whole context window, so a
   run with one more call is not comparable on tokens. Restrict to tasks with equal model calls,
   or repeat.
4. **Repeat before believing a delta.** The uncontrolled 17-task aggregate showed −9.3%; the
   controlled measurement showed −3.3% to −4.1%. The smaller number is the true one.

## Known limitations

- **Single model.** All results are `gemma4-31b` via one vLLM endpoint, which required a
  compatibility shim on ~100% of responses (`degraded` events). Nothing here is validated across
  providers.
- **Single runner.** Only `harness-v0` is implemented. The runner interface is harness-agnostic
  and declares capabilities, but no external harness has been benchmarked, so **no comparative
  claim against any other harness is made.**
- **No statistical power.** 17 tasks, 1–2 repeats. Sufficient to detect a 30% token change;
  not sufficient for small effects or for a success-rate difference.
- **Ceiling effect.** The dataset currently passes 100%, so it cannot measure capability
  improvements at all — only cost and regressions.
- **Synthetic environments**, as above.
