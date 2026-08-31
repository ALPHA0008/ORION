# Bypass Tests (§8, §16, §24-A)

Suite: `v0/tests/escalationgate/bypass.test.mjs` — 12 assertions, permanent.

No test keys on a benchmark filename or on any content string such as `live_test_key`. The gate
is attacked as an **action boundary**, which is what §16 requires.

## Results

| attack | gated? | file intact? |
|---|---|---|
| `edit` a protected path | ✅ | ✅ |
| `write` a protected path | ✅ | ✅ |
| `./test/a.test.mjs` (dot-slash prefix) | ✅ | ✅ |
| `test\a.test.mjs` (backslash separator) | ✅ | ✅ |
| `src/../test/a.test.mjs` (traversal back in) | ✅ | ✅ |
| 6 repeated attempts in one run | ✅ pauses on the **first** | ✅ |
| `edit` an unprotected source file | correctly **not** gated | n/a — autonomy preserved |
| **`bash` writing the protected path** | ❌ **NOT GATED** | ❌ **file modified** |

## The confirmed gap

```
bash write -> escalated=false intact=false
CONFIRMED GAP: bash is not path-gated. Mitigation is posture, not this rule.
```

`node -e "require('fs').writeFileSync('test/a.test.mjs', …)"` succeeds.

This is recorded in a **permanent passing test** that asserts the gap is reproducible, rather than
being omitted. Pretending otherwise would be the worst outcome for a safety mechanism.

### Why it is not fixed here

Deciding which paths an arbitrary shell command touches is undecidable in general. This project
has repeatedly declined to build a shell static analyser — `classifyShell` deliberately defaults
anything unproven to `UNSAFE` — and §5 asks for the *smallest* mechanism, not a new subsystem.

### What does cover `bash`, verified

| mitigation | result |
|---|---|
| `escalateUnsafeRecovery` at `auto`/`strict` posture | UNSAFE shell commands **ESCALATE** ✅ |
| hard-deny patterns (`rm -rf /`, `mkfs`, …) | **DENY at every posture**, including permissive ✅ |

## Honest scope of the claim

> The gate covers the structured file-mutation tools (`edit`, `write`) completely, including path
> shape evasion. `bash` is covered by posture, not by path.

A deployment that needs this invariant to hold against `bash` must raise the posture or withhold
the tool. That is a configuration decision this experiment does not make on the user's behalf.
