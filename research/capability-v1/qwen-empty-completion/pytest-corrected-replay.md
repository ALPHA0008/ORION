# Corrected replay — pytest-dev/pytest-9359 (the earlier "counterexample")

Source DB: `Temp/capability-v1/_runs/pytest-dev__pytest-9359-1788258501025.db`

## Why this task mattered
This was the run that, under the INVALID earlier replay, "survived 5 rounds" while the live run
collapsed. That mismatch was the only obstacle to declaring content-independent reproduction. The
cause was the pre-correction instrument (terminal message fed back in, un-clamped content, stub
continuation), not the mechanism.

## Reconstructed history
- 24 messages (system + user + 11 assistant rounds, ending at a `bash` tool result, 158 B).
- The 12th `model.responded` (terminal, calls=0) is NOT included.
- Clamp applied; one result (>2,000 B) was re-clamped to match what the live model saw.

## Live model round-trips
| # | in | out | fin        | calls | dur (ms) |
|---|----|----|------------|-------|----------|
| 1 | 1302 | 118 | tool_calls | 1 | 6291 |
| 2 | 1360 | 44  | tool_calls | 1 | 1783 |
| 3 | 1431 | 38  | tool_calls | 1 | 1837 |
| 4 | 1598 | 187 | tool_calls | 1 | 5644 |
| 5 | 1678 | 165 | tool_calls | 1 | 4643 |
| 6 | 2407 | 131 | tool_calls | 1 | 6149 |
| 7 | 2505 | 281 | tool_calls | 1 | 7072 |
| 8 | 2630 | 68  | tool_calls | 1 | 2732 |
| 9 | 2729 | 59  | tool_calls | 1 | 2266 |
| 10 | 3276 | 103 | tool_calls | 1 | 4778 |
| 11 | 3891 | 141 | tool_calls | 1 | 6386 |
| 12 | 4006 | **90** | **length** | **0** | 3183 |

## Corrected replay result
```
R1 fin=length in=4004 out=91 calls=0 contentLen=0 wall=29710ms msgCount=24
  -> COLLAPSE at continuation round 1
```
Terminal `in` 4006→4004, `out` 90→91, `fin=length`, calls=0. Deterministic reproduction. The
earlier "no collapse" result is retracted as an instrument artifact.