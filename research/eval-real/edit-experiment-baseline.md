# `edit` Experiment — Baseline (no code changed)

Recorded before any modification, per brief §2.

## Current contract

```js
edit: {
  description: 'Replace an exact unique substring in a file.',
  schema: { required: ['path', 'old_string', 'new_string'] },
  effects: 'Mutating',
  recovery: SELF_VERIFYING, precondition: old_string,
  run: ({ path, old_string, new_string }) => {
    const cur = sandbox.read(path);
    const n = cur.split(old_string).length - 1;
    if (n === 0) throw new Error(`old_string not found in ${path}`);
    if (n > 1)   throw new Error(`old_string is ambiguous in ${path} (${n} matches) — include more context`);
    sandbox.write(path, cur.replace(old_string, new_string));
    return `edited ${path}`;
  },
}
```

### What it accepts

`path`, `old_string`, `new_string` — all required strings. No line numbers, no ranges, no diffs.

### What happens when `old_string` is not found

The tool throws. **Nothing is written** — the failure is already fail-closed, and that property is
not at issue in this experiment.

### What is returned to the model

Exactly one string:

```
old_string not found in src/index.js
```

**36 bytes for the example above.** It contains no information about *why* the match failed:

- not whether a whitespace-only-different match exists
- not where the nearest candidate is
- not what the file actually contains at that point
- not whether the agent is even looking at the right region or the right file

### What is persisted in the event log

`worker.mjs` appends `tool.failed` with `{ tool_call_id, name, error }`, where `error` is that same
string. The projection pushes it into the conversation as:

```
ERROR (tool.failed): old_string not found in src/index.js
```

**The error string is therefore the entire channel.** It is simultaneously what the model sees,
what the trajectory records, and what a human reviewer reads. Improving that one string is the
whole intervention surface — which is why this experiment requires **no runtime change**.

## Can the failure already be diagnosed from the trajectory?

**By a human, yes — with effort.** In phase 2 I recovered the exact cause on
`plimit-active-count` by extracting the agent's `old_string` from the event log and diffing it
against the pinned file: the file has **one tab** before `const next`, the agent sent **two**.

**By the model, no.** The 36-byte message is the only feedback it receives, and nothing in it is
actionable. Its available moves are to re-read (which 9 of 11 failing runs did) or to guess a
variant. Re-reading does not help because paged `read` renders a leading tab indistinguishably
from spaces on the terminal-facing output the model consumes.

## Does the model have enough information to recover?

Sometimes — by luck rather than by information.

| evidence | value |
|---|---|
| failures containing `old_string not found` | **11 of 21** (52%) across 43 scored runs |
| distinct tasks affected | 5 |
| ambiguity (`n > 1`) errors observed | **0** |
| passing runs that hit the error and recovered anyway | **10** |

The corrected `plimit-active-count` data is the sharpest illustration — same task, same tool, same
error:

| run | outcome | `old_string not found` count |
|---|---|---:|
| batch2 #0 | **PASS** | 3 |
| batch2 #1 | **PASS** | 4 |
| batch2 #2 | FAIL | 5 |
| batch1 #0–#2 | FAIL ×3 | 5, 5, 5 |

**2/6 overall.** The error does not determine the outcome; recovery from it does. Whether recovery
happens currently has no informational input — which is exactly the gap this experiment tests.

## Two properties that must not regress

1. **Exactness.** `old_string` is the `SELF_VERIFYING` precondition (ADR-002/003). A fuzzy or
   nearest match would silently apply a patch the model never specified and would break replay's
   content-addressed precondition. The experiment changes the *error message*, never the matching.
2. **Ambiguity handling.** `n > 1` already fails with a distinct, informative message. Zero
   ambiguity errors were observed in the corpus, so this path is not the problem and will not be
   weakened.

## Baseline metrics carried into the experiment

| metric | value | source |
|---|---:|---|
| overall success | 63.6% (14/22) | `v0-real-iteration01.json` |
| hard success | 8/24 = 33.3% | 3-repeat set |
| failures containing `old_string not found` | 11/21 = 52% | 43 scored runs |
| recoveries after the error (passing runs) | 10 | 43 scored runs |
| ambiguity errors | 0 | 43 scored runs |
| diagnostic bytes returned | **~36** | this document |

No code was changed in producing this baseline.
