<!-- markdownlint-disable MD033 MD041 -->

<!-- npm renders this README from the registry, where relative paths do not resolve — so the
     banner and every badge target must be an absolute URL. -->
<p align="center">
  <img src="https://raw.githubusercontent.com/ALPHA0008/ORION/main/docs/assets/orion-banner.svg" alt="Orion — durable, replayable agent runs" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kernlbase/orion"><img src="https://img.shields.io/npm/v/@kernlbase/orion?style=flat" alt="npm"></a>
  <a href="https://github.com/ALPHA0008/ORION/blob/main/v0/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat" alt="License"></a>
  <a href="https://github.com/ALPHA0008/ORION/actions"><img src="https://github.com/ALPHA0008/ORION/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ALPHA0008/ORION/blob/main/v0/README.md#requirements"><img src="https://img.shields.io/badge/node-%E2%89%A522-blue?style=flat" alt="Node"></a>
  <a href="https://github.com/ALPHA0008/ORION/blob/main/v0/README.md#requirements"><img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat" alt="Dependencies"></a>
</p>

<p align="center">
  <a href="https://github.com/ALPHA0008/ORION/blob/main/v0/docs/ARCHITECTURE.md"><strong>Architecture</strong></a> ·
  <a href="https://github.com/ALPHA0008/ORION/blob/main/v0/docs/RECOVERY.md"><strong>Recovery</strong></a> ·
  <a href="https://github.com/ALPHA0008/ORION/blob/main/v0/docs/REPLAY.md"><strong>Replay</strong></a> ·
  <a href="https://github.com/ALPHA0008/ORION/blob/main/v0/docs/TOOLS.md"><strong>Tools</strong></a> ·
  <a href="https://github.com/ALPHA0008/ORION/blob/main/v0/docs/SECURITY.md"><strong>Security</strong></a> ·
  <a href="https://github.com/ALPHA0008/ORION/tree/main/v0/ADRs"><strong>ADRs</strong></a>
</p>

---

# Orion — durable, replayable agent runs

Orion is a runtime for agent runs that survive the process that started them. Every model call,
tool invocation and decision is appended to a log, so a killed run resumes from where it stopped —
without re-applying side effects it already performed.

