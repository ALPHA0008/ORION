# harness

**Durable agent runs you can replay and fork.**

Run an agent. Kill the process. Start it again — it continues from where it stopped.
Then look at exactly what it did, and branch from any point in its history.

```bash
$ harness run "add retries to the fetch helper"
Run #a81f2c  /home/me/project
────────────────────────────────────────────────
  ✓ read src/fetch.ts
  ✓ edit edited src/fetch.ts
  ✕ Process terminated

$ harness resume #a81f2c
resuming from event 23…
  ♻ Recovered from event #23 — edit: skip
  ✓ bash npm test → 12 passing
✓ model_finished
```

## Install

```bash
git clone <repo> && cd harness
node --version            # needs Node 24+ (uses the built-in node:sqlite)
export HARNESS_BASE_URL=https://api.openai.com/v1     # any OpenAI-compatible endpoint
export HARNESS_API_KEY=sk-...
export HARNESS_MODEL=gpt-4o-mini
node src/cli/index.mjs doctor
```

No build step. No dependencies.

## Commands

```
harness run "<task>"           start a run in the current directory
harness list                   all runs
harness status <run>           where a run got to
harness resume <run>           continue after a crash, or after answering a question
harness answer <run> <reply>   answer a question the run is waiting on
harness explain <run>          what the run actually did      [--verbose] [--full]
harness replay <run>           reconstruct history            [--at <seq>]
harness fork <run> --at <seq>  branch from a point in history
harness rerun <run>            fresh run of the same task
harness reap                   reclaim runs whose worker died
harness doctor                 environment check
```

## The three verbs, precisely

They are different, and the difference matters once the model is nondeterministic:

| | model calls | what you get |
|---|---|---|
| **replay** | **0** | the historical state, reconstructed exactly |
| **fork** | new | a new run that inherits history up to a point, then diverges |
| **rerun** | new | a fresh run of the same task, sharing nothing |

`replay` never calls a model, so it is free, instant, and always reproduces what actually happened.

## What makes this different

**Crash recovery that knows what it doesn't know.** When a process dies between a tool's effect and
the record of it, the runtime asks the tool: *did this land?* A file write is checked by hashing.
An edit is checked by looking for its own precondition. When a tool cannot tell — `curl -X POST`,
say — the run **pauses and asks you** rather than guessing. It never silently duplicates a side
effect.

**Nothing degrades silently.** Every fallback emits a `degraded` event. Status is derived from
counted effects, so a broken path cannot report itself healthy.

**Stalls are diagnosed, not just stopped.** A run that repeats itself terminates as `no_progress`
with the reason attached — not as an anonymous `max_turns`.

## Status

**V0 — technically hardened, not yet validated with developers.** 268 automated assertions across
7 suites, including real `SIGKILL`s at 8 points in the agent loop and a 6-process concurrency storm.

**Not yet tested against a real language model** (see `research/v0-hardening/real-model-results.md`).
**Single-user and local.** Not multi-tenant, not a security boundary against hostile code.

## Docs

`docs/ARCHITECTURE.md` · `docs/RECOVERY.md` · `docs/REPLAY.md` · `docs/FORKING.md` ·
`docs/TOOLS.md` · `docs/MODEL-ADAPTERS.md` · `docs/SECURITY.md` · `ADRs/`

## Tests

```bash
node tests/run-all.mjs
```
