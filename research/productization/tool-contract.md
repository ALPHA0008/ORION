# Tool Contract Audit

`v0/src/agent/tools/index.mjs` (376 ln) — `makeTools(sandbox)` returns six tools. Model-facing
schemas are produced by `toolDefinitions()`, which **strips internal fields** (`stripInternal`) so
runtime-injected values never reach the model.

## Per-tool contract

### `read` — ReadOnly

| aspect | contract |
|---|---|
| arguments | `path` (required), `offset` (1-based), `limit` |
| output | `N\|line` — pipe delimiter (**ADR-012**) |
| side effects | none |
| authorization | ReadOnly |
| verification | n/a |
| recovery | `READ_ONLY` → safe re-issue |
| failure | throws; recorded as `tool.failed` |

ADR-012 exists because a previous delimiter merged with source indentation and corrupted the
model's view.

### `grep` — ReadOnly · **TWO DEFECTS**

| aspect | contract |
|---|---|
| arguments | `pattern` (required), `path` (defaults `'.'`) |
| output | `path:line: match`, capped by `GREP_MAX_HITS`, with `[INCOMPLETE RESULT]` notice |
| recovery | `READ_ONLY` |

**Defect 1 — a file `path` always fails.** `sandbox.grep()` calls `readdirSync` on the start path
unconditionally, so a file throws `ENOTDIR`. Reproduced:

```
grep {pattern:'add', path:'calc.py'} → "(no matches) [INCOMPLETE RESULT] … SKIPPED: calc.py (ENOTDIR)"
```

for a file that contains `add`. Observed causing a live agent to conclude the file was missing and
escalate to a human.

**Defect 2 — searches `.harness/`.** With no path it descends into the runtime's own state,
returning event-log SQLite binary and `workspaces/*.git/hooks/*`.

Both are Wave-2 fixes. Neither was changed in this wave.

### `write` — Mutating · **strongest guarantees**

| aspect | contract |
|---|---|
| arguments | `path`, `content`; `expected_pre_sha` **injected by the runtime**, stripped from the model schema |
| side effects | full file replace |
| verification | compares `pre` / `target` / `current` |
| recovery | `SELF_VERIFYING` + `escalateOnUnknown` **when witnessed**; `SAFE_RETRY` when not |
| failure | pre-effect conflict → actionable refusal |

**ADR-011.** `captureWitness` runs between authorization and `tool.started`, so the witness lands in
`pend.args` and survives the crash it exists to survive. Verified: witnessed →
`{class: SELF_VERIFYING, escalateOnUnknown: true}`; three crash situations resolve
`not-applied → reissue`, `applied → skip`, `applied-then-changed → escalate`.

### `edit` — Mutating

| aspect | contract |
|---|---|
| arguments | `path`, `old_string`, `new_string` |
| verification | the precondition **is** the pre-state |
| recovery | `SELF_VERIFYING` |

**Never had the lost-update defect** — `old_string`'s continued absence proves the effect ran.
Re-issue is self-rejecting.

### `bash` — Mutating · **weaker, deliberately**

| aspect | contract |
|---|---|
| arguments | `cmd` |
| output | stdout/stderr, capped; distinguishes overflow / timeout / exit |
| verification | **none** |
| pre-state witness | **none** |
| recovery | `classifyShell(cmd)` → allow-list `SAFE_RETRY`, deny-list `UNSAFE`, **default-deny `UNSAFE`** |
| failure | escalate |

**Do not claim equivalence with `write`/`edit`.** Measured in Part A of Stage 1D:

| property | `write` (witnessed) | `bash` |
|---|---|---|
| observable by evaluator | yes | **yes** (`git diff`) |
| authorized | yes | **yes** — conservative, default-deny |
| pre-state known | **yes** | **no** |
| crash-classifiable | yes (`applied`/`not-applied`/`unknown`) | **no — always `UNKNOWN`** |
| crash-safe | yes | **yes — escalates at all 4 crash points** |
| pre-effect conflict | **refuses** | **overwrites** |
| per-call attribution | n/a | **ABSENT** |

Classification: **`BASH_MUTATION_ALLOWED_BUT_NOT_WITNESSED`**. Unwitnessed ≠ unguarded — every
mutating shell form resolves `UNSAFE` → escalate, so recovery never re-issues a possibly-landed
command. **Not redesigned in this wave.**

### `ask_user` — ReadOnly, runtime-handled

`alwaysEscalate`; `run()` throws if called directly. Produces `human.requested` → `run.paused`;
the run stays durably claimable (**ADR-009**). Observed live in the fresh-run check.

## Cross-cutting

- **`validateArgs`** — schema validation before execution.
- **`stripInternal`** — runtime-injected fields (`expected_pre_sha`) never appear in the model schema.
- **`effects` declaration** — `ReadOnly` / `Mutating` drives authorization.
- **Recovery class is per-tool and argument-dependent** (`bash` computes it from `cmd`).

## Wave-2 items

1. **Fix `grep` file paths** (severity: high — degrades normal use).
2. **Exclude `.harness/` from `grep`** (severity: medium — leaks runtime state).
3. Document the tool-guarantee table publicly, so the `bash` asymmetry is stated rather than
   discovered.
