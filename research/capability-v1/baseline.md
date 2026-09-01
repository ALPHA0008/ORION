# Capability V1 Baseline — Record

> **STATUS: NOT YET ESTABLISHED.** No baseline has been run. This file exists to hold the
> provenance required by §1 and §12; results are appended only when they exist.

**Corpus label**: Stage-1 filtered SWE-bench-lite slice, locally reproduced.
Not "SWE-bench Lite performance" — the official per-instance images were not used.

## Provenance

| item | value |
|---|---|
| Stage 1B tooling commit | **`6e4d532`** — `stage1b: add real-code corpus tooling and methodology` |
| Parent (V0 runtime, frozen) | `d6c2c77` — Phase 10: declared completion contract (ADR-013) |
| Branch | `main` |
| Runtime state | `git status --porcelain v0/src` empty — untouched (Rule 9) |
| V0 regression at freeze | 608 passed, 0 failed, 23 suites |
| Corpus version | `CAPABILITY_V1_STAGE1` (identity assigned at freeze; see `frozen-corpus.md`) |

## Why the corpus commit and the runtime commit are recorded separately

The benchmark is itself an experimental instrument. A future result has to be expressible as
*agent result X on corpus version Y at runtime commit Z* — three independent coordinates. Recording
only "we scored N" would make the number unfalsifiable the moment any of the three moves.

## Pending

- corpus freeze (`frozen-corpus.md`) — required before any run
- configuration freeze (`baseline-lock.md`)
- Gemma baseline · Qwen baseline · comparison
- failure table, trajectory analysis, bottleneck ranking

See `state-of-stage1b.md` for the authoritative what-exists list.
