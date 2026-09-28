# Security Contract — Actual Semantics

Four concerns kept separate because they have different answers. **No enterprise claims. No
enterprise controls added.**

## 1. Sandboxing — `sandbox/local/index.mjs`

| control | implementation |
|---|---|
| **path containment** | `_abs()` rejects `..` traversal **and absolute paths** |
| **symlink escape** | resolves the deepest existing ancestor's real path and re-checks — a real class of bypass, explicitly handled |
| **output bounds** | `MAX_OUTPUT_BYTES` 64 KB, `MAX_ERROR_BYTES` 2 KB, `GREP_MAX_HITS` 500 — bounded **at source** |
| **secret scrubbing** | `scrubEnv()` removes secret-shaped env vars before tool execution |
| **overflow / timeout** | distinguished failure kinds, not a generic error |

**What it is NOT:** not a container, not a VM, not a seccomp/namespace jail. `bash` runs as the
invoking user with that user's privileges. The boundary is **path containment plus resource
bounds**, not OS-level isolation. Ship that sentence in the docs verbatim.

## 2. Authorization — `auth/default/index.mjs`

`authorize(action, context) → allow | deny | escalate`. Three postures — `permissive`, `auto`
(default), `strict` — combined via `maxPosture()`, so a caller cannot *weaken* the configured
posture.

Ordering, which matters:

1. **Budget first.** An exhausted budget denies regardless of posture.
2. **Hard denials at every posture, including `permissive`** (e.g. `rm -rf /`, `mkfs`).
3. **`protectedPaths`** — mutating a matching path is never autonomous **at any posture**.
4. **`escalateUnsafeRecovery`** (default true) — an `UNSAFE` recovery class requires a human in
   `auto`/`strict`.

The `Decision` enum and this signature are the **Kernlbase seam**: an organizational authorizer
substitutes here with no runtime change.

## 3. Verification

Distinct from authorization — authorization asks *may this happen*, verification asks *did it*.

| tool | verification |
|---|---|
| `write` | pre-state witness (`expected_pre_sha`); pre-effect conflict **refused** |
| `edit` | precondition **is** the pre-state |
| `bash` | **none** |
| `read`/`grep` | n/a |

`toolDefinitions()` **strips internal fields**, so `expected_pre_sha` is computed by the runtime and
never exposed to — or supplied by — the model. A correctness-critical value is never model-owned.

## 4. Recovery safety

Covered in `recovery-contract.md`. Security-relevant summary: **`UNSAFE` never auto-re-issues**, so
a crash cannot cause the runtime to silently repeat a destructive command.

## Secret hygiene

| control | where |
|---|---|
| env-var-only credentials | `HARNESS_API_KEY`; `.gitignore` blocks `.env`, `*.key`, `*.pem`, `secrets.json` |
| scrubbed from tool env | `scrubEnv()` |
| redaction in trajectories | `redact()` in `core/run/explain.mjs` |
| never in source | no key material found in `v0/src` |

## Known gaps — state, do not fix here

1. **`grep` searches `.harness/`** — the agent's own event log is inside its search space, and the
   log contains tool results. A prompt-injection-shaped risk and an information-leak; found in this
   audit, listed as a Wave-2 fix.
2. **`bash` has no pre-effect conflict protection** — measured; it overwrote a concurrent change
   that `write` refused.
3. **No per-`bash`-call attribution** — cannot say which command produced which file change.
4. **Sandbox is not OS-isolated** — see above.
5. **Repository content is untrusted input.** The project already treats issue text and repo files
   as data, not instructions; that stance must be documented for users, since the harness will
   happily read hostile files.

## Claims permitted at v0.1

- "Path containment with symlink-escape rejection, bounded output, secret scrubbing."
- "Three authorization postures with hard denials that hold even in permissive."
- "Mutating tools carry recovery classes; unsafe operations escalate rather than auto-retry."
- "Every authorization decision is durably logged."

## Claims NOT permitted

- ~~"Sandboxed execution"~~ without qualifying that it is path containment, not OS isolation.
- ~~"Enterprise-grade"~~ / ~~"compliant"~~ — that is Kernlbase, and unbuilt.
- ~~"Safe to run untrusted agents"~~ — `bash` runs as the invoking user.