This is **runtime infrastructure**, not a coding agent competing on benchmark scores. See
[What this is and is not](#what-this-is-and-is-not).

- 🔁 **Zero-cost replay** — reconstruct any run's history with no model calls at all
- 💾 **Durable by default** — `SIGKILL` the process; `orionctl resume` continues the run
- 🧰 **Honest recovery** — each tool declares what can be verified about its effect, and
  unverifiable effects escalate instead of silently retrying
- 🌱 **Fork from any point** — branch a run's history at event *N* and diverge
- 🔍 **Inspectable** — a closed set of **31 event types**, readable as a plain narrative
- 📦 **Library + CLI** — embed the runtime, or drive it from the terminal
- 🪶 **Zero dependencies** — Node's built-in `node:sqlite`, no build step

## Quick start

```bash
npm install -g @kernlbase/orion

export ORION_BASE_URL=https://api.openai.com/v1
export ORION_API_KEY=sk-...
export ORION_MODEL=gpt-4o-mini

orionctl doctor
orionctl run "fix the failing test in calc.py"
```

Or without installing anything: `npx @kernlbase/orion doctor`

New to it? [`examples/quickstart`](examples/quickstart/) walks through install → run → explain →
replay → fork, with real recorded transcripts.

## Interactive mode

Run `orionctl` with no arguments:

```console
$ orionctl

  █████ ████  █████ █████ █   █
  █   █ █   █   █   █   █ ██  █
  █   █ ████    █   █   █ █ █ █
  █   █ █  █    █   █   █ █  ██
  █████ █   █ █████ █████ █   █

  Orion v0.1.2  — durable, replayable agent runs

  /help commands  │  /runs history  │  /exit quit
  ──────────────────────────────────────────────

  model: gpt-4o-mini   posture: auto
  workspace: /home/me/project

  enter send   / commands   ctrl+c exit

> add retries to the fetch helper
  #a81f2c
  ✓ read src/fetch.ts
  ✓ edit edited src/fetch.ts
  ✓ model_finished
>
```

`/help` `/runs` `/resume` `/answer` `/clear` `/exit`.

The wordmark uses block glyphs on any modern terminal — Windows Terminal, PowerShell, cmd.exe
(Windows 10 1903+), and every mainstream Unix terminal — and falls back to plain ASCII on older
consoles. `ORION_ASCII=1` forces the fallback; `ORION_ASCII=0` forces the blocks.

The session is a **thin shell over the same event log**, not a second execution model. Every task
you type becomes an ordinary run — so you can close the terminal mid-task and pick it up from
anywhere:

```console
$ orionctl list          # the run typed in the session is right there
$ orionctl resume #a81f2c
```

`Ctrl+C` aborts the *turn*, never the run.

## The core demonstration

An agent run is a durable object. Kill it and it continues:

```console
$ orionctl run "add retries to the fetch helper"
Run #a81f2c  /home/me/project
────────────────────────────────────────────────
  ✓ read src/fetch.ts
  ✓ edit edited src/fetch.ts
  ✕ Process terminated

$ orionctl resume #a81f2c
resuming from event 23…
  ♻ Recovered from event #23 — edit: skip
  ✓ bash npm test → 12 passing
✓ model_finished
```

The `edit: skip` line is the whole point. On resume the runtime asked the `edit` tool *did this
already land?* — the tool checked, found its change present, and declined to apply it twice.

Then reconstruct what happened, for free:

```console
$ orionctl replay #a81f2c
replayed 31 events · 0 model calls
```

## Installation

### Install the CLI

```bash
npm install -g @kernlbase/orion
orionctl --version
```

### Add the library

```bash
# or `pnpm add` / `yarn add`
npm install @kernlbase/orion
```

### Run without installing

```bash
npx @kernlbase/orion --help
```

> [!NOTE]
> The package is `@kernlbase/orion`; the command it installs is **`orionctl`**. Always use the
> scoped package name — the unscoped `orion` on npm is an unrelated project.

## Configure

Any OpenAI-compatible endpoint.

| variable | required | default |
|---|---|---|
| `ORION_BASE_URL` | **yes** | — |
| `ORION_MODEL` | recommended | `gpt-4o-mini` |
| `ORION_API_KEY` | provider-dependent | falls back to `OPENAI_API_KEY` |
| `ORION_HOME` | no | `~/.orion` |
| `ORION_WORKSPACE` | no | current directory |
| `ORION_POSTURE` | no | `auto` (`permissive` · `auto` · `strict`) |

Local providers work identically — Ollama, vLLM, LM Studio:

```bash
export ORION_BASE_URL=http://localhost:11434/v1
export ORION_MODEL=qwen3:8b
export ORION_API_KEY=not-needed
```

`orionctl doctor` reports home, database integrity, run count, endpoint, posture, stale leases and
pending questions.

### Configuration files

The non-secret parts can be committed. `.orion.json` in the project, `~/.orion/config.json` for
your user — layered **under** the environment, which always wins.

```json
{
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "apiKeyEnv": "ORION_API_KEY"
}
```

**The key itself never goes in the file.** `apiKeyEnv` names the *variable* that holds it; writing
`apiKey` is refused, because a config file is meant to be committed. Unknown keys are errors rather
than being ignored — a typo'd setting you believe is in force is worse than one that fails loudly.

`orionctl config` prints the effective configuration and where every value came from:

```
effective configuration:
  baseUrl      https://api.openai.com/v1     project (./.orion.json)
  model        gpt-4o-mini                   env ORION_MODEL
  apiKey       (set)                         env ORION_API_KEY
```

The key's **value is never printed** — only whether it is set, and which variable was read.

### Permission rules

`.orion-rules.json` (project) or `~/.orion/rules.json` (user) tighten policy without touching code:

```json
{
  "denyTools": ["bash"],
  "denyCommandPatterns": ["\\bgit\\s+push\\b"],
  "protectedPaths": ["(^|/)migrations/"],
  "escalateTools": ["write"]
}
```

Rules may only **raise** strictness. There is no `allowTools` — to widen access, choose a sandbox
that earns a more permissive posture (`ORION_SANDBOX=container`) or record an auditable grant
(`orionctl answer --remember`). User and project rules **union**; they never override each other,
and they never displace the built-in refusal of catastrophic commands.

A malformed rule file **refuses the run** rather than degrading to weaker policy than you wrote.

### MCP servers

Declare servers in `.orion.json` and their tools join the toolset the model is offered:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": ["GITHUB_TOKEN"]
    }
  }
}
```

Their tools appear as `mcp__github__<tool>`. They are ordinary tools from every other angle: they
go through the authorizer (`denyTools: ["mcp__github__create_issue"]` works), they are recorded in
the trajectory with provenance, and `explain` shows which server produced each result.

**`env` lists variable NAMES, never values.** Other MCP clients accept `{"TOKEN": "value"}` here;
this one refuses it, because the file is meant to be committed. The server receives a minimal base
environment plus exactly the variables you named — not your whole environment.

**Where the server runs.** With `ORION_SANDBOX=container` the server is started *inside* the run's
container, so it inherits `--network none` and the CPU/memory/PID limits without MCP having to
enforce anything itself. On the local sandbox there is no such boundary and the runtime says so
rather than implying isolation it does not have.

Every MCP tool is declared **`Mutating`** and **`UNSAFE` to re-issue**. The harness cannot know what
third-party code does — a server tool called `get_issue` may post a comment — so it never
auto-allows one at a strict posture and never silently retries one after a crash.

MCP needs the optional `@modelcontextprotocol/sdk`. It is the project's only dependency, declared
in `optionalDependencies` at an exact pin; `dependencies` stays empty. Without it, MCP degrades
(recorded as a `degraded` event) and the run continues on built-in tools.

## Commands

```
orionctl                        interactive session
orionctl run "<task>"           start a run in the current directory
orionctl list                   all runs                        [--json]
orionctl status <run>           where a run got to              [--json]
orionctl resume <run>           continue after a crash, or after answering a question
orionctl answer <run> <reply>   answer a question the run is waiting on
orionctl explain <run>          what the run actually did      [--verbose] [--full]
orionctl replay <run>           reconstruct history   [--at <seq>] [--json]
orionctl fork <run> --at <seq>  branch from a point in history
orionctl rerun <run>            fresh run of the same task
orionctl reap                   reclaim runs whose worker died
orionctl doctor                 environment check
orionctl config                 effective configuration + rules, and where each came from [--json]
orionctl --version              package version
```

Exit codes: `0` success · `1` unexpected failure · `2` usage or configuration error.

`--json` on `list`, `status` and `replay` prints **only** JSON to stdout — no banner, no colour — so
it pipes straight into `jq`.

## Core guarantees

- **Deterministic replay.** `replay` makes **zero** model calls. It folds the event log back into
  state, so it is free, instant, and reproduces what actually happened rather than what would
  happen now. See [REPLAY](docs/REPLAY.md).

- **Recovery is per-tool, and honest about what it cannot know.** After a crash the runtime does
  not blindly retry. Each tool is classified by what can be verified about its effect, and the
  answer is `SKIP`, `REISSUE` or `ESCALATE`:
  - `write` carries a runtime-captured **pre-state witness**, so it distinguishes *never applied*
    (re-issue), *applied* (skip), and *applied then changed by someone else* (**escalate**).
  - `edit` needs no witness — its precondition is the pre-state, so a re-issued edit self-rejects.
  - `bash` **cannot** be verified. Every mutating shell command is classified `UNSAFE` and
    escalates rather than being retried. Uncertain, but never silently duplicated.

  See [RECOVERY](docs/RECOVERY.md) and [TOOLS](docs/TOOLS.md).

- **Pauses are durable, not blocking.** When an agent calls `ask_user` the run pauses in the log and
  the process exits. It stays claimable — answer it hours later, from another shell.

- **Forking branches history, not the filesystem.** `fork` branches the event log at a point you
  choose. It does **not** rewind your working directory; the CLI says so when you fork.
  See [FORKING](docs/FORKING.md).

- **A closed event vocabulary.** Exactly **31 event types**, frozen. Payloads gain fields
  additively; the type set does not grow. This is what keeps replay stable.

- **Execution fencing.** A run is owned by one worker at a time via a lease, so a resumed worker
  cannot be overtaken by a zombie predecessor. See
  [ADR-008](ADRs/ADR-008-execution-fencing.md).

## Pause, answer, resume

```console
$ orionctl run "migrate the auth module"
  🙋 asked: "Should I keep the legacy token format?"
