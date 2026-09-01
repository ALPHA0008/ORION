# Corpus Diversity Check (§10)

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
17 accepted tasks. Run before freezing, because a corpus too narrow to support attribution is a
measurement result in its own right, not a formality.

## Distribution

| dimension | distribution |
|---|---|
| repository | `pytest` **10** · `pylint` 4 · `flask` 2 · `requests` 1 |
| language | Python **17 / 17** |
| test framework | pytest **17 / 17** |
| interpreter | 3.9 × 16 · 3.8 × 1 |
| gold-patch files touched | **1 file in every single task** |
| declared PASS_TO_PASS | min 6 · median 54 · max 129 |

## Per task

| task | py | gold-patch target | area |
|---|---|---|---|
| `pallets__flask-4045` | 3.9 | `src/flask/blueprints.py` | validation |
| `pallets__flask-5063` | 3.9 | `src/flask/cli.py` | CLI output |
| `psf__requests-3362` | 3.9 | `requests/utils.py` | encoding |
| `pylint-dev__pylint-5859` | 3.9 | `pylint/checkers/misc.py` | checker logic |
| `pylint-dev__pylint-6506` | 3.9 | `pylint/config/config_initialization.py` | config / error handling |
| `pylint-dev__pylint-7228` | 3.9 | `pylint/config/argument.py` | argument parsing |
| `pylint-dev__pylint-7993` | 3.9 | `pylint/reporters/text.py` | output formatting |
| `pytest-dev__pytest-11143` | 3.9 | `src/_pytest/assertion/rewrite.py` | AST rewriting |
| `pytest-dev__pytest-11148` | 3.9 | `src/_pytest/pathlib.py` | module import |
| `pytest-dev__pytest-6116` | 3.9 | `src/_pytest/main.py` | CLI shortcut |
| `pytest-dev__pytest-7220` | 3.9 | `src/_pytest/nodes.py` | path resolution |
| `pytest-dev__pytest-7373` | 3.9 | `src/_pytest/mark/evaluate.py` | expression caching |
| `pytest-dev__pytest-7432` | 3.9 | `src/_pytest/skipping.py` | skip reporting |
| `pytest-dev__pytest-7490` | 3.9 | `src/_pytest/skipping.py` | dynamic xfail |
| `pytest-dev__pytest-8365` | 3.9 | `src/_pytest/tmpdir.py` | username sanitising |
| `pytest-dev__pytest-8906` | 3.8 | `src/_pytest/python.py` | skip API |
| `pytest-dev__pytest-9359` | 3.9 | `src/_pytest/_code/source.py` | statement extraction |

## Concentration risks — stated plainly

**1. `pytest` is 59% of the corpus (10/17).** This is the most serious limitation. A failure
mechanism observed mostly on `pytest` tasks may be a property of *that codebase's idioms* rather
than of the agent. Any bottleneck claim will therefore be checked for whether it survives outside
`pytest`, and one that does not will be labelled accordingly rather than generalised.

**2. Two tasks share a file** (`skipping.py`: 7432, 7490). Near-duplicate navigation, so they are
weaker as independent evidence than the count suggests.

**3. Every gold patch touches exactly one file.** Not a filter we applied — it is what SWE-bench
**Lite** is: the Lite subset is *selected* for single-file, self-contained fixes. The consequence is
sharp and must not be forgotten when reading results:

> **This corpus cannot measure multi-file refactoring, cross-module reasoning, or large-scale
> change.** A good score here says nothing about those abilities.

What it *can* measure is the loop that precedes the edit — locating the right file in a large
unfamiliar repository, reading enough context, making a correct minimal change, and verifying it.

**4. One language, one test framework.** No claim about non-Python work follows from any of this.

**5. The excluded repositories were the harder ones.** `django`, `sympy`, `matplotlib` and the
scientific stack were filtered out for buildability (see `corpus-selection.md`). The difficulty
range is truncated at the top, so a **success** rate here does not transfer upward, while a
**failure** here probably does.

## Verdict on interpretability

Sufficient to proceed to a baseline, with the `pytest` concentration recorded as a live threat to
attribution rather than a footnote. If the failure analysis ends up resting mainly on `pytest`
tasks, the correct outcome is **`CORPUS_NEEDS_MORE_TASKS`**, and that will be reported rather than
avoided.
