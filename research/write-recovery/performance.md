# Performance (§23)

## Measured overhead

`captureWitness` vs the write it guards, 200 iterations each:

| file size | captureWitness | `write.run` | overhead |
|---:|---:|---:|---:|
| 1 KB | 453 µs | 5,460 µs | **8%** |
| 64 KB | 527 µs | 14,047 µs | **4%** |
| 512 KB | 1,054 µs | 57,219 µs | **2%** |

The relative cost **falls** as files grow: hashing is linear and cheap, while the write itself
carries filesystem overhead.

## What it costs

- **One extra file read** per write, immediately before the effect.
- **One sha256** over those bytes (truncated to 16 hex chars, as elsewhere in the codebase).
- **~16 extra bytes** in the `tool.started` event payload.
- The pre-effect conflict check re-reads once more inside `run()`. That is deliberate: the witness
  is only meaningful if it is compared against the world at the moment of writing.

## Memory

No change of consequence. The target content is already in memory; the pre-state is hashed
streaming-free but discarded immediately, and only the 16-character digest is retained.

## In a real run

Gemma smoke test on `slugify`: 2 write calls across 5 tasks, p50 wall 14 s. The witness is
invisible at that scale — a sub-millisecond hash against multi-second model calls.

Full regression wall time was unchanged within noise (441 → 536 assertions, the increase being new
tests rather than slower ones).

## Verdict

Well within the "expected to be small" prediction of §23. No investigation of unexpected cost was
needed.
