# B4 — CLI Output Architecture + `--json`

## Wave-2 deferral, revisited

Wave 2 deferred `--json` on the grounds that "every command writes human-formatted text directly to
stdout via `console.log`; adding `--json` would mean interleaving two output modes in the same
paths."

That was correct **as a blanket statement about all twelve commands**, and wrong as a reason to skip
the three where it is clean. Re-examined:

| command | shape | JSON feasible cleanly? |
|---|---|---|
| `status` | one call to `summarise()` over `project()` state | **yes** |
| `replay` | banner + `summarise()` over `r.state` | **yes** |
| `list` | loop rendering rows from `store.listRuns()` + `project()` | **yes** |
| `run`, `resume` | **streaming live progress** interleaved with model/tool execution | **no** |
| `explain` | a sequenced narrative renderer, inherently prose | **no** |
| `fork` | banner + conditional warnings | **no** — the warnings are the value |
| `doctor`, `answer`, `reap`, `rerun` | short operational messages | not useful |

The three implemented all derive from **already-structured state** — `project()`, `store.run()`,
`store.listRuns()`. The data was structured; only the rendering was text-first. Nothing was
retrofitted onto unstructured output.

## Implementation

One helper beside the existing flag helper:

```js
const has = (args, name) => args.includes(name);
const emitJson = (obj) => console.log(JSON.stringify(obj, null, 2));
```

Each JSON path **returns early** rather than rendering both forms. That is the rule that makes
`--json` usable: stdout carries JSON *alone* — no banner, no colour, no framing.

## Verified

Piped through a strict JSON parser:

| command | stdout parses? | type |
|---|---|---|
| `status <run> --json` | **yes** | object |
| `replay <run> --json` | **yes** | object |
| `list --json` | **yes** | array |

Human output without `--json` is **byte-identical to before**. Exit codes unchanged (`0`).

### `status --json`

```json
{
  "run_id": "run_a6ec04b992",
  "status": "completed",
  "exit_reason": "model_finished",
  "events": 28,
  "task": "Fix the bug in calc.py: add() should return a + b, not a - b",
  "parent_run_id": null,
  "forked_from_seq": null,
  "turns": 1, "model_calls": 4, "tool_calls": 3,
  "tokens": { "input": 2561, "output": 937 },
  "cost_usd": 0,
  "awaiting_human": []
}
```

### `replay --json`

Carries `"model_calls_made": 0` explicitly — the product's central claim, made machine-checkable
rather than only stated in a banner.

### `list --json`

Array of runs including `parent_run_id` / `forked_from_seq`, so fork lineage is machine-readable.

## Not done, deliberately

- **No `--json` on `run`/`resume`.** They stream live progress during execution; emitting JSON
  would mean either buffering the whole run (destroying the live feedback that makes them useful)
  or interleaving objects with progress lines. Deferred with a reason, not skipped.
- **No output-formatter framework.** Two helper lines, three call sites. A formatter abstraction
  for three commands would be speculative generality.
- **No change to `explain`.** It is a narrative renderer; its value *is* the prose. The same
  underlying data is available structurally via `Store.events()` in the public API.

## Regression

```
TOTAL: 608 passed, 0 failed across 23 suites
```

Baseline preserved.

## Documentation

CLI `--help` and the README both mark `[--json]` on the three supported commands, and the README
states plainly that other commands remain human-formatted.
