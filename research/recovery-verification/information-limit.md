# The Information-Theoretic Limit

§12 asks whether more evidence always helps, or whether some cases are unknowable in principle.
The answer is: **both — and the two must not be confused.**

## Constructing two indistinguishable histories

```
History A:  the mutation NEVER ran; an external actor wrote S2
History B:  the mutation ran (S0 -> S1); an external actor then wrote S2
```

Executed with the real tools:

```
final world   A: "let t = 2;\n"    B: "let t = 2;\n"     identical
write.verify  A: not-applied       B: not-applied        indistinguishable
edit.verify   A: unknown           B: unknown            indistinguishable
```

Both histories leave **byte-identical world state** and **byte-identical durable history** — the
crash happened before any success event, so the log records only `tool.started` in each case.

**No amount of post-hoc probing of the world can separate them.** The information required was
destroyed by the external write. This is a property of the universe the runtime is observing, not
a missing feature.

## Where the line actually falls

The experiment separates two things that look alike:

### Genuinely unknowable — do not attempt to fix

| case | why |
|---|---|
| external actor reverts to the exact original bytes | the pre-state witness is restored; the world is identical to never-having-run |
| mutation may-or-may-not have run **and** the region was later overwritten | both witnesses destroyed; A and B collapse |

For these, the only truthful answer is `unknown`, and the correct action is to escalate rather
than to invent certainty.

### An implementation gap — fixable with more evidence

| case | current | why it is fixable |
|---|---|---|
| `write` applied, then an **unrelated** part of the file changed | `not-applied` → REISSUE → **lost update** | the information still exists; `write` simply never looked at the pre-state |

`edit` already gets this right on the same world, using evidence `write` does not carry:

```
same world (S2):  edit says 'applied'    write says 'not-applied'
```

That disagreement is the proof. It is not that the world is unknowable — it is that one tool
declines to look.

## Why the two must not be conflated

A recovery system can be wrong in two very different ways:

1. **Saying `unknown` when the answer was knowable** — wasteful, escalates unnecessarily, safe.
2. **Saying `not-applied` when the effect actually applied** — destructive, silent, unsafe.

`write` currently commits error (2). It does not report `unknown`; it asserts a specific false
answer with full confidence, and the runtime acts on it.

Note the contrast in the same experiment: in the truly ambiguous case, `edit` returns
**`unknown`** — the honest answer — while `write` returns **`not-applied`** — a confident wrong
answer. The failure is not a lack of information. It is a claim made without evidence.

## Consequence for §13 (minimum extra evidence)

Because the unknowable cases are genuinely unknowable, the goal is **not** to eliminate `unknown`.
Per §20, an honest `unknown` is better than a wrong classification.

The minimum useful mechanism is therefore whatever lets `write` distinguish the *knowable* case —
"applied then changed" from "never applied" — and otherwise report `unknown`. That is a
**pre-state witness**, which is precisely what `edit` already has and `write` lacks. See
[`recovery-state-machine.md`](recovery-state-machine.md).
