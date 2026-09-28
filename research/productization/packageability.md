# Packageability Audit

**The spike question:** *what is the minimum required for another developer to install this
repository and invoke the harness from a clean environment?*

## Findings

| item | state |
|---|---|
| `package.json` | **DOES NOT EXIST** — anywhere in the repository |
| `bin` entry | none |
| `exports` map | none |
| `engines` | none |
| lockfile | none |
| build step | **none needed** — plain ESM `.mjs`, no transpile |
| **production dependencies** | **ZERO** |
| Node requirement | **≥22** (`node:sqlite`); verified working on **v24.18.0**, imports cleanly with no experimental warning |
| module resolution | relative paths only; **CLI verified runnable from an arbitrary cwd** via absolute path |
| runtime assumptions | `HARNESS_HOME` (defaults `~/.harness`), env-var config, `git` on PATH for workspace shadow repos |

## The single blocker

**There is no `package.json`.** Consequences:

- `npm install` / `npx` cannot work.
- No `harness` binary — invocation is `node v0/src/cli/index.mjs <cmd>`.
- Nothing is formally public; there is no `exports` map, so every consumer reaches into
  `v0/src/**` by path.
- No declared Node engine, so a Node-20 user gets an obscure `node:sqlite` failure instead of a
  clear engine error.

## Everything else is unusually favourable

This is a much better position than most repositories at this stage:

1. **Zero dependencies.** `node:child_process`, `node:crypto`, `node:fs`, `node:os`, `node:path`,
   `node:sqlite` — all builtins. No supply chain, no lockfile drift, no license inheritance, no
   `node_modules`.
2. **No build.** Plain ESM. Publish the source; it *is* the artifact.
3. **Location-independent.** Verified: invoking the CLI by absolute path from `C:\` works.
4. **Clean `.gitignore`.** Runtime state (`*.db`, `.harness/`, `shadow.git/`) is already excluded.
5. **The test suite is self-contained** — `node v0/tests/run-all.mjs`, 608 passing, no framework.

## Minimum to make it installable

The whole gap is one file plus a small directory decision:

```jsonc
{
  "name": "<tbd>",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },       // node:sqlite
  "bin": { "harness": "./src/cli/index.mjs" },
  "exports": {
    ".":            "./src/index.mjs", // a small barrel — does not exist yet
    "./store":      "./src/core/run/store.mjs",
    "./events":     "./src/core/event/index.mjs",
    "./model":      "./src/agent/model/index.mjs",
    "./tools":      "./src/agent/tools/index.mjs",
    "./sandbox":    "./src/sandbox/local/index.mjs",
    "./auth":       "./src/auth/default/index.mjs",
    "./replay":     "./src/core/replay/index.mjs"
  },
  "files": ["src", "README.md", "LICENSE"],
  "license": "<see license-options.md>"
}
```

Open decisions (not made here):

1. **Package root.** `v0/` is a phase name, not a product name. Either publish with `v0` as the
   package root, or move `v0/src` → `src`. The latter is cleaner but touches every `eval/` import
   path — and `eval/` is the evidence base. **Recommendation: publish from `v0/` for v0.1**, rename
   later behind a stable `exports` map, so no evidence path breaks.
2. **A shebang** (`#!/usr/bin/env node`) on `cli/index.mjs` — currently absent; needed for `bin`.
3. **Package name** — undecided.
4. **A root barrel** (`src/index.mjs`) — does not exist; needed for `"."`.

## Verdict

Packaging is a **small, well-understood task**, not an architectural problem. There is no
dependency graph to untangle, no build to configure, no circular imports, no transpile step. The
blocker is the absence of a manifest, and the manifest is short because the project is genuinely
dependency-free.

**Estimated effort: hours, not days** — most of it spent choosing a name, a license, and whether to
move `v0/src`.
