# @kernlbase/harness

**An inspectable, recoverable, replayable, trajectory-native agent harness.**

An agent run is a durable object. Kill the process and it continues from where it stopped. Read
exactly what it did. Reconstruct it for free. Branch from any point in its history.

This is **runtime infrastructure**, not a coding agent competing on benchmark scores. See
[What this is and is not](#what-this-is-and-is-not).

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
npm install -g @kernlbase/harness
harness --version
```

**Requires Node ≥ 22** — the runtime uses the built-in `node:sqlite`. There are **no third-party
dependencies** and no build step.

`git` must be on `PATH`: workspace checkpoints use a bare shadow repository, kept separate from
your own `.git`.

## Configure

Any OpenAI-compatible endpoint.

```bash
export HARNESS_BASE_URL=https://api.openai.com/v1
export HARNESS_API_KEY=sk-...
export HARNESS_MODEL=gpt-4o-mini
harness doctor
```

Local providers work the same way — Ollama, vLLM, LM Studio:

```bash
export HARNESS_BASE_URL=http://localhost:11434/v1
export HARNESS_MODEL=qwen3:8b
export HARNESS_API_KEY=not-needed
```

| variable | required | default |
|---|---|---|
| `HARNESS_BASE_URL` | **yes** | — |
| `HARNESS_MODEL` | recommended | `gpt-4o-mini` |
| `HARNESS_API_KEY` | provider-dependent | falls back to `OPENAI_API_KEY` |
| `HARNESS_HOME` | no | `~/.harness` |
| `HARNESS_WORKSPACE` | no | current directory |
| `HARNESS_POSTURE` | no | `auto` (`permissive` · `auto` · `strict`) |

`harness doctor` reports home, database integrity, run count, endpoint, posture, stale leases and
pending questions.

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
harness --version              package version
```

Exit codes: `0` success · `1` unexpected failure · `2` usage or configuration error.

## Pause, answer, resume

When the agent needs a human it calls `ask_user`. The run **pauses durably** rather than blocking a
process, and stays claimable:

```bash
$ harness run "migrate the auth module"
  🙋 asked: "Should I keep the legacy token format?"
paused — awaiting_human
  resume with:  harness resume #a81f2c

$ harness answer #a81f2c "yes, keep it"
$ harness resume #a81f2c
```

## The three verbs, precisely

They differ, and the difference matters once the model is nondeterministic:

| | model calls | what you get |
|---|---|---|
| **replay** | **0** | the historical state, reconstructed exactly |
| **fork** | new | a new run inheriting history to a point, then diverging |
| **rerun** | new | a fresh run of the same task, sharing nothing |

`replay` never calls a model, so it is free, instant, and reproduces what actually happened.

`fork` branches **history**. It does **not** rewind your working directory — run a fork in a fresh
workspace, or restore a checkpoint first. The CLI says so when you fork.

## Recovery

When a process dies between a tool's effect and the record of it, the runtime asks the tool *did
this land?*

- **`write`** carries a runtime-captured pre-state witness, so it distinguishes *never applied*
  (re-issue), *applied* (skip) and *applied then changed by someone else* (**escalate**).
- **`edit`** needs no witness — its precondition is the pre-state, so a re-issue self-rejects.
- **`bash`** cannot be verified. Every mutating shell command is classified `UNSAFE` and
  **escalates** rather than being retried. Uncertain, but never silently duplicated.

Tools do not all carry the same guarantees, and the runtime does not pretend otherwise. See
[docs/TOOLS.md](docs/TOOLS.md).

## Programmatic use

```js
import { Store, replay, explain, createOpenAICompatModel } from '@kernlbase/harness';

const store = new Store('./harness.db');
console.log(explain(store, runId));          // what happened
const { state } = replay(store, runId);      // reconstruct — no model calls
```

Subpath exports: `/store` `/events` `/replay` `/explain` `/model` `/tools` `/sandbox` `/auth`
`/recovery` `/worker`.

## What this is and is not

**It provides:**

- durable, append-only run history over a **closed set of 31 event types**
- crash recovery with per-tool verification and honest escalation
- zero-cost replay and history forking
- human-readable explanation of any run
- bounded tool output and context projection
- an authorization seam: `authorize(action, context) → allow | deny | escalate`

**It does not claim:**

- frontier coding-agent performance, or benchmark leadership of any kind
- universal model compatibility — one OpenAI-compatible adapter, plus optional quirk shims
- OS or container isolation — the sandbox enforces **path containment** (including symlink escape)
  and bounded output, **not** kernel-level isolation. `bash` runs with your privileges.
- autonomous subagent orchestration, memory systems, or planning frameworks
- enterprise fleet governance, centralized audit, or multi-tenancy

The runtime is well tested. **How capable the agent is depends on the model you point it at**, and
this project makes no claim about that.

## Security

Path containment with symlink-escape rejection, bounded tool output, secret scrubbing from the tool
environment, three authorization postures with hard denials that apply even in `permissive`, and
redaction in trajectory output.

This is **not** a sandbox against hostile code. Repository contents are treated as data, never as
instructions — but the harness will read whatever you point it at. See
[docs/SECURITY.md](docs/SECURITY.md).

## Docs

[ARCHITECTURE](docs/ARCHITECTURE.md) · [RECOVERY](docs/RECOVERY.md) · [REPLAY](docs/REPLAY.md) ·
[FORKING](docs/FORKING.md) · [TOOLS](docs/TOOLS.md) · [MODEL-ADAPTERS](docs/MODEL-ADAPTERS.md) ·
[SECURITY](docs/SECURITY.md) · [ADRs/](ADRs/) — 13 decision records, each with the evidence that
forced it.

## Tests

```bash
node tests/run-all.mjs
```

**608 assertions across 23 suites**, including real `SIGKILL`s at multiple points in the agent loop,
a multi-process concurrency storm, and replay-equivalence checks. No test framework.

## Example

[examples/quickstart](examples/quickstart/) — install → configure → run → explain → replay.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
