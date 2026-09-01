# Corpus Methodology — How a Task Earns Its Place

Adoption is not acceptance. A SWE-bench instance is a *claim* that a task is real and verifiable;
this stage tests that claim **on this machine** and discards it when it fails. §6's bracketing
requirement is the whole of the method.

## The bracket

Every candidate runs the full sequence. Failing any step is a rejection with a recorded reason.

| # | step | what it proves | failure means |
|---|---|---|---|
| 1 | `base_commit` reachable in the public repo | the task's history still exists | task is unreproducible |
| 2 | environment installs | the tree is buildable here | environment mismatch |
| 3 | `test_patch` applies | the oracle can be installed | tree/patch mismatch |
| 4 | **preflight-negative**: F2P test **FAILS** | the task is genuinely *unsatisfied* at start | task is already solved — worthless |
| 5 | **oracle-positive**: F2P test **PASSES** after `gold_patch` | a known-good solution really satisfies the verifier | verifier is wrong, or env is wrong |

Steps 4 and 5 are the bracket the brief demands: *clean repo → unsatisfied; known-good solution →
verifier passes*. A task that cannot demonstrate **both** is excluded. It is never patched into
working (§7).

## Environment: the part that had to be built

Docker is unavailable here (daemon returns 500 on `_ping`), so the official per-instance images
cannot be used. The essential property of those images is not containment — it is an
**era-appropriate interpreter**. That property was reproduced with `uv`, which provisions arbitrary
CPython versions without a container.

This mattered more than anything else in the stage. On the machine's default Python 3.14:

```
accepted 1 / 32
```

On Python 3.9, with no change to any task:

```
(see accepted-tasks.md / rejected-tasks.md)
```

The difference is entirely stdlib attrition — `imp`, `cgi`, and `ast.Str` were removed in 3.12–3.13
and these repositories predate that. **Thirty of the thirty-two initial rejections were a property
of this machine, not of the tasks.**

### Dependency era

The interpreter was necessary but not sufficient. The second constraint is **dependency drift**:
flask 2.0 imports fine on Python 3.9 and still fails against today's Werkzeug, because Werkzeug
removed `url_quote`. Pinning by hand would mean encoding our own guesses about each repository into
the corpus.

The general rule used instead: **resolve every dependency as it existed on the day the fix was
merged.** SWE-bench ships `created_at` per instance; `uv pip install --exclude-newer <created_at>`
reproduces that dependency universe exactly. flask 4045 resolves to Werkzeug 2.0.0 / Jinja2 3.0.0 —
era-correct, derived entirely from adopted metadata, with no pin table to maintain or defend.

One deliberate exception: `setuptools` and `wheel` are installed **current**, outside the date pin.
A 2021 setuptools predates PEP 660 and cannot perform an editable install at all
(`'_BuildMetaLegacyBackend' object has no attribute 'build_editable'`). The build backend only has
to build the tree; the pin governs what the tests actually import.

### Isolation

One virtualenv **per task**, discarded on rejection. A shared venv was tried first and was wrong: a
dependency installed for one task stayed installed, auto-loaded as a pytest plugin into the next,
and was refused by that task's older pytest (`addini` assertion). Two valid tasks were rejected
before the cause was found. Per-task environments are what Docker provides and what correctness
requires.

## Four harness defects that masqueraded as task defects

Recorded in full because the brief is explicit that **infrastructure failures must not be read as
agent or task failures** — and because each one, left in, would have silently shrunk the corpus.

| symptom | apparent cause | actual cause | fix |
|---|---|---|---|
| `metadata-generation-failed` | task unbuildable | `--work-tree` checkout has no `.git`; `setuptools_scm` needs it | real `git clone --local` + `checkout --detach` |
| `patch does not apply` | task/tree mismatch | shared patch filename let one task's diff reach the next tree | per-task `.__<name>.diff` |
| 63 files modified on a *fresh* clone | corrupt checkout | `core.autocrlf` set **after** checkout, so the tree was written CRLF against an LF patch | configure **before** checkout |
| `AssertionError` in `addini` | gold patch does not fix the bug | plugin leakage from a shared venv | one venv per task |
| `error: unrecognized arguments` | task incompatible with its own tests | **our** `--no-header` flag postdates pytest 6.0; the repos are pytest 5.x | drop the flag |
| `ImportError: url_quote` | task unbuildable | today's Werkzeug against 2021 flask | `--exclude-newer <created_at>` |
| `addini` assertion, every repo | gold patch does not fix the bug | `atomicwrites` had no unyanked pre-2021 release, so the resolver **silently backtracked to pytest 3.5.1** | lift the date pin for that one package |
| `No module named '_pytest._version'` | gold patch does not fix the bug | our build-requires regex stopped at the `]` inside `setuptools-scm[toml]`, so setuptools_scm was never installed and pytest built as version `0.0.0` | anchor the pattern to the list's real terminator |
| `No module named 'wheel.wheelfile'` | task unbuildable | the fallback to current build tools did not pass `--upgrade`, leaving a modern setuptools calling a 2014 `wheel` | force the upgrade |

### The pattern in these defects

Seven of the nine wore the costume of a task defect, and five specifically wore the *strongest*
available costume — `oracle-negative`, "the maintainer's own fix does not fix the bug". Not one of
them was. The `atomicwrites` hole is the most instructive: nothing errored, nothing warned, the
install reported success, and the only symptom was that a 2021 project was quietly running a 2018
test runner.

An automated corpus builder that trusted its own verdicts would have reported a corpus of one or two
tasks and a confident finding about task quality. The verdicts were only worth anything because each
one was treated as a hypothesis and pushed on until it either survived or explained itself.

Every one of these produced a plausible, wrong story about the task. The `--no-header` defect is the
sharpest: nine tasks were rejected as *oracle-negative* — the strongest possible verdict, "the
maintainer's own fix does not fix the bug" — when the real cause was a flag **this script** passed
that the era's pytest did not recognise. A rejection is a hypothesis, not a result. Treating it as a
result would have thrown away a third of the corpus and produced a confident, wrong finding.

## What the agent is given, and what it is not

**Given**: the repository at `base_commit`, and the original issue text.
**Withheld**: `gold_patch`, `test_patch`, `fail_to_pass`, `pass_to_pass`.

## Verification at run time

After the agent stops, the verifier — not the agent — decides:

1. **Test files are restored from git and `test_patch` is re-applied.** The agent's edits to test
   files are discarded before judging. Without this, deleting a failing test would score as a pass.
2. `FAIL_TO_PASS` must now pass.
3. `PASS_TO_PASS` must still pass — the fix must not be achieved by breaking something else.

Both conditions are process exit statuses. No LLM judge, at any point (§11).

## Repeats

One repeat per task (§20). The stage's question is *what does the existing agent do in a harder
world*, not *what is its variance*. Variance measurement is deferred until there is a signal worth
measuring the variance of.
