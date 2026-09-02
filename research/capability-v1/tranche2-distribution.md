# Tranche 2 — Distribution

**Tranche-2 multi-file SWE-bench-Verified slice, locally reproduced.**

## Stage 1 vs Tranche 2

| dimension | Stage 1 | Tranche 2 |
|---|---|---|
| tasks | 17 | 18 |
| **multi-file gold patches** | **0** | **18** |
| repositories | 4 | 4 |
| source | SWE-bench **Lite** | SWE-bench **Verified** |
| new repositories | — | django/django, sphinx-doc/sphinx |
| test runners | pytest | pytest **+ django runtests.py** |

## Files touched by the gold patch

| files | tasks |
|---|---|
| 2 | 7 |
| 3 | 6 |
| 4 | 4 |
| 5 | 1 |

**Every accepted task is genuinely multi-file** — the count is of files the *known-good*
solution changes, not of files in the repository.

## Repository distribution

| repository | tasks | share |
|---|---|---|
| django/django | 12 | 67% |
| pylint-dev/pylint | 3 | 17% |
| pytest-dev/pytest | 2 | 11% |
| sphinx-doc/sphinx | 1 | 6% |

**Concentration warning, stated up front:** django is 67% of this tranche.
That is a direct consequence of where multi-file instances actually live in SWE-bench
Verified (32 of 43 multi-file candidates are django), not a preference. It means a mechanism
observed mainly on django tasks must be checked for whether it survives outside django before
it can support any conclusion — the same test Stage 1 applied to pytest.

## What this corpus supports

- multi-file coordination — **for the first time in this project**
- a materially larger repository (django) and a new testing ecosystem (django runtests)
- cross-repository comparison of any mechanism found

## What it still does NOT support

- **any non-Python language.** Java/Defects4J was evaluated and deferred: no JDK, no Maven,
  no Docker daemon on this machine, and building a Java toolchain would become a second
  project rather than a corpus expansion.
- claims about the hard end of the difficulty range — the scientific stack
  (matplotlib, scikit-learn, astropy, xarray) is still excluded for buildability.
- statements about model capability generally: still **one valid model arm**.