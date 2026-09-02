# Repository Test-Invocation Contract

**Why this exists.** Admitting a single new repository family (Django) cost **five consecutive
harness defects**, every one of which presented as `BASELINE_NOT_REPRODUCIBLE` — "the maintainer's
own fix does not work." None was a task defect. The recurring cause was one bad assumption:

> A real repository can be evaluated by assuming a universal test command.

It cannot. This file makes the per-repository assumptions **explicit and declared** instead of
rediscovered.

**Scope boundary.** This is an **evaluation-layer** contract. It lives in `eval/`, is not a general
test-runner abstraction, and defines only the minimum the current and next corpora need.
**No `v0/src` change** was made or is implied.

## The contract

Each entry declares what the evaluator must know before it can trust any verdict from that
repository.

| field | why it exists |
|---|---|
| repository | key |
| runner | the executable that runs tests |
| invocation | exact command shape |
| id syntax | how a test is named — **the single most common source of false rejections** |
| granularity | can a single test be addressed, or must a class/module run? |
| verdict channel | stdout, stderr, or exit code |
| dependency policy | is the era date-pin valid for this project? |
| environment | interpreter, settings module, working directory |
| isolation | what must be reset between runs |

## Declared contracts

### `pytest-dev/pytest`, `pylint-dev/pylint`, `pallets/flask`, `psf/requests`, `sphinx-doc/sphinx`

| field | value |
|---|---|
| runner | `python -m pytest` |
| invocation | `-x -q -p no:cacheprovider <node_id>` |
| id syntax | pytest node id — `path/to/test.py::TestClass::test_name` |
| granularity | single test addressable |
| verdict channel | **exit code** (0 = pass) |
| dependency policy | era date pin **required** (`--exclude-newer <created_at>`) |
| environment | per-task venv, `PYTHONDONTWRITEBYTECODE=1`, cwd = repo root |
| isolation | one venv + one worktree per task |

Caveats already measured: an id whose **parameter** contains `::` is unaddressable on the command
line even though `--collect-only` lists it; upstream ids truncated at a comma are unrunnable. Both
are excluded and **counted**, never silently dropped.

### `django/django`

| field | value |
|---|---|
| runner | `tests/runtests.py` — **not pytest** |
| invocation | `python runtests.py --settings=test_sqlite --parallel=1 <dotted.Class>` |
| id syntax | unittest print form — **`test_name (dotted.path.ClassName)`**, class in *parentheses* |
| granularity | **CLASS**, not method — see below |
| verdict channel | **exit code**; `OK`/`FAILED` go to **stderr**, stdout carries only a banner |
| dependency policy | **NO date pin** — see below |
| environment | cwd = `<repo>/tests`, settings module `test_sqlite` |
| isolation | one venv + one worktree per task |

Three of these fields were each independently responsible for rejecting every Django task:

1. **Runner.** Feeding a Django id to pytest yields `file or directory not found`.
2. **Id syntax.** Splitting `test_x (mail.tests.MailTests)` on `.` produces
   `test_x (mail`, which `runtests.py` tries to import as a module.
3. **Verdict channel.** Django writes `OK`/`FAILED` to stderr; a stdout-biased tail contains only
   `Testing against Django installed in ...` and never the verdict.

**Granularity.** `mail.tests.MailTests.test_non_ascii_dns_non_unicode_email` calls
`delattr(DNS_NAME, '_fqdn')` and depends on a sibling test having cached that attribute. Run alone
it raises `AttributeError: _fqdn` **even with the gold patch applied**. Measured at class
granularity: clean → `FAILED (errors=1)`, gold → `OK` across 45 tests. Running the method alone
measures test isolation; running the class measures the fix.

**Dependency policy.** The era date pin is correct for flask/pylint/pytest and **wrong** for Django:
`asgiref` has a yank-hole, and pinning further makes Django's own version metadata unsatisfiable
(`only django==4.1.dev... is available and you require django`). Django is pure Python with a
near-empty runtime dependency set, so the pin protects against drift that cannot occur, while
costing reproducibility outright.

## Adoption checklist for the next repository

Before any rejection from a new repository counts as evidence about a task:

1. Identify the runner the project actually uses.
2. Determine the id syntax **as the dataset stores it**, not as you expect it.
3. Determine the verdict channel — exit code, stdout, or stderr.
4. Determine whether single tests are addressable, or a class/module is required.
5. Decide whether the era dependency pin helps or breaks the project.
6. **Bracket one task by hand** — clean → FAIL, gold → PASS — before trusting the automated verdict.

Step 6 is the load-bearing one. Only the manual bracket of `django__django-11532` (45 tests, clean
FAILED / gold OK) established that the tasks were sound while five successive harness defects were
still producing confident, wrong rejections.
