<!-- markdownlint-disable MD033 MD041 -->

[![npm](https://img.shields.io/npm/v/@kernlbase/orion?style=flat)](https://www.npmjs.com/package/@kernlbase/orion)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat)](v0/LICENSE)
[![CI](https://github.com/ALPHA0008/ORION/actions/workflows/ci.yml/badge.svg)](https://github.com/ALPHA0008/ORION/actions)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-blue?style=flat)](v0/README.md#requirements)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat)](v0/README.md#requirements)

# Orion — durable, replayable agent runs

**A durable agent runtime, and the research that produced it.**

Run an agent. Kill the process. Start it again — it continues from where it stopped. Then inspect
exactly what it did, and branch from any point in its history.

```console
$ orionctl run "fix the bug in src/calc.js and verify"
  ✓ read src/calc.js
  ✓ edit edited src/calc.js
  ✕ Process terminated

$ orionctl resume #045abc
resuming from event 21…
  ♻ Recovered from event #21 — write: skip
  ✓ bash → PASS
✓ model_finished
```

The `write: skip` line is the point. On resume the runtime asked the `write` tool *did this already
land?* — the tool checked its recorded pre-state witness, found the change present, and declined to
apply it twice.

## Install

```bash
npm install -g @kernlbase/orion
orionctl
```

Published as **[`@kernlbase/orion`](https://www.npmjs.com/package/@kernlbase/orion)**; the command
it installs is **`orionctl`**. Full usage in **[v0/README.md](v0/README.md)**.

## This repository

| | |
|---|---|
| **[`v0/`](v0/)** | the runtime — zero dependencies, no build step, published to npm |
| **[`research/`](research/)** | the audit, benchmarks and experiments it was derived from |
| **[`eval/`](eval/)** | the capability benchmark harness (kept out of the shipped package) |

The runtime is what ships. The research is kept in the open because several of its findings argue
*against* the product, and those are worth reading too.

## Start here

- **[v0/README.md](v0/README.md)** — install, configure, commands, guarantees
- **[PROJECT-JOURNEY.md](PROJECT-JOURNEY.md)** — how this got built, in what order, and why
- **[V0-READINESS.md](V0-READINESS.md)** — current status: what is proven, what is not

## What makes it different

**Crash recovery that knows what it doesn't know.** When a process dies between a tool's effect and
the record of it, the runtime asks the tool: *did this land?* A file write is checked against a
pre-state witness; an edit by looking for its own precondition. When a tool cannot tell — `curl -X
POST`, say — the run **escalates** rather than guessing. It never silently duplicates a side effect.

**Three verbs that are genuinely different.** `replay` reconstructs history with **zero** model
calls. `fork` inherits history to a point, then diverges. `rerun` starts fresh. With a
nondeterministic model, that distinction is the difference between a fact and a fresh guess.

**Nothing degrades silently.** Every fallback emits a `degraded` event — including retries inside
the model client and provider shims that rewrite a response. Status is derived from counted
effects, so a broken path cannot report itself healthy.

**Stalls are diagnosed, not just stopped.** A run that repeats itself terminates as `no_progress`
with the reason attached, not as an anonymous `max_turns`.

## Status

**Published and technically validated. Commercially unproven.**

- **654 regression assertions across 24 suites**, including real `SIGKILL` crash tests, a
  multi-process concurrency storm, and replay-equivalence checks
- real-model validation against a live 31B model, including crash-and-resume at 25/50/75% of a
  task with **zero duplicate effects**
- CI on Node 22 and 24, Ubuntu and Windows

**No developer outside this project has used it.** No claim is made about product-market fit,
demand, or adoption.

The strongest argument against the project is recorded rather than hidden: the largest agent user
base among the systems audited runs with **no run-level durability at all**, and its users cope.

A second finding is worth stating plainly. Across the capability work, the infrastructure-defect
ledger reached **21 defects, of which ~16 first presented as agent or task failures** and only 2
were genuine task defects. That ratio is the most reproducible result here — and it is a finding
about the *instrument*, not the agent.

## Documentation

| | |
|---|---|
| [v0/README.md](v0/README.md) | the runtime itself — install, commands, guarantees |
| [v0/docs/](v0/docs/) | architecture · recovery · replay · forking · tools · model adapters · security |
| [v0/ADRs/](v0/ADRs/) | 13 architecture decision records — each with the evidence that forced it |
| [v0/CONTRIBUTING.md](v0/CONTRIBUTING.md) | the rule that keeps the core small |
| [research/](research/) | audits, capability benchmarks, and productization records |

## License

[Apache-2.0](v0/LICENSE).