paused — awaiting_human
  resume with:  orionctl resume #a81f2c

$ orionctl answer #a81f2c "yes, keep it"
$ orionctl resume #a81f2c
```

## Tools

| tool | effects | what it does |
|---|---|---|
| `read` | read-only | a file, paged |
| `glob` | read-only | find files by pattern — `src/**/*.ts`, `{a,b}`, `?`, `[abc]` |
| `grep` | read-only | search contents; literal by default, `regex: true` opts in |
| `git` | read-only | `status` · `diff` · `branch` · `log` · `blame` |
| `write` `edit` | **mutating** | change a file |
| `bash` | **mutating** | run a command |
| `verify` | read-only | run a check |
| `plan` `plan_step` | read-only | declare and advance a plan |
| `ask_user` | read-only | pause the run durably for a human |
| `mcp__<server>__<tool>` | **mutating** | whatever a declared MCP server advertises (see above) |

`grep` stays **literal unless you ask for a regex**, so `a.b` finds `a.b` and not `axb` — a pattern
written before this existed still means what it meant. A malformed regex is an error, never a silent
empty result: "no matches" is an answer, and a wrong one.

Search and git are **bounded, and say so**. Walks stop at 5 s (750 ms per directory), 20 000 files
read, 100 000 entries traversed, depth 24; `.git`, `node_modules` and `.orion` are skipped; git
output is clamped at 32 KB. Whenever a bound bites, the result carries `[INCOMPLETE RESULT]` naming
the budget that stopped it — a short list is never mistaken for a complete one.

Git navigation is **read-only**. The runtime already maintains a shadow repository to rewind the
world during recovery; a `commit` or `checkout` tool would drive the same working tree with a
different notion of HEAD, and getting that wrong destroys a working tree rather than returning a
wrong answer.

## The three verbs, precisely

They differ, and the difference matters once the model is nondeterministic:

| | model calls | what you get |
|---|---|---|
| **replay** | **0** | the historical state, reconstructed exactly |
| **fork** | new | a new run inheriting history to a point, then diverging |
| **rerun** | new | a fresh run of the same task, sharing nothing |

## Programmatic use

```js
import { Store, replay, explain, createOpenAICompatModel } from '@kernlbase/orion';

