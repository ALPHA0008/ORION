# Phase 2 — Package Identity Gate

## Result: **PASSED** — `@kernlbase/harness` is available

## Evidence

| check | result |
|---|---|
| `GET registry.npmjs.org/@kernlbase%2Fharness` | **HTTP 404** — not published |
| npm search `scope:kernlbase` | **0 packages** — scope unused |
| `GET registry.npmjs.org/harness` (unscoped, for contrast) | **HTTP 200** — taken |

## Reading

- The scoped name is free, and the scope itself is empty — no collision with an existing publisher.
- The unscoped `harness` **is** taken, which independently confirms scoping was the right call
  rather than a stylistic preference.
- A 404 on the registry is the standard availability signal for an unpublished name.

## Caveat recorded honestly

Availability was verified against the **public npm registry**. Two things are outside what this
check can establish:

1. **Scope ownership.** Publishing under `@kernlbase` requires the npm org/user `kernlbase` to
   exist and the publisher to have rights to it. The scope being *empty* is consistent with it
   being unclaimed, but claiming it is an account action, not a code action.
2. **Trademark.** Registry availability is not a trademark clearance.

Neither blocks Wave 2 — the package is built, validated and packed locally; nothing is published.

## Identity fixed for this wave

| field | value |
|---|---|
| npm package | `@kernlbase/harness` |
| version | `0.1.0` |
| CLI binary | `harness` |

Gate: **PASSED** — proceed to Phase 3.
