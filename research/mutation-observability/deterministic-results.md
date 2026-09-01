# Deterministic Results — Q1, Q2, Q3

Probe: `eval/mutation-observability/probe.mjs` · data: `results/deterministic.json`
Real stack (`makeTools` + `LocalSandbox` + `decideRecovery`) on a git-backed fixture. No `v0/src`
modification.

## Result

| form | ran | changed file | visible via `git` | recovery class | decision | `verify()` | witness |
|---|---|---|---|---|---|---|---|
| heredoc `cat > f <<EOF` | yes | yes | **yes** | `UNSAFE` | escalate | no | no |
| `echo >` | yes | yes | **yes** | `UNSAFE` | escalate | no | no |
| `printf >` | yes | yes | **yes** | `UNSAFE` | escalate | no | no |
| `>>` append | yes | yes | **yes** | `UNSAFE` | escalate | no | no |
| `sed -i` | yes | yes | **yes** | `UNSAFE` | escalate | no | no |
| `python -c` write | *failed* | no | no | `UNSAFE` | escalate | no | no |
| `node -e` write | yes | yes | **yes** | `UNSAFE` | escalate | no | no |
| `cp` | yes | yes | **yes** | `UNSAFE` | escalate | no | no |
| `mv` | yes | yes | **yes** | `UNSAFE` | escalate | no | no |

(The `python -c` row failed only because the probe fixture has no interpreter on `PATH` — the same
condition that invalidated the first Gemma baseline. It is an artifact of the fixture, not a
property of bash, and `node -e` covers the same "interpreter writes a file" shape.)

## Q1 — can the evaluator detect that bash changed the workspace?

**YES, for every form that ran.** `git diff --stat` plus untracked enumeration caught all eight,
including `cp`/`mv` (new paths) and `sed -i` (in-place edit). This is the same channel
`report-baseline.mjs` already uses, and `failure-table.mjs` already treats it as authoritative.

Evaluator-level mutation observability **is not the gap**.

## Q2 — can the runtime determine whether the bash mutation was authorized?

**YES — and it does not classify it as safe.** Every mutating form resolves to `UNSAFE` through
`classifyShell()`'s default-deny, which yields `ESCALATE` rather than an automatic re-issue.

The distinction that matters:

> A bash mutation is **not witnessed**, but it is **not unguarded**. The runtime's response to
> uncertainty about a bash effect is to escalate, which is the same posture ADR-011 introduced for
> an unknown `write`.

## Q3 — can the runtime determine the pre-mutation filesystem state?

**NO.** `tools.bash.captureWitness` does not exist; `tools.write.captureWitness` does.

Verified via the worker's own path — `captureWitness({path, content})` returns
`expected_pre_sha: "9660b3303631e958"`, and the witnessed descriptor is
`{class: SELF_VERIFYING, escalateOnUnknown: true}`. Unwitnessed, the same `write` is `SAFE_RETRY`,
which is exactly the ADR-011 compatibility boundary and not a defect.

| tool | witness | class | `escalateOnUnknown` |
|---|---|---|---|
| `write` (via worker) | **yes** | `SELF_VERIFYING` | **true** |
| `edit` | n/a — precondition *is* the pre-state | `SELF_VERIFYING` | — |
| `bash` | **no** | `UNSAFE` | — (escalates anyway) |

## Reading

Q1 present, Q2 present-and-conservative, Q3 absent-by-design. Nothing here is a correctness defect
on its own. The candidate defect, if there is one, lives in Q5/Q6.
