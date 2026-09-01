# Rejected Tasks — 15

Negative findings are part of the result (§6). Every candidate that failed the bracket is listed
here with the stage it failed at, so the corpus's size can be audited rather than trusted.

**No task was repaired to make it pass.** A task that could not be reproduced was excluded (§7).

## TASK_TOO_TRIVIAL — 5

The FAIL_TO_PASS test ALREADY PASSES on the clean tree here, so the objective is not unsatisfied and solving it would prove nothing.

| task | detail |
|---|---|
| `pallets__flask-4992` |  |
| `psf__requests-2148` |  |
| `psf__requests-2317` |  |
| `psf__requests-2674` |  |
| `pytest-dev__pytest-7168` |  |

## DEPENDENCY_UNRESOLVABLE — 5

No dependency set could be resolved for the era. Mostly 2012-2014 instances whose build tooling predates the interpreters available here.

| task | detail |
|---|---|
| `psf__requests-863` |  |
| `pylint-dev__pylint-7114` |  |
| `pytest-dev__pytest-5413` |  |
| `pytest-dev__pytest-5495` |  |
| `pytest-dev__pytest-5692` |  |

## BASELINE_NOT_REPRODUCIBLE — 3

The maintainer's own fix does not make the test pass here, and no environment defect was found to explain it. Excluded rather than guessed at.

| task | detail |
|---|---|
| `pytest-dev__pytest-5103` |  |
| `pytest-dev__pytest-5221` |  |
| `pytest-dev__pytest-5227` |  |

## ENVIRONMENT_UNREPRODUCIBLE — 2

The tree could not be built or imported in an era-correct environment. The task may be perfectly sound elsewhere -- this is a statement about this machine.

| task | detail |
|---|---|
| `psf__requests-1963` |  |
| `pylint-dev__pylint-7080` |  |

## Rescue history — the negative finding that matters most

Several tasks here were rejected, investigated, and **recovered**. That history is kept rather than
overwritten, because the rejections were wrong in an instructive way.

At the first pass on the machine's default Python 3.14 the corpus measured **1 accepted out of 32**.
Nothing about the tasks changed thereafter. Every subsequent admission came from correcting a defect
in *our own* provisioning:

| what was fixed | tasks recovered |
|---|---|
| era-appropriate interpreter (3.9 / 3.8 via `uv`) instead of 3.14 | the bulk of the corpus |
| `--exclude-newer <created_at>` for the dependency universe | flask, pylint |
| `atomicwrites` yank-hole lifted (uv had SILENTLY backtracked to pytest 3.5.1) | flask, pylint, pytest |
| build-requires regex that stopped at the `]` inside `setuptools-scm[toml]` | pytest |
| dropped our own `--no-header` flag, which postdates pytest 6.0 | 9 pytest candidates |
| `--upgrade` on the fallback build toolchain | requests |
| Python 3.8 for 2019-era instances | `pytest-8906` |

**Five of those wore the strongest costume available** — `oracle-negative`, meaning "the
maintainer's own fix does not fix the bug". Not one of them was a real task defect.

## What the surviving rejections mean

The dominant remaining categories are **DEPENDENCY_UNRESOLVABLE** (5) and **TASK_TOO_TRIVIAL** (5).
They point in opposite directions and should not be read as one number:

- `DEPENDENCY_UNRESOLVABLE` and `ENVIRONMENT_UNREPRODUCIBLE` (7 combined) are statements about
  **this machine**, concentrated in 2012–2014 instances whose build tooling predates every
  interpreter available here. Those tasks are probably fine under SWE-bench's official images.
- `TASK_TOO_TRIVIAL` (5) is a statement about **the tasks**: their target test already passes on a
  clean tree here, so solving them would prove nothing. This category existing at all is evidence
  the preflight side of the bracket is load-bearing rather than decorative.
- `BASELINE_NOT_REPRODUCIBLE` (3) is the honest residue: the gold patch does not satisfy the
  oracle here and no environment cause was found. Excluded rather than guessed at.
