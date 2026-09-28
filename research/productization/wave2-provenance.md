# Phase 1 — Provenance Gate

## Result: **PROVENANCE CLEAR** — proceed

## What was audited

All 15 `.mjs` files under `v0/src` (2,701 lines), the only source intended for publication.

## Evidence

### 1. No third-party license or copyright headers

```
grep -rniP "copyright|SPDX|licen[cs]e|\(c\) 20|all rights reserved" v0/src/
```

One hit, and it is prose, not a header:

```
core/recovery/index.mjs:43:  // ADR-011: the class alone does NOT license a re-issue under uncertainty.
```

### 2. No vendored directories

No `vendor/`, `third_party/`, `third-party/` or `node_modules/` anywhere under `v0/`.

### 3. Two attribution-shaped comments — investigated, both are IDEAS not code

**`auth/default/index.mjs:26`**

> *"Postures compose as a FLOOR: a narrower scope may only RAISE strictness, never lower it
> (borrowed from QM — the only correct direction for a policy lattice)."*

This attributes a **design principle** (monotonic strictness in a policy lattice) — an
uncopyrightable idea. The implementation (`maxPosture`, `RANK`, `createAuthorizer`) is original and
structured around this project's own `Decision` enum and recovery classes.

**`sandbox/local/index.mjs:137`**

> *"A bare shadow git repo gives diffing, history and restore for free without touching the user's
> own .git (idea borrowed from Hermes; see LESSONS.md L-03)."*

This attributes an **architectural approach** (use a bare shadow repo for workspace checkpoints).
The comment says "idea" explicitly. The implementation (`attachCheckpoints`, the `GIT_DIR`/
`GIT_WORK_TREE` env handling, the `core.autocrlf=false` byte-preservation config) is original.

Both comments are **intellectual honesty about influence**, which is the correct engineering
practice and is not an attribution obligation. Ideas, methods and architectural approaches are not
protected by copyright; only expression is.

### 4. Direct identifier check against the audited sources

The audited repositories are present locally (gitignored, never committed). Searched all of
`research/repos/` for the nine most distinctive `v0/src` identifiers:

| identifier | found in audited repos? |
|---|---|
| `createAuthorizer` | **no** |
| `attachCheckpoints` | **no** |
| `decideRecovery` | **no** |
| `classifyShell` | **no** |
| `verifyProjectionEquivalence` | **no** |
| `nearestTurnBoundary` | **no** |
| `captureWitness` | **no** |
| `repairOrphans` | **no** |
| `expected_pre_sha` | **no** |

**Zero overlap.** If code had been copied, shared identifiers would be the expected fingerprint.

### 5. Language mismatch

Per `research/FINDINGS.md`: QM and Hermes are **TypeScript** (267K / 915K LOC), Ruflo has 39
**Rust** files. `v0/src` is plain ESM `.mjs` with no build step. Copied source would have required
deliberate translation, of which there is no trace.

### 6. Zero dependencies

Every import is a `node:` builtin (`child_process`, `crypto`, `fs`, `os`, `path`, `sqlite`) or a
relative path. **No third-party code enters the published artifact**, so no transitive license
obligation exists.

## Attribution / NOTICE material required

**None.** Apache-2.0 requires a `NOTICE` file only when one carries forward from a dependency or
derived work. There are no dependencies and no derived source.

The two influence comments should **remain in the source** — they are accurate and good practice —
but they create no legal obligation and belong in no NOTICE file.

## Conclusion

Provenance is **clear**. The runtime is original work with zero third-party production
dependencies and no copied source. Apache-2.0 may be applied without additional attribution
material.

Gate: **PASSED**.
