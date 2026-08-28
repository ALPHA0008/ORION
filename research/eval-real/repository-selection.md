# Repository Selection

Five public repositories, each pinned to an exact commit. Selection was **empirical**: every
candidate was cloned, installed, and had its test suite executed before being admitted.

## Criteria

| criterion | why |
|---|---|
| public + permissively licensed | legally usable for evaluation |
| reproducible history, pinned SHA | a moving `main` is not a benchmark |
| deterministic test suite | flaky tests would masquerade as agent failures |
| small, reliable `npm install` | install failures become `INFRA_FAILURE` noise |
| meaningful source to reason about | the point is real code, not fixtures |
| no expensive infrastructure | no databases, browsers, or cloud services |

## The set

| repo | commit | license | runner | install | tests | why chosen |
|---|---|---|---|---|---|---|
| `is-number` | `98e8ff1d` | MIT | mocha | 19s | 111 | CJS; huge assertion count over a tiny surface |
| `camelcase` | `3146708d` | MIT | ava | 42s | 20 | dense Unicode/regex logic, many edge cases |
| `slugify` | `7c318bd1` | MIT | ava | 46s | 22 | multi-file; string pipeline with options |
| `p-limit` | `df476048` | MIT | ava | 49s | 22 | async concurrency — genuinely hard to reason about |
| `ansi-styles` | `c1c3dd4e` | MIT | ava | 51s | 10 | numeric colour-space conversion |

All five were verified end-to-end (clone → install → tests green) before any task was written.

## Two decisions that materially affect the results

### 1. The test runner is invoked directly, never `npm test`

Four of these repos declare `"test": "xo && ava"`. `xo` is a **linter**. Running it would fail a
task because the agent's otherwise-correct patch used the wrong quote style — scoring code
aesthetics as a capability failure. Every task therefore runs `npx ava` / `npx mocha` directly.

This is a deliberate, documented deviation from each repo's own script.

### 2. `node_modules` is shared by link, not copied

Measured: `camelcase`'s dependency tree is **15,325 files / 124 MB**, and copying it per checkout
took ~200s — a single bracketing pass (two provisions) took **402s**. Dependencies are now
installed once per (repo, commit) and attached to each fresh checkout with a directory
junction/symlink.

Result: provisioning went from **13.2s to 0.3s** (~44×), which is what makes a 22-task benchmark
with repeats practical at all.

Two safety properties were tested rather than assumed:

- the shared cache **survives** `destroy()` — the link is unlinked before the recursive remove,
  verified by counting cache entries before and after (145 → 145);
- tests still pass through the link.

Dependencies are read-only for these tasks: the agent is asked to fix repository source, and the
verifier separately guards the repo's test files.

## Honest limitations

- **All five are small JavaScript libraries.** No compiled languages, no services, no frameworks,
  no monorepos. Results do not generalise to large or polyglot codebases.
- **All five are single-author-style utility packages** by two authors (sindresorhus,
  jonschlinkert) plus chalk. Idiom diversity is low.
- **`ansi-styles` carries only 10 tests**, which proved too thin to observe many plausible
  defects — three candidate tasks were rejected by bracketing because its suite could not detect
  them. That is a property of the repository, and it is why it contributes only 2 tasks.
- **Defects are injected, not historical.** See [methodology](methodology.md).
