# Part A Summary — Bash Mutation Semantics

## Decision: `BASH_MUTATION_ALLOWED_BUT_NOT_WITNESSED`

Chosen over `BASH_MUTATION_NEEDS_SMALL_RUNTIME_FIX` and `BASH_MUTATION_REQUIRES_LARGER_REDESIGN`,
for reasons given below. **No `v0/src` change was made**, so the §35 regression gate is not engaged.

## The four properties, answered separately

| property | answer | evidence |
|---|---|---|
| **observability** | **PRESENT** | `git diff --stat` + untracked enumeration caught 8/8 mutation forms; already the channel `report-baseline.mjs` uses and `failure-table.mjs` treats as authoritative |
| **authorization** | **PRESENT, conservative** | every mutating form → `UNSAFE` via default-deny → `ESCALATE`; never auto-reissued |
| **pre-state knowledge** | **ABSENT by design** | `bash.captureWitness` does not exist; ADR-011 states the write-specific scope explicitly |
| **recoverability** | **UNCERTAIN BUT SAFE** | cannot classify at any of 4 crash points; escalates at all 4 |
| **attribution** | **ABSENT** | `PER_CALL_MUTATION_ATTRIBUTION = ABSENT`; payloads carry `tool_call_id, name, args/result` and no file list |
| **pre-effect conflict** | **ABSENT, asymmetric with `write`** | bash overwrote a third-party change; witnessed `write` refused it |

## Why not "needs a small runtime fix"

The one finding that looks like a defect is Q6: `bash` overwrote a concurrent change that `write`
refused. But the asymmetry is not closable by a small fix.

`write` can be protected because the runtime knows *which file* the call will touch, so it can hash
it first. For `bash` the equivalent requires knowing which paths an arbitrary shell command will
modify **before running it** — the static shell analysis this project has repeatedly and correctly
declined to build. The alternatives (copy-on-write sandbox, overlay filesystem, per-call snapshot)
are all far larger than the demonstrated exposure.

And the demonstrated exposure today is **zero**: single worker per task, no concurrent actor, oracle
restored from git before every verdict, 25/25 anti-gaming attacks defended, and no Stage-1 verdict
that depended on a concurrent modification.

## Why not "recovery is safe enough" as the headline

That option is *true* — recovery is safe at all four crash points — but it answers only Q4 and
would leave the attribution and conflict findings unrecorded. The chosen classification is the one
that keeps all six answers visible.

## What this does NOT say

- **Not** "mutation is unobservable." It is observable, and already observed.
- **Not** "the runtime is broken." No crash point auto-reissues a bash command; the ADR-011 failure
  mode is absent here.
- **Not** a blocker for the next baseline. `MUTATION_OBSERVABILITY_BLOCKS_NEXT_BASELINE` is
  explicitly **rejected** by this evidence.

## Recorded limitations, carried forward

1. **`PER_CALL_MUTATION_ATTRIBUTION = ABSENT`** — diagnostic precision only; no task verdict is
   affected. Cheapest fix (diff around each `bash` call, record paths on `tool.succeeded`) is a
   runtime change that would need the full V0 gate, and nothing in Stage 1 shows it changing a
   verdict.
2. **No pre-effect conflict protection for bash** — would matter under concurrent workers or a human
   editing alongside the agent. Neither exists today.
3. **Recovery escalates rather than resolves** — costs availability, not correctness.

## Relationship to the capability analysis

Stage 1 observed 10/17 runs mutating via `bash` rather than `write`/`edit`. That was recorded as
*unresolved and safety-relevant*. Part A resolves the safety half:

> The behaviour is allowed, observed, conservatively classified, and safe under crash. It is **not**
> a correctness defect and does **not** invalidate any Stage-1 verdict.

The *behavioural* question — why the agent prefers `bash` over its own file tools — remains open and
belongs to capability analysis, not to runtime correctness.
