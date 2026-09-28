# Documentation Gap Audit

Audited `README.md`, `v0/README.md`, `v0/docs/` (7 files), `v0/ADRs/` (13) and `v0/CONTRIBUTING.md`
against the implementation. **Wave 2 does the DX pass; this only records gaps.**

## What already exists and is good

| doc | assessment |
|---|---|
| `README.md` | Opens with the right claim and a *concrete* crash/resume transcript. Honest licence section. |
| `v0/docs/ARCHITECTURE.md`, `RECOVERY.md`, `REPLAY.md`, `FORKING.md`, `TOOLS.md`, `SECURITY.md`, `MODEL-ADAPTERS.md` | Seven topic docs — unusually complete for this stage |
| `v0/ADRs/` (13) | Each decision tied to measured evidence. A genuine asset; most projects have nothing comparable. |
| `v0/CONTRIBUTING.md` | "the rule that keeps the core small" — encodes the anti-bloat principle |

## Incorrect or stale claims

| # | claim | reality | severity |
|---|---|---|---|
| 1 | README: **"~2,300 LOC"** | measured **2,701** in `v0/src` | low — update |
| 2 | README shows `$ harness run …` | **no `harness` binary exists**; real invocation is `node v0/src/cli/index.mjs` | **high** — the very first example cannot be run |
| 3 | README: **"10 architecture decision records"** | there are **13** | low |
| 4 | README example shows `src/calc.js` and `bash → PASS` | plausible but **not a reproducible transcript** from this repo | medium — should be a real, runnable example |
| 5 | Licence: *"Not yet chosen… all-rights-reserved"* | **accurate**, and correctly stated | none |

Item 2 is the important one: the headline example is aspirational syntax. It will be true the moment
`package.json` exists — which is the same blocker as everywhere else.

## Missing setup documentation

| gap | note |
|---|---|
| **install instructions** | none — no `npm i`, no `npx`, no "clone and run" quickstart |
| **Node version requirement** | **≥22 (`node:sqlite`)** is documented nowhere; a Node-20 user gets an obscure import failure |
| **`git` on PATH** | required for workspace shadow repos; undocumented |
| **first-run walkthrough** | no "here is a directory, here is a task, here is the output" |

## Missing configuration documentation

The five env vars appear in CLI `--help` but **not in the README**: `HARNESS_BASE_URL`,
`HARNESS_API_KEY`, `HARNESS_MODEL`, `HARNESS_HOME`, `HARNESS_POSTURE`. There is no worked example
for a local provider (Ollama/vLLM/LM Studio), which is the most likely first configuration.

## Missing examples

**No `examples/` directory.** For a runtime whose thesis is trajectory manipulation, the absence of
a runnable end-to-end example is the biggest DX gap after packaging. The minimum set:

1. crash → `resume` (the README's headline claim, made reproducible)
2. `explain` on a real run
3. `replay` showing "no model calls, no cost"
4. `fork --at <seq>` and what diverges
5. escalation: `ask_user` → `answer`

## Missing explanations

| topic | gap |
|---|---|
| **recovery** | `RECOVERY.md` exists, but the **six recovery classes** and the `SKIP`/`REISSUE`/`ESCALATE` decision table are not summarised for a newcomer |
| **trajectory** | no single page tying `status` → `explain` → `replay` → `fork` into one narrative |
| **tool guarantees** | the `write`/`edit` vs `bash` asymmetry is **not** stated publicly. Users will assume uniformity. This must be documented — it is a correctness-relevant boundary. |
| **fork limitation** | "workspace is not rewound" is printed by the CLI but appears in no doc |
| **security boundary** | `SECURITY.md` exists; needs the explicit "path containment, **not** OS isolation" sentence |

## Documentation NOT to write yet

Per the brief, Wave 2 owns the DX pass. Specifically **do not** yet write: a website, API reference
generation, tutorials beyond one quickstart, or comparison pages against other agents.

## Priority for Wave 2

1. Fix the `harness` invocation examples (unblocked by `package.json`).
2. Add install + Node ≥22 + `git` requirements.
3. Add one runnable `examples/` walkthrough covering crash→resume→explain→replay→fork.
4. Document the tool-guarantee asymmetry (`bash` is not witnessed).
5. Correct LOC and ADR counts.
