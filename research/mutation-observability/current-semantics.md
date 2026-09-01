# Bash Mutation Semantics — The Established Contract

Written from the existing prior art before any new probing, so nothing below is re-derived:
`v0/ADRs/ADR-011-write-pre-state-witness.md`, `research/write-recovery/`, `v0-hardening/`,
`eval/capability-v1/anti-gaming.mjs`, and the bash classification in
`v0/src/agent/tools/index.mjs` + `v0/src/core/recovery/index.mjs`.

## What ADR-011 already decided

ADR-011 is explicit that the witness is **write-specific by design**, and says why:

- `write`'s precondition was the *post-state*, so "never applied" and "applied, then a third party
  changed it" collapsed onto the same answer, and recovery re-applied a landed write — a lost
  update, reproduced with a real `SIGKILL`.
- `edit` **never had this defect**: its precondition is the *pre-state* (`old_string`), whose
  continued absence proves the effect ran.
- The ADR states its own compatibility boundary: a path that bypasses the worker "does **not** gain
  the stronger guarantee."

So `bash` lacking a witness is a **known consequence of a deliberate scope decision**, not an
oversight discovered now.

## What already exists at each layer

| layer | mechanism | covers bash? |
|---|---|---|
| evaluator observability | `report-baseline.mjs` takes `git diff --stat` **before** oracle restoration, including untracked additions | **yes** |
| analysis precedence | `failure-table.mjs` treats `diff_stat` as authoritative over event-count mutation accounting | **yes** |
| anti-gaming | `anti-gaming.mjs` exercises bash-mediated attacks (`conftest_skip_hook`, file deletion, assertion stripping) — 25/25 defended | **yes** |
| recovery classification | `classifyShell()` — conservative, allow-list, **default deny** | **yes** |
| pre-state witness | ADR-011 `captureWitness` → `expected_pre_sha` | **no — by design** |
| per-call attribution | — | **no** |

## The conservative shell classifier

`classifyShell()` is deliberately not a static analyser. It holds a short allow-list of read-only
forms (`ls`, `cat`, `grep`, `wc`, `head`, `tail`, `stat`, `pwd`, `echo`, `test`, `which`,
`mkdir -p`), an explicit deny-list, and then:

```js
return RecoveryClass.UNSAFE;   // default deny: escalate rather than guess
```

**Every mutating form therefore lands on `UNSAFE`**, not because each was enumerated, but because
none can be proven safe. `UNSAFE` with no `verify()` yields `ESCALATE` — never an automatic
re-issue.

This is the load-bearing fact for the whole investigation: *unwitnessed* is not the same as
*unguarded*.

## The four questions, kept separate

| question | concern | answered in |
|---|---|---|
| Q1 | observability — can the evaluator see it? | `deterministic-results.md` |
| Q2 | authorization / recovery class | `deterministic-results.md` |
| Q3 | pre-state knowledge | `deterministic-results.md` |
| Q4 | crash recoverability | `crash-results.md` |
| Q5 | per-call attribution | `attribution-results.md` |
| Q6 | pre-effect conflict | `conflict-results.md` |

Conflating them is what produces the wrong headline. Observability is **present**; attribution is
**absent**; recovery is **uncertain but safe**; conflict protection is **absent and asymmetric with
`write`**. Those are four different answers and only one of them is a candidate defect.
