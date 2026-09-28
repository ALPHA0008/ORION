# Repository Boundary — Product vs Evidence

## Current separation — already largely correct

| directory | role | tracked files |
|---|---|---|
| `v0/src` | **PRODUCT** — the runtime | 15 |
| `v0/tests` | **PRODUCT** — its tests | 51 |
| `v0/docs`, `v0/ADRs` | **PRODUCT** — its documentation | 20 |
| `v0/benchmarks` | EVALUATION — runtime perf | 5 |
| `eval/` | **EVALUATION** — capability benchmark harness | 198 |
| `research/` | **RESEARCH** — findings, audits, phase records | 248 |
| `research/repos`, `research/runs` | EXTERNAL / GENERATED | gitignored |

The product is **already** confined to `v0/`, and within it to 15 source files. The separation is
better than the flat file count suggests: `eval/` and `research/` are 446 of 543 tracked files, and
**none of them ships**.

## The one real coupling

`eval/` imports `v0/src` internals directly across 9 modules (`store` ×9, `sandbox` ×7, `tools` ×7,
`model` ×7, `auth` ×5, `worker` ×5, plus `explain`, `recovery`, `projection`).

This is **not a defect** — it is the most valuable structural evidence in the audit. It means:

- the runtime already *is* a library with a real second consumer;
- the boundaries have been exercised outside their own tests;
- the API worth publishing is the one `eval/` already uses.

But it does create one constraint: **moving `v0/src` breaks every one of those imports**, and
`eval/` is the frozen evidence base for Stage 1. Paths there are referenced from committed
research documents.

## Smallest organizational improvement

**Do not restructure.** Three low-risk moves, in order:

1. **Add `v0/package.json`** declaring `bin` + `exports`. This creates the product boundary
   *logically* without moving anything. `eval/` keeps working unchanged.
2. **Record the boundary in `CONTRIBUTING.md`** — one table: `v0/src` ships, `eval/` and `research/`
   do not.
3. **Decide publication scope** (a release decision, not a layout one):
   - **Option A — publish `v0/` only.** Cleanest consumer story; the evidence stays private or in a
     separate repo. Loses the ADRs-and-evidence narrative that is arguably the project's strongest
     differentiator.
   - **Option B — publish the whole repo, package from `v0/`.** Keeps evidence visible; `files:`
     in the manifest limits what npm ships. **Recommended** — the research *is* the credibility.

## What NOT to do

- **Do not move `v0/src` → `src/`.** Cosmetic gain; breaks the evidence base's imports and the paths
  cited in committed research. If the name matters later, a stable `exports` map renames the
  *public* surface without touching the *physical* one.
- **Do not split into a monorepo** with workspaces. Zero dependencies and 15 source files do not
  justify the tooling.
- **Do not move `eval/` or `research/`.** They are the record; churn there costs credibility and
  buys nothing.

## Verdict

The product/evidence boundary is **already clean enough to publish**. It needs a manifest and a
documented statement, not a reorganisation.
