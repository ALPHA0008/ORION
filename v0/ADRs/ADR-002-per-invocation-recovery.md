# ADR-002 — Recovery is per invocation, not per tool

**Status:** Accepted (revised) · **Supersedes:** `idempotency: None | Key(args)` in ARCHITECTURE.md §2.6

## Context
A crash between a tool's effect and its terminal event leaves an orphan: `tool.started` with no
`tool.succeeded`/`tool.failed`. The runtime must decide whether to re-issue.

## Original decision
Each tool declares `idempotency: None | Key(args)` once, statically.

## Evidence
Proof-phase Experiment 2 (`research/proof/02-tool-recovery/`), executed:
```
bash("echo x >> f")   -> re-issue DUPLICATED (2 lines, expected 1)
bash("mkdir -p a/b")  -> re-issue identical  (safe)
```
Six of the highest-traffic tools in the Hermes corpus are argument-dependent: `bash`,
`execute_code`, `terminal`, `process`, `ha_call_service`, `cronjob`.

Distribution over 34 classified tools: **32% UNSAFE + 12% argument-dependent = 44% problematic** —
crossing the one-third threshold pre-registered in OPEN-QUESTIONS E-04.

## Failure discovered
A per-tool declaration cannot express `bash`. Marking it `UNKNOWN` forces human escalation on
essentially every crash-interrupted shell call — the most common interruption there is. The
contract is unusable for exactly the case it most needs to handle.

## Revised decision
```
recovery(args) -> {
  class: READ_ONLY | SAFE_RETRY | SELF_VERIFYING | EXTERNALLY_DEDUPED | TRANSACTIONAL | UNSAFE,
  precondition?, dedup_key?, verify?: () => 'applied' | 'not-applied' | 'unknown'
}
```
Resume rule:
```
READ_ONLY | SAFE_RETRY | SELF_VERIFYING | TRANSACTIONAL  -> re-issue
EXTERNALLY_DEDUPED with dedup_key                        -> re-issue
UNSAFE with verify()                                     -> probe -> re-issue | skip
UNSAFE without verify()                                  -> ESCALATE (never guess)
```
`verify()` is a new primitive and it does the real work: the *same* orphan class resolves three
different ways depending on what the probe finds.

## Tradeoffs
- Tools must implement `recovery()`; it is more work than a static field.
- `verify()` costs an I/O probe on resume — negligible against a model call.
- Shell classification is a **conservative pattern list, not a parser** (Phase E says do not build
  one in V0). Anything not provably safe is `UNSAFE`, i.e. escalate. This produces false
  escalations, which is the correct direction to be wrong in.

## Tests
- `tests/recovery/recovery.test.mjs` — every V0 tool classified; `bash` shown to yield opposite
  classes for different arguments; all `decideRecovery` edge cases (verify throws, verify unknown,
  missing contract, EXTERNALLY_DEDUPED without a key).
- Cases 1/2/3 under real effects: reissue / skip / escalate.
- In situ: UNSAFE orphan pauses the run and releases the lease; SAFE_RETRY orphan is skipped when
  `verify()` says applied.
- `tests/crash/matrix.test.mjs` — the decisive pair, from real SIGKILLs:
  `after:tool.started` → `SAFE_RETRY → reissue(not-applied)`;
  `after:tool.effect`  → `SAFE_RETRY → skip(applied)`.
