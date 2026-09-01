# Corrected replay comparison — flask-4045 vs pytest-9359 (+ pylint-7993)

All numbers from the corrected instrument (see corrected-replay-method.md).

| property                    | flask-4045      | pytest-9359     | pylint-7993     |
|-----------------------------|-----------------|-----------------|-----------------|
| live collapse               | YES             | YES             | YES             |
| corrected replay collapse   | YES (R1)        | YES (R1)        | YES (R1)        |
| live terminal input tokens  | 4086            | 4006            | 1452            |
| replayed terminal in        | 4086            | 4004            | 1451            |
| live terminal out tokens    | 9               | 90              | 14              |
| replayed terminal out       | 10              | 91              | 9               |
| live finish_reason          | length          | length          | stop            |
| replayed finish_reason      | length          | length          | stop            |
| messages before collapse    | 18              | 24              | 4               |
| tool results in history     | 8               | 11              | 1               |
| total clamped result bytes  | 6527            | 6167            | 0               |
| last tool before collapse   | read            | bash            | bash            |
| last result bytes           | 1565            | 158             | 0               |
| terminal content length     | 0               | 0               | 0               |
| continuation needed (R1)?   | no              | no              | no              |
| runtime conditions          | temp=0, seq     | temp=0, seq     | temp=0, seq     |

## What "R1 without continuation" means
In all three cases, replaying the exact pre-collapse state yields the SAME terminal empty
completion on the very next request, with token counts that match the live terminal to within
rounding (out 9↔10, 90↔91, 14↔9; in exact to 1–2 tokens). The model is not "driven" to collapse by
changing inputs — the collapse is a deterministic function of the accumulated request state at
that point.

## The two decisive axes
1. **Not content identity:** pylint-7993's history has 0 bytes of tool-result feedback, yet the
   same empty completion reproduces. (Compare the earlier bisections where replacing real content
   with stubs changed the outcome — these were invalid-instrument results and are retracted.)
2. **Not accumulation volume:** input tokens at terminal span 1452–4086 with no threshold; 2 of 17
   tasks collapsed after a single tool call.