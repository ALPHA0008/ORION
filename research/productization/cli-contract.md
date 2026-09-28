# CLI Contract — Audit of What Exists

`v0/src/cli/index.mjs` (249 ln). **12 commands already implemented.** This audits them rather than
designing an imagined CLI.

## Current surface

| command | purpose | inputs | outputs | status |
|---|---|---|---|---|
| `run "<task>"` | start a run in the cwd | task string | run id, live tool trace, terminal status | **IMPLEMENTED** — verified live |
| `list` | all runs | — | id, status, events, when, task, fork lineage | **IMPLEMENTED** — verified |
| `status <run>` | where a run got to | run id | status, counts, tokens, messages, awaiting, in-flight | **IMPLEMENTED** — verified |
| `resume <run>` | continue after crash or answer | run id | continued run | **IMPLEMENTED** |
| `answer <run> <reply>` | answer a pending question | run id, text | resumes | **IMPLEMENTED** |
| `explain <run>` | what the run did | run id, `--verbose`, `--full` | sequenced trajectory | **IMPLEMENTED** — verified |
| `replay <run>` | reconstruct history | run id, `--at <seq>` | state, no model calls | **IMPLEMENTED** — verified |
| `fork <run> --at <seq>` | branch from a point | run id, seq | new run id + warnings | **IMPLEMENTED** — verified |
| `rerun <run>` | fresh run, same task | run id | new run | **IMPLEMENTED** |
| `reap` | reclaim dead workers' runs | — | reclaimed count | **IMPLEMENTED** |
| `doctor` | environment check | — | home, db, runs, endpoint, key, posture, leases, integrity | **IMPLEMENTED** — verified |
| `help` / `--help` / `-h` | usage | — | usage text | **IMPLEMENTED** — verified |

Configuration is env-only: `HARNESS_BASE_URL`, `HARNESS_API_KEY`, `HARNESS_MODEL`, `HARNESS_HOME`,
`HARNESS_POSTURE` — and the usage text documents them.

## Exit codes

| code | meaning |
|---|---|
| `0` | success (incl. `--help`) |
| `1` | command threw — message printed in red |
| `2` | unknown command; usage printed |

Consistent and scriptable. `run` exits `0` even when the run *pauses* — correct, since a pause is a
valid terminal state for the invocation, not a failure.

## Observed quality

The CLI is more finished than the rest of the packaging. Three examples from live use:

1. **`fork` warns about mid-turn splits** and proposes a clean boundary (`--at 5`) instead of
   silently creating a corrupt fork.
2. **`fork` names its own limitation** — "the WORKSPACE is not rewound automatically."
3. **`run` prints next actions on pause** — `resume with:` / `history:` with the exact commands.

## Gaps

| gap | severity | note |
|---|---|---|
| **not installed as a binary** | **blocking** | invoked as `node v0/src/cli/index.mjs`; no `package.json`/`bin` |
| no `--json` output | medium | everything is human-formatted; scripting requires parsing prose |
| no `--version` | low | trivial, needs `package.json` |
| `doctor` cannot check the model endpoint | low | reports `NOT SET`, does not probe reachability |
| no config file | low | env-only is defensible for v0.1 |

## Smallest coherent public surface for v0.1

All twelve should ship — they are implemented and tested. Ordered for documentation:

**Core loop:** `run` · `status` · `list` · `resume` · `answer`
**Trajectory:** `explain` · `replay` · `fork` · `rerun`
**Ops:** `doctor` · `reap`

The only required change is **invocability**: `harness <cmd>` instead of
`node v0/src/cli/index.mjs <cmd>`. That is a `package.json` `bin` entry, not CLI work.

## Recommendation

Do **not** redesign the CLI in Wave 2. Add `--json` to `status`/`list`/`explain` for scripting, add
`--version`, and make it installable. The command *names* are already good and match the conceptual
operations (`run`, `resume`, `inspect`≈`status`, `replay`, `fork`).
