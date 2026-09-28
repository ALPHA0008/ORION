# Trajectory Surface — inspect / replay / fork / explain

**The question this answers:** *can a developer actually understand and manipulate an agent run as a
first-class object?*

**Answer: yes, today, from the CLI.** Everything below was executed during this audit against a
real run.

## The four operations

| operation | works today | CLI | API | limitations |
|---|---|---|---|---|
| **inspect** | **yes** | `status <run>`, `list` | `Store`, `project()` | — |
| **explain** | **yes** | `explain <run>` `[--verbose] [--full]` | `explain()`, `summarise()`, `redact()` | renders *what*, not *why* |
| **replay** | **yes** | `replay <run>` `[--at <seq>]` | `replay()`, `verifyProjectionEquivalence()` | reconstruction only — does not re-execute tools |
| **fork** | **yes** | `fork <run> --at <seq>` | `fork()`, `nearestTurnBoundary()`, `rerun()` | **workspace is not rewound automatically** |

## Executed evidence

### `status` — a run is a queryable object

```
Run run_95044d62bb
  status      paused (awaiting_human)
  events      17
  turns       1   model calls 2   tool calls 1
  tokens      1987 (in 1188 / out 799)
  messages    4 total, 4 hot, 0 archived
  AWAITING    hr_69b1c1abe6: "The file 'calc.py' is not found or is a directory…"
  in-flight   1 tool call(s)
```

Note `messages 4 total, 4 hot, 0 archived` — the bounded projection (ADR-001) is *visible to the
operator*, not hidden.

### `explain` — a sequenced, readable trajectory

```
 1  05:33:36  · run created (scope personal:local)
 3  05:33:36  ▸ task: Fix the bug in calc.py…
 6  05:33:49  🧠 wants 1 tool call: grep 562→267tok
 9  05:33:49  · grep {"pattern":"add","path":"calc.py"}
10  05:33:49  ✓ grep → (no matches) [INCOMPLETE RESULT]…
13  05:34:06  🧠 wants 1 tool call: ask_user 626→532tok
15  05:34:06  🙋 ask_user needs approval
16  05:34:06  🙋 asked: "The file 'calc.py' is not found…"
17  05:34:06  ⏸ paused — awaiting_human
```

Sequence numbers, timestamps, per-call token deltas, tool arguments, authorization steps, and the
pause. This is the product.

### `replay` — reconstruction with no model calls

```
Replay of #95044d62bb
reconstructed from the event log — no model calls, no cost
  status  paused (awaiting_human)   events 17
  turns 1 · model calls 2 · tool calls 1
  tokens 1987 (in 1188 / out 799)
  AWAITING hr_69b1c1abe6…
```

The "no model calls, no cost" line is the differentiator, stated by the tool itself.

### `fork` — branch history, with an honest warning

```
forked #95044d62bb @9 -> #7945fbc6b2
  warning: event 9 is MID-TURN — 1 tool call(s) were requested but never resolved: grep#call_oto7i0zm
           the resumed model sees "[no result recorded]" and may treat them as already done.
           For a clean split try --at 5.
  history up to that point is inherited; the future is new
  note: the WORKSPACE is not rewound automatically.
```

Then `list` shows lineage:

```
#7945fbc6b2 pending   11  ⑂#95044d62bb@9
#95044d62bb paused    17
```

Two things stand out. It **detected a mid-turn split and proposed a clean boundary** rather than
silently producing a corrupt fork. And it **names its own limitation** — the workspace is not
rewound. That honesty is a product asset, but it is also the surface's real gap.

## The genuine limitation: history forks, the workspace does not

`fork` branches the *event log*. The filesystem the run acted on is not rewound. A forked run
therefore starts with a **truthful history and a divergent world**.

The runtime already has the ingredient for a fix — `attachCheckpoints` in `sandbox/local`, and
`.harness/workspaces/*.git` shadow repos were observed on disk — but the CLI does not wire
workspace restoration into `fork`. **Not a Wave-1 change.** It is the highest-value Wave-2+
trajectory improvement, and it should be documented as a known boundary at v0.1 rather than implied
away.

## Verdict

A developer **can** treat a run as a first-class object today: list it, inspect its state, read a
faithful narrative, reconstruct it for free, and branch it. Two caveats belong in the docs:

1. `explain` renders **what happened**, not **why** the model chose it.
2. `fork` rewinds **history**, not the **workspace**.

Both are stated by the tools themselves, which is the right default.
