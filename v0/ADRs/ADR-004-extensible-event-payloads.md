# ADR-004 — Closed event types, extensible payloads

**Status:** Accepted (revised) · **Supersedes:** the fully closed vocabulary in ARCHITECTURE.md §2.1

## Context
The reducer is a `switch` over event types. If unknown types can enter the log, the fold silently
no-ops and replay fidelity becomes provider-dependent.

## Original decision
A closed set of ~31 event types with fixed payload fields.

## Evidence
Proof-phase Experiment 3 (`research/proof/03-adapter/`), against the REAL Claude Agent SDK type
definitions (100 distinct `type:` discriminators):

| mode | field kinds lost | cost answerable | cache answerable |
|---|---|---|---|
| closed | **33** | no | no |
| core types + `payload.ext` | **2** | `$0.0123` | `cache_read=900` |

Lost in closed mode: `total_cost_usd`, `ttft_ms`, `duration_api_ms`, `usage`, `modelUsage`,
`cache_read_input_tokens`, `thinking_blocks`, `stop_reason`, `session_id`, `uuid`, and more.

## Failure discovered
A closed-payload log **cannot answer "what did this run cost?"** — a first-order operational
question, and one of the main reasons to adopt a durable runtime at all.

## Revised decision
- Event **types** stay closed. `Store.append` throws `UnknownEventType` on anything else, so the
  reducer stays total and replay stays deterministic.
- Event **payloads** are extensible via `payload.ext`.
- **Promoted to core** (every provider has them; they answer first-order questions):
  `cost_usd`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `ttft_ms`, `duration_ms`
  on `model.responded` / `run.completed`.

Fully-open event *types* were rejected: unknown types would silently no-op in the fold.

## Tradeoffs
- `payload.ext` is unvalidated, so it must never be load-bearing for control flow. The reducer
  never reads `ext`.
- Adding a genuinely new event type is a version change, not a config change. Accepted — that is
  the property that makes replay trustworthy.

## Tests
- `tests/unit/event-store.test.mjs` — unknown types rejected with a typed error; non-serialisable
  payloads rejected; `appendMany` rolls back entirely on a bad entry.
- `tests/integration/provider.test.mjs` Test 1 — cost and cache tokens flow from the wire format
  through to `state.budget`.
- Experiment 3 test 3.2 — core event types identical in closed and extension modes.
