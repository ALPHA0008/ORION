# Corpus Selection — Why These Repositories

SWE-bench Lite is 300 instances across 12 repositories. This stage does not use all of them, and
the reason is worth stating precisely, because the filter shapes every number that follows.

## The filter

```js
const PLAUSIBLE = new Set(['pallets/flask', 'psf/requests', 'pytest-dev/pytest', 'pylint-dev/pylint']);
```

**Included** because they are pure Python with small dependency surfaces: they can be built from
source on this machine without a compiler toolchain, and their tests run in seconds rather than
minutes.

**Excluded** — `django`, `sympy`, `matplotlib`, `astropy`, `scikit-learn`, `xarray`, `seaborn`,
`scipy`, `pydata`, `sphinx` — because they require compiled wheels pinned to old versions of numpy
and friends. Without Docker those builds are a multi-hour proposition per task with a low success
rate. They were excluded **up front and as a group** rather than attempted and failed one by one,
so the rejection record reflects task and environment properties rather than a compiler hunt.

This left **32 candidates** of the 300.

## What the filter costs

It is a real bias and it runs in a known direction:

- **Repository diversity is narrow.** Four projects, and two of them (`pytest`, `pylint`) are
  developer tooling with unusual testing idioms.
- **The hardest instances are gone.** `django` and `sympy` instances are typically larger and touch
  more files. Excluding them removes the upper end of the difficulty range.
- **Python only.** No statement about this agent on other languages follows from any of this.

The effect on the headline claim is therefore asymmetric and should be read that way: a failure
observed on this corpus is likely to hold on the excluded repositories too, since those are harder.
A **success** rate measured here does **not** transfer upward.

## Why not simply use fewer, larger repositories?

Because the bracket has to run per task and a task that takes twenty minutes to build cannot be
bracketed, rerun, or debugged within this stage. Reproducibility was the binding constraint
throughout (see `corpus-methodology.md`); choosing repositories that could actually be reproduced
was the only way to get a corpus that is verified rather than merely asserted.

## Target size and the quality rule

The brief asks for 20–30 tasks and adds: *don't insist on 30 if the first 20 are far higher quality
than the next 10.* That rule was applied literally. Nothing was admitted to raise the count: every
admitted task passed the same two-sided bracket, and the final size is whatever survived it. The
count is a **result**, not a target that was met.

See `accepted-tasks.md` for what survived and `rejected-tasks.md` for what did not, with reasons.
