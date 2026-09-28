# Wave 2 — Start State (observed, not assumed)

Captured before any source modification.

## Repository

| item | value |
|---|---|
| branch | `main` |
| HEAD | `c36efc85874b10b29a836bce6564105c6cc369a9` |
| working tree | clean except **`?? research/productization/`** (untracked, Wave-1 output) |

**`research/productization/` is intentionally untracked productization material.** It must not enter
a runtime/package commit. No `git add -A` in this wave.

## Test baseline — authoritative

| item | value |
|---|---|
| command | `node v0/tests/run-all.mjs` |
| result | **608 passed, 0 failed, 23 suites** |
| framework | none — self-contained runner |

This is the baseline for the Phase-4 regression gate. It is recorded rather than hardcoded.

## Runtime structure

`v0/` contains `src` (15 `.mjs`), `tests` (51 files), `docs` (7), `ADRs` (13), `benchmarks`,
`CONTRIBUTING.md`, `README.md`, and an **empty, untracked `examples/`**.

`v0/src` modules:

```
agent/loop/worker.mjs          agent/model/index.mjs
agent/model/shims/gemma-tool-calls.mjs
agent/tools/index.mjs          auth/default/index.mjs
cli/index.mjs                  core/event/index.mjs
core/lease/reaper.mjs          core/projection/compact.mjs
core/projection/index.mjs      core/recovery/index.mjs
core/replay/index.mjs          core/run/explain.mjs
core/run/store.mjs             sandbox/local/index.mjs
```

## Packaging state

| item | observed |
|---|---|
| `package.json` | **none anywhere in the repository** |
| CLI invocation | `node v0/src/cli/index.mjs <cmd>` |
| **CLI shebang** | **already present** — `#!/usr/bin/env node` |
| dependencies | **zero** — all imports are `node:` builtins or relative |
| build step | none (plain ESM) |

## License state

| item | observed |
|---|---|
| `LICENSE` file | **absent** (root and `v0/`) |
| README §Licence | *"Not yet chosen. Treat as all-rights-reserved until one is added."* |
| package metadata | n/a — no manifest exists |

## Package name state

`@kernlbase/harness` is the intended identity. **Not yet verified** — Phase 2 gate.

## Corrections to the Wave-1 audit

Two Wave-1 statements were inaccurate and are corrected here from direct observation:

1. **The CLI already has a shebang.** Wave 1 listed adding one as required work. It is present at
   line 1 of `v0/src/cli/index.mjs`.
2. **`v0/examples/` exists** (empty, untracked). Wave 1 reported "no `examples/` directory" — true
   for a *tracked* example, but the directory is there.

Neither changes the Wave-1 verdict; both reduce Wave-2 scope.

## Relevant untracked files

| path | disposition |
|---|---|
| `research/productization/` (21 files) | Wave-1 + Wave-2 audit output. **Never** in a package commit. |
| `v0/examples/` | empty; will hold the Phase-8 example |
