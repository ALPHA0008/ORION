# Corrected replay — pylint-dev/pylint-7993 (minimal-state content-causality test)

Source DB: `Temp/capability-v1/_runs/pylint-dev__pylint-7993-1788257986183.db`

## Purpose
Isolate whether the collapse requires real accumulated tool-result CONTENT at all. This task is
the sharp instrument for that: the live run collapsed after **a single bash call whose result was
0 bytes**, at only ~1,400 input tokens. If the empty completion reproduces from that minimal
state, then content identity is not the mechanism.

## Reconstructed history
- 4 messages: system + user + ONE assistant bash call + ONE tool result (0 bytes).
- Terminal `model.responded` (calls=0, out=14, fin=stop) NOT included.
- Total clamped tool-result bytes in history: **0**.

## Live model round-trips
| # | in | out | fin | calls | dur (ms) |
|---|----|----|-----|-------|----------|
| 1 | 1393 | 158 | tool_calls | 1 | 7297 |
| 2 | 1452 | **14** | **stop** | **0** | 1178 |

## Corrected replay result
```
R1 fin=stop in=1451 out=9 calls=0 contentLen=0 wall=6073ms msgCount=4
  -> COLLAPSE at continuation round 1
```
Reproduced: `fin=stop` (matches live), calls=0, in 1452→1451, out 14→9. The terminal empty
completion reproduces deterministically from a state whose only tool feedback is an EMPTY result.

## Consequence
Content-identity is not a necessary condition: the same empty-completion behavior arises with
zero tool-result content. Whatever the mechanism is, real tool-result content is not its trigger.