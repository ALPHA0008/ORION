# Experiment 2 — Results: Tool Recovery Semantics

**Tests H-07** (tools can provide enough recovery information to safely resume interrupted runs).
**Artifacts:** `classification.md` (34 tools) · `simulate.mjs` (12 executable simulations) ·
`simulation-results.json`

---

## 1. Verdict

> **H-07 — PARTIALLY SUPPORTED.**
>
> Recovery information is obtainable for **68% of the tool corpus** and the mechanisms that work are
> stronger than expected. But the *contract proposed in `ARCHITECTURE.md` §2.6*
> (`idempotency: none | key(args)`, declared per tool) is **REFUTED** by direct experiment: the
> single most-used tool, `bash`, is safe or unsafe depending on its arguments, so a per-tool
> declaration cannot express it.

---

## 2. Executable evidence

12 simulations, each performing a real effect, crashing between effect and event, then re-issuing:

| # | Tool | Class | Re-issue outcome | Detectable? |
|---|---|---|---|---|
| 1 | `read_file` | READ_ONLY | identical | n/a |
| 2 | `grep` | READ_ONLY | identical | n/a |
| 3 | `write_file` | MUTATING_SAFE_RETRY | identical | yes (hash) |
| 4 | `patch` / `edit_file` | **SELF_VERIFYING** | **no-op (rejected)** | yes (precondition) |
| 5 | `bash (>> append)` | MUTATING_UNSAFE_RETRY | **DUPLICATED** | **no** |
| 6 | `bash (mkdir -p)` | MUTATING_SAFE_RETRY | identical | no |
| 7 | `git commit` | **SELF_VERIFYING** | **no-op (rejected)** | yes (rev-parse) |
| 8 | `HTTP POST` (no key) | MUTATING_UNSAFE_RETRY | **DUPLICATED** | no |
| 9 | `HTTP POST` (+key) | EXTERNALLY_DEDUPED | identical | yes (key) |
| 10 | `send_email` | MUTATING_UNSAFE_RETRY | **DUPLICATED** | **no** |
| 11 | `db mutation` (tx) | **TRANSACTIONAL** | identical | yes (op ledger) |
| 12 | `ask_user` | READ_ONLY | identical | yes |

---

## 3. The three findings that matter

### 3.1 Rows 5 and 6 refute the per-tool contract

Same tool. Same runtime. Opposite safety:

```
bash("echo x >> f")   → re-issue DUPLICATED (2 lines, expected 1)
bash("mkdir -p a/b")  → re-issue identical (safe)
```

**Recovery safety is a property of the invocation, not the tool.** Six high-traffic tools in the
Hermes corpus are argument-dependent: `bash`, `execute_code`, `terminal`, `process`,
`ha_call_service`, `cronjob`. Marking them all `UNKNOWN` would force human escalation on nearly
every crash-interrupted shell call — the most common interruption there is. The contract as written
is unusable for exactly the case it most needs to handle.

### 3.2 Self-verifying preconditions are stronger than idempotency keys — and nobody planned for them

The best result in the experiment was unplanned. `patch` and `git commit` **reject their own
replays**:

```
patch:      second application → "old_string not found"
git commit: second application → "nothing to commit"
```

Because the effect *invalidates the precondition*, a duplicate cannot apply. This needs no
idempotency key, no runtime bookkeeping, and no cooperation from a remote service. It is a property
of how the tool's arguments are expressed.

This has a design implication that goes beyond recovery: **prefer content-addressed tool arguments.**
`edit(path, old_string, new_string)` is safely resumable; `append(path, text)` is not. That is an
argument for the tool *vocabulary*, not just its metadata — and it is the kind of conclusion only an
experiment produces.

Hermes appears to have arrived at `old_string` matching for correctness reasons (avoiding ambiguous
edits — `file_tools.py:2507-2539` is a long comment about retry loops), not recovery reasons. The
recovery benefit is a free side effect of a good decision.

### 3.3 The gap is *verifiability*, not idempotency

The tools that are unsafe to retry split cleanly:

| | cheap to check afterwards | not checkable |
|---|---|---|
| examples | `git commit`, `kanban_create`, `discord` send, `write_file`, `delegate_task` | `send_email`, `image_generate` (billing), `computer_use` |
| recovery | probe, then re-issue or skip | **must escalate** |

The current architecture has no notion of a post-hoc probe. Adding one converts most of the unsafe
group into automatically recoverable cases. Escalation then applies only to genuinely
irreversible-and-unobservable effects — which is a small, honest set rather than 44% of the corpus.

---

## 4. Distribution against the pre-registered threshold

`OPEN-QUESTIONS.md` E-04 pre-registered: *"if more than roughly a third land in unkeyed-mutating,
the crash-resume story needs rethinking."*

**Measured: 32% `UNSAFE` + 12% argument-dependent `UNKNOWN` = 44% problematic.**

The threshold was crossed. The rethink is §5.

---

## 5. Revised recovery contract

Declared **per invocation**, computed by the tool from its own arguments:

```
recovery(args) -> {
  class:        READ_ONLY | SAFE_RETRY | SELF_VERIFYING
              | EXTERNALLY_DEDUPED | TRANSACTIONAL | UNSAFE,
  precondition?: token,          // content hash / old_string / git sha — the effect invalidates it
  dedup_key?:    string,         // propagated to the remote
  verify?:       () => 'applied' | 'not-applied' | 'unknown'
}
```

Resume algorithm on `tool.started` with no terminal event:

```
READ_ONLY | SAFE_RETRY | SELF_VERIFYING | TRANSACTIONAL   → re-issue
EXTERNALLY_DEDUPED with key                              → re-issue
UNSAFE with verify()                                      → probe → re-issue | skip
UNSAFE without verify()                                   → escalate (HumanRequest)
```

Three changes from the original design:
1. **Per-invocation, not per-tool** (refutes §2.6 as written).
2. **`SELF_VERIFYING` becomes a first-class class** — it was not in the original taxonomy and it is
   the strongest property available.
3. **`verify()` is added** — the missing primitive.

**Honest residual, stated rather than hidden:** `bash` with an arbitrary command and no
caller-supplied precondition still lands in `UNSAFE`-without-`verify`. QM's shell parser
(`command-policy.ts`, depth-8 recursive extraction) shows that classifying commands is feasible for a
curated rule set, so a *heuristic* classifier is possible (`mkdir -p`, `cp`, `chmod` → SAFE_RETRY;
`>>`, `git push`, `curl -X POST` → UNSAFE). But **general shell recovery is unsolved**, and the
design should state that limit rather than imply a guarantee it cannot deliver.

---

## 6. Threats to validity

1. **Simulations reimplement tool semantics; they do not execute Hermes' actual handlers.** I read
   the relevant Hermes code (`file_tools.py:2456-2464`, `skill_manager_tool.py:972-1209`) to model
   `patch`/`write_file` faithfully, but the simulation is my code, not theirs. The `patch`
   precondition behaviour is well-evidenced in their source; the rest is reasoned classification.
2. **Classification of 22 of 34 tools is analytical, not executed.** The 12 executed cases were
   chosen as representatives of each class. Network/billing tools (`image_generate`, `discord`) were
   *not* executed — doing so would incur real cost and real side effects.
3. **No real crash was induced in these 12 cases.** The "crash" is a simulated control-flow gap.
   Real crash recovery is tested in Experiment 4, which does kill actual processes.
4. **Single-tenant assumption.** Concurrent runs touching the same resource are out of scope here.
5. The `UNKNOWN` share depends on tool design choices. A harness that *only* exposed
   content-addressed tools would have a far better distribution — which is itself the finding in §3.2.

---

## 7. Consequences for the architecture

| Item | Status |
|---|---|
| `ARCHITECTURE.md` §2.6 `idempotency: None \| Key(args)` | **REJECT** — refuted by sims #5/#6 |
| Per-invocation `recovery(args)` contract | **ADOPT** — §5 |
| `SELF_VERIFYING` as a first-class class | **ADOPT** — strongest mechanism found |
| `verify()` post-hoc probe | **ADOPT** — the missing primitive |
| "Prefer content-addressed tool arguments" as a design rule | **ADOPT** — new, from §3.2 |
| General `bash` recovery | **UNRESOLVED** — document the limit; escalate by default |
| Escalate-on-ambiguity (already in the design) | **KEEP** — it is the correct fallback, and now applies to a much smaller set |
