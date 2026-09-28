# Wave 2 Plan — Smallest Path to a Credible v0.1

**Do NOT execute this in Wave 1.** Gate result: `OSS_ARCHITECTURE_PACKAGEABLE`.

Ordered by dependency. Steps 1–2 unblock everything else.

## 1. Packaging

**Goal:** `npm i` → `harness run "…"`.

- [ ] Add `v0/package.json`: `type: module`, `engines: {node: ">=22"}`, `bin: {harness: "./src/cli/index.mjs"}`, `exports` map, `files: ["src","README.md","LICENSE"]`
- [ ] Add `#!/usr/bin/env node` to `src/cli/index.mjs` (currently absent)
- [ ] Create `src/index.mjs` barrel for the `"."` export
- [ ] Choose the package name
- [ ] Add `LICENSE` (see `license-options.md` — **Apache-2.0 recommended**, MIT the alternative)
- [ ] Confirm no audited third-party source was copied into `v0/src`

**Explicitly not doing:** moving `v0/src` → `src/`. It breaks `eval/`'s imports and the paths cited
in committed research, for cosmetic gain. A stable `exports` map achieves the naming benefit.

**Exit:** `npm pack` produces a tarball; installing it in a clean directory yields a working
`harness` binary.

## 2. Defect fixes (small, behavioural — NOT architecture)

- [ ] **`grep` with a file path** — `sandbox.grep()` calls `readdirSync` unconditionally, so a file
      throws `ENOTDIR` and reports "no matches". **Highest-value fix**: it fires on a first
      realistic task and makes a present file look missing.
- [ ] **`grep` excludes `.harness/`** — currently returns event-log SQLite binary and
      `workspaces/*.git/hooks/*`; the agent's own state is in its search space.
- [ ] **Non-zero exit on configuration failure** — `run` currently exits 0 after "No model
      configured", which breaks scripting/CI.
- [ ] Add `--version`.

**§17 gate: these touch `v0/src`.** Each requires the full V0 regression suite green — recovery,
fencing, replay, fork, escalation, security — before it is valid. Baseline: **608 passed, 0 failed**.
Commit separately from packaging.

## 3. CLI polish — minimal

- [ ] `--json` on `status`, `list`, `explain` (scripting; everything is human-formatted today)
- [ ] Optional: let `doctor` probe endpoint reachability

**Do not redesign the CLI.** Twelve commands are implemented, verified, and well-named.

## 4. Documentation

- [ ] README: fix the `harness` invocation examples (unblocked by step 1)
- [ ] README: install steps, **Node ≥22**, `git` on PATH
- [ ] README: the five env vars, with a local-provider (Ollama/vLLM) worked example
- [ ] Correct stale numbers: **2,701 LOC** (not ~2,300), **13 ADRs** (not 10)
- [ ] `docs/TOOLS.md`: state the guarantee asymmetry — `write`/`edit` are pre-state witnessed,
      **`bash` is not** (observable, conservatively authorized, crash-safe)
- [ ] `docs/SECURITY.md`: "path containment, **not** OS isolation"
- [ ] `docs/FORKING.md`: fork rewinds history, **not the workspace**
- [ ] One trajectory page: `status` → `explain` → `replay` → `fork`

## 5. Example

- [ ] `examples/` with one runnable walkthrough: buggy file → `run` → crash → `resume` → `explain`
      → `replay` → `fork`

The thesis is trajectory manipulation; shipping it undemonstrated wastes the differentiator.

## 6. Fresh-install verification

- [ ] Clean machine (or container), Node 22 **and** 24
- [ ] `npm i -g <pkg>` → `harness doctor` → `harness run` → `explain` → `replay` → `fork`
- [ ] Verify the engine error is clear on Node 20
- [ ] Re-run the fresh-run audit mechanically and record deltas

## 7. Release acceptance

Ship only when:

| criterion | source |
|---|---|
| all 14 `oss-v0.1-contract.md` items are READY or documented-PARTIAL | that file |
| **608 tests green** | `node v0/tests/run-all.mjs` |
| `npm i` → `harness run` works on a clean machine | step 6 |
| no claim in the README is unverifiable | `documentation-gaps.md` |
| tool-guarantee asymmetry documented | `tool-contract.md` |
| LICENSE present and consistent with README | `license-options.md` |

## Explicitly out of scope for Wave 2

Memory · planning · MCP · skills · subagents · vector DBs · new tools · streaming · multi-provider ·
enterprise governance · billing · multi-tenancy · dashboards · workspace-rewinding fork · V1
capability work.

The v0.1 release makes **one** thing clear: *this is a serious agent execution runtime with
first-class trajectories.* Capability can be added later without losing that identity — and Stage 1
showed capability claims need far more evidence than currently exists.