const store = new Store('./orion.db');
console.log(explain(store, runId));          // what happened, as a narrative
const { state } = replay(store, runId);      // reconstruct — no model calls
```

Subpath exports: `/store` `/events` `/replay` `/explain` `/model` `/tools` `/sandbox` `/auth`
`/recovery` `/worker`.

## Requirements

- **Node ≥ 22.** The runtime uses the built-in `node:sqlite` — no native module to compile, no
  build step.
- **`git` on `PATH`.** Workspace checkpoints use a bare shadow repository, kept separate from your
  own `.git`.
- **A shell.** On Windows, `bash` from Git for Windows. `orionctl doctor` reports a missing shell
  with a fix rather than failing obscurely.
- **Zero third-party dependencies.** `npm install` fetches nothing but this package.

Tested on Node 22 and 24, on Ubuntu and Windows, in CI.

## What this is and is not

**It provides:**

- durable, append-only run history over a closed set of **31 event types**
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
instructions — but Orion will read whatever you point it at. See [SECURITY](docs/SECURITY.md).

## Tests

```bash
node tests/run-all.mjs
```

**654 assertions across 24 suites**, including real `SIGKILL`s at multiple points in the agent loop,
a multi-process concurrency storm, and replay-equivalence checks. No test framework.

## Versions

`0.x` — the public API and the CLI surface may still change between minor versions.

Two things are treated as contracts even now:

- **The event type set is closed at 31.** Payloads gain fields additively; the type set does not
  grow without a major version.
- **Replay is backward-compatible within a minor version.** A log written by `0.1.x` replays under
  any later `0.1.x`.

## Documentation

| document | what it covers |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | the event log, projection, and the agent loop |
| [RECOVERY](docs/RECOVERY.md) | recovery classes and the decision procedure |
| [REPLAY](docs/REPLAY.md) | replay semantics and what it guarantees |
| [FORKING](docs/FORKING.md) | forking history, and what forking does *not* do |
| [TOOLS](docs/TOOLS.md) | each tool's contract and verification story |
| [MODEL-ADAPTERS](docs/MODEL-ADAPTERS.md) | the OpenAI-compatible adapter and quirk shims |
| [SECURITY](docs/SECURITY.md) | the containment model and its limits |
| [ADRs/](ADRs/) | 13 decision records, each with the evidence that forced it |

## Contributing

Issues and pull requests are welcome at
[github.com/ALPHA0008/orion](https://github.com/ALPHA0008/orion).

Run `node tests/run-all.mjs` before opening a PR — all 654 assertions must pass on Node ≥ 22.

## License

[Apache-2.0](LICENSE).
