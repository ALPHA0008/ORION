# Test 07 — Context pressure (Step 8)

## Method

14 files of ~3 KB each seeded into the workspace; the model was asked to read every one in order,
then write a summary. Real model, real tool outputs, projection size sampled after every
`model.responded`.

## Results

| metric | value |
|---|---|
| events | 136 |
| tool calls | 16 |
| messages total | 34 |
| **hot window** | **34** (cap 40) |
| dropped from hot state | 0 |
| **peak projection size** | **34232 B** (ceiling 96800 B) |
| input tokens | 30252 |
| terminal state | `completed` / `model_finished` |

## Verified

- **Hot state stayed bounded.** Peak 34232 B against a `WINDOW x MSG_CLAMP` ceiling of 96800 B.
- **Per-message clamping worked.** The largest message retained in hot state was ~2 KB, despite
  tool outputs of 3 KB+ — `MSG_CLAMP` is doing its job on real data.
- **Elision is counted, never silent.** `message_count == hot + dropped` held exactly.
- **Full history remains in the event log** — 136 events versus 34 hot messages.
- The model kept working coherently throughout and made real progress (16 tool calls).

## Honest limitation

This run accumulated 34 messages — enough to exercise clamping, **not** enough to force the
window to overflow (`dropped = 0`). The synthetic pressure test in
`tests/integration/provider.test.mjs` Test 7 does push past the window (122 messages, 82 dropped,
projection plateaus at 0.954x), but that is with a scripted provider.

**Not yet observed: how a REAL model behaves once earlier turns fall out of the window.** The
runtime injects an explicit `[N earlier messages are not shown]` notice, but whether the model
stays on task across that boundary is untested. This is the largest remaining context question.
