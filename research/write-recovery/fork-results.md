# Fork (§18)

## Result: unchanged

`replay/semantics` covers fork and remains **44 passed, 0 failed**; the escalation-lifecycle suite
additionally forks across a pause boundary and still passes (20/20).

## The §18 hazard: does a child inherit an unsafe retry assumption?

**No, and the witness makes this stricter rather than looser.**

A forked child replays the parent's events up to the fork point, so it inherits the recorded
`expected_pre_sha` exactly as the parent had it. If the child later reconciles that write, it
classifies against **its own current world**:

- child's world still matches `pre` → `not-applied` → safe retry
- child's world matches `target` → `applied` → skip
- neither → **`unknown` → escalate**

Before ADR-011 the third case would have been a confident `not-applied` in the child too, so fork
inherited the *unsafe* assumption. It no longer does.

## No fork-specific machinery

The witness is an ordinary arg in an ordinary event. Fork required no changes, and none were made.
