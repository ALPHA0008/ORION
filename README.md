# harness

**A durable agent runtime, and the research that produced it.**

Run an agent. Kill the process. Start it again — it continues from where it stopped. Then inspect
exactly what it did, and branch from any point in its history.

```
$ harness run "fix the bug in src/calc.js and verify"
  ✓ read src/calc.js
  ✓ edit edited src/calc.js
  ✕ Process terminated

$ harness resume #045abc
resuming from event 21…
  ♻ Recovered from event #21 — write: skip
  ✓ bash → PASS
✓ model_finished
```

This repository contains two things:

| | |
|---|---|
| **`v0/`** | the harness — ~2,300 LOC, **zero dependencies**, no build step |
| **`research/`** | the source-level audit and experiments it was derived from |

---

## Start here

**[PROJECT-JOURNEY.md](PROJECT-JOURNEY.md)** — how this got built, in what order, and why.
Read it first if you are new to the project.

**[V0-READINESS.md](V0-READINESS.md)** — current status, what is proven, what is not.

---

## Quick start

```bash
cd v0
node --version                # needs Node 24+ (uses the built-in node:sqlite)
node tests/run-all.mjs        # 310 assertions, ~53s, no credentials needed
```

To drive a real model, point it at any OpenAI-compatible endpoint:

```bash
export HARNESS_BASE_URL=https://api.openai.com/v1
export HARNESS_API_KEY=sk-...
export HARNESS_MODEL=gpt-4o-mini

node src/cli/index.mjs doctor
node src/cli/index.mjs run "inspect this repo and fix the failing test"
node src/cli/index.mjs explain <run>
```

Credentials are read from the environment only and are never written to disk.

---

## What makes it different

**Crash recovery that knows what it doesn't know.** When a process dies between a tool's effect and
the record of it, the runtime asks the tool: *did this land?* A file write is checked by hashing; an
edit by looking for its own precondition. When a tool cannot tell — `curl -X POST`, say — the run
**pauses and asks you** rather than guessing. It never silently duplicates a side effect.

**Three verbs that are genuinely different.** `replay` reconstructs history with **zero** model
calls. `fork` inherits history to a point, then diverges. `rerun` starts fresh. With a
nondeterministic model that distinction is the difference between a fact and a fresh guess.

**Nothing degrades silently.** Every fallback emits a `degraded` event — including retries inside
the model client and provider shims that rewrite a response. Status is derived from counted
effects, so a broken path cannot report itself healthy.

**Stalls are diagnosed, not just stopped.** A run that repeats itself terminates as `no_progress`
with the reason attached, not as an anonymous `max_turns`.

---

## Status

**READY_FOR_DEVELOPER_VALIDATION** — technically validated, commercially unproven.

- 310 regression assertions across 9 suites, including real `SIGKILL` crash tests and a 6-process
  concurrency storm
- 95 real-model assertions against a live 31B model, including crash-and-resume at 25/50/75% of a
  task with **zero duplicate effects**
- **No developer has used this.** No claim is made about product-market fit, demand, or adoption.

The strongest argument against the project is recorded in the docs rather than hidden: the largest
agent user base among the systems we audited runs on a harness with **no run-level durability at
all**, and its users cope.

---

## Documentation

| | |
|---|---|
| [v0/README.md](v0/README.md) | the harness itself |
| [v0/docs/](v0/docs/) | architecture · recovery · replay · forking · tools · model adapters · security |
| [v0/ADRs/](v0/ADRs/) | 10 architecture decision records — every change and the evidence that forced it |
| [v0/CONTRIBUTING.md](v0/CONTRIBUTING.md) | the rule that keeps the core small |
| [research/FINDINGS.md](research/FINDINGS.md) | the audit of QM, Hermes and Ruflo |
| [research/real-model/](research/real-model/) | real-model validation results |

## Licence

Not yet chosen. Treat as all-rights-reserved until one is added.
