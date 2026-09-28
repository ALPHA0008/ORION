# Track B — Start State (observed before any modification)

## Repository

| item | value |
|---|---|
| HEAD | `6f6afcc6229bd92b41689cc56425949621a95fae` |
| branch | `main` |
| HEAD subject | `stage2 TrackB: OSS v0.1 packaging — @kernlbase/harness, grep fixes, honest runtime docs (Wave 2)` |
| remote `origin` | `https://github.com/ALPHA0008/harness.git` (fetch + push) |
| working tree | clean except two untracked dirs (below) |

**Wave 2 was committed** at `6f6afcc` (it was left uncommitted at the end of that phase, as
instructed; someone committed it subsequently). `v0/package.json`, `v0/LICENSE` and
`v0/src/index.mjs` are all tracked as of that commit.

### Untracked directories — both must stay out of product commits

| path | contents |
|---|---|
| `research/productization/` | Wave-1/Wave-2/Track-B audit records |
| `research/corpus/` | `SIX-REPOSITORY-EXPANSION.md`, `SIX-REPOSITORY-MANIFEST.md` (24 KB) — research material, new since Wave 2 |

## Environment

| item | value |
|---|---|
| OS | Windows 11 (`MINGW64_NT-10.0-26100`, Git Bash) |
| Node | **v24.18.0** |
| npm | **11.16.0** |
| shell | MINGW64 / Git Bash |

## Package identity — unchanged, as required

| field | value |
|---|---|
| name | `@kernlbase/harness` |
| version | `0.1.0` |
| bin | `harness` → `./src/cli/index.mjs` |
| license | `Apache-2.0` |
| engines | `node >=22` |

## Test baseline — authoritative for this phase

```
node v0/tests/run-all.mjs
TOTAL: 608 passed, 0 failed across 23 suites
```

**The security suite passed** (41 assertions) in this environment. The `/bin/bash` abort described
in the B1 brief did **not** reproduce under this invocation — see the B1 report for classification.

## npm authentication state

```
$ npm whoami
npm error code ENEEDAUTH
npm error need auth This command requires you to be logged in.
```

**Not authenticated.** Publishing authority for the `@kernlbase` scope cannot be verified from this
machine in its current state. See B0/B3 gate.

## Repository metadata mismatch — found in this audit

`v0/package.json` declares:

```
repository: git+https://github.com/kernlbase/harness.git
homepage:   https://github.com/kernlbase/harness#readme
bugs:       https://github.com/kernlbase/harness/issues
```

Verified against GitHub:

| URL | HTTP |
|---|---|
| `api.github.com/repos/kernlbase/harness` | **404 — does not exist** |
| `api.github.com/repos/ALPHA0008/harness` | **200 — exists, public, default branch `main`** |

The declared repository does not exist; the real remote is `ALPHA0008/harness`. A package published
with these fields would link consumers to a 404. This is a **B0 blocker to resolve before B3**, and
it is a metadata decision (which identity is canonical) rather than a code fix.
