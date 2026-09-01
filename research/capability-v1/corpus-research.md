# Corpus Research — Adopt Before Building (Rule 1)

Investigated before authoring anything. The brief's rule is explicit: *do not start by building 30
tasks manually*. What follows is what was examined, what was adopted, and what was rejected **with
the reason**, so the choice can be audited rather than trusted.

## Candidates investigated

### 1. SWE-bench / SWE-bench Lite — **ADOPTED**

- **What it is**: 2 294 (full) / 300 (Lite) task instances mined from real merged pull requests in
  12 mature Python repositories. Each instance carries the repository, the exact `base_commit`, the
  original issue text as `problem_statement`, the maintainer's real fix as `patch`, the real test
  diff as `test_patch`, and two oracles: `FAIL_TO_PASS` and `PASS_TO_PASS`.
- **Why it fits every requirement in §3**:
  | requirement | how SWE-bench satisfies it |
  |---|---|
  | real SWE problems | mined from merged PRs, not authored for an eval |
  | real repositories | flask, requests, pytest, pylint, django, sympy, … |
  | independently verifiable | `FAIL_TO_PASS` / `PASS_TO_PASS` are executable test node ids |
  | historically grounded | every instance is a dated commit with a real issue |
  | materially harder | multi-file, multi-thousand-file repos vs. our 5 tiny JS packages |
  | deterministic, no LLM judge | verification is `pytest` exit status |
- **Licence**: CC-BY-4.0 on the dataset; the repositories carry their own OSS licences (BSD-3 for
  flask/pytest, Apache-2.0 for requests, GPL-2.0 for pylint). Task *metadata* is redistributable;
  we redistribute none of the repository source — we clone it at run time.
- **Access without the 400 GB image set**: the HuggingFace datasets-server REST endpoint returns
  rows as JSON with no auth and no `datasets` install. This is what `fetch-corpus.mjs` uses.

### 2. SWE-Gym / SWE-bench-extra / nerfstudio-style issue mining — **REJECTED**

Larger and more recent, but the instances are **not bracketed**: they ship an issue and a repo
without a verified fail-to-pass oracle for every row. Adopting them would mean building the
verification layer ourselves, which is precisely the expensive part. SWE-bench's value here is not
the issues — it is the **oracles**.

### 3. Defects4J — **REJECTED (language)**

The best-validated program-repair corpus in existence: 835 real, isolated, reproducible bugs with
triggering tests. Rejected only because it is **Java**, requiring a JDK toolchain and a Maven/Gradle
cache this environment does not have. Recorded as the strongest candidate should the corpus ever
need a second language.

### 4. QuixBugs / ManyBugs / BugsInPy — **REJECTED (too easy / wrong shape)**

QuixBugs is 40 single-function, single-line-fix programs — *easier* than the JS corpus it would
replace, which inverts the goal. ManyBugs is C with heavy build requirements. BugsInPy is closer in
spirit but its reproduction harness is itself Docker-bound, giving no advantage over SWE-bench while
being far less used as a reference point.

### 5. Hand-authoring 30 tasks — **REJECTED (Rule 2, and a bias risk)**

Explicitly forbidden as a starting point, and rightly: tasks authored by the same person who tunes
the agent inherit that person's model of what the agent finds hard. Adopted tasks were written by
maintainers solving their own problems, with no agent in mind. That independence is the point.

## What adoption did **not** solve

SWE-bench supplies the tasks. It does **not** supply the environment in a usable form here.

The official harness builds **one Docker image per instance**, pinned to a period-correct
interpreter and dependency set. On this machine the Docker daemon returns **HTTP 500 on `_ping`**;
it cannot build or run those images. That is an infrastructure fact about this environment, not a
property of the corpus, and it is recorded rather than worked around silently.

Consequently the binding constraint on corpus size is **environment reproducibility, not task
availability** — a finding that turned out to be the central result of this stage. See
`corpus-methodology.md` for how it was addressed and `rejected-tasks.md` for what it cost.

## What was adopted, concretely

- Task **content**: adopted wholesale. Zero problem statements authored.
- Task **oracles**: adopted wholesale. Zero pass criteria authored.
- Task **environment**: rebuilt locally, because Docker is unavailable. This is the only part built,
  and it is built in `eval/`, never in `v0/src/`.
