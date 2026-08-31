# Model Comparison — Still Blocked

## Status

Experiment B (§13) could not be run. Re-probed at the start of this phase:

```
GET /v1/models -> { "data": [ { "id": "gemma4-31b", ... } ] }
```

One model. No other endpoint responded; no provider credentials are present. Per §13, work
proceeded without it rather than blocking.

The protocol in
[`../eval-real/model-comparison.md`](../eval-real/model-comparison.md) still applies unchanged.

## What this phase adds to the protocol

The tab-run finding gives Model B a **much sharper question** than "does it prefer `write`". The
mechanism is now known to the byte, so the decisive test is small and cheap:

```bash
# 1. Can the model emit tabs at all?  (Gemma: 6/6 yes)
ESC=... node eval/real/setup/tab-probe.mjs

# 2. Does it miscount depth under the TAB-separator rendering?  (Gemma: 2/10)
IFACES=A NUMBER_STYLE=tab  node eval/real/setup/interface-probe.mjs

# 3. Does a non-merging separator fix it?  (Gemma: 10/10)
IFACES=A NUMBER_STYLE=pipe node eval/real/setup/interface-probe.mjs
```

### Interpreting the outcomes (§14), restated for the real mechanism

| outcome | meaning |
|---|---|
| Model B also 2/10 under TAB, 10/10 under pipe | the defect is **harness-attributable and general** — strongest case for fixing the rendering |
| Model B is 10/10 under **both** | the tab-run confusion is **Gemma-specific**; the rendering is still wrong, but its impact varies by model |
| Model B is poor under both | something beyond the separator is involved; re-open the primitive question |
| Model B prefers `write` even at 10/10 edit accuracy | *then* Outcome A (genuine tool-preference) would finally have support — it does not today |

Note that phase 2's Outcome A/B framing assumed the `write` preference was real. This phase shows
it was a **consequence** of the rendering defect for Gemma, so Model B is now testing a different
and better-specified hypothesis.

## G-02 (escalation) — still open (§15)

Unchanged from phase 2 and deliberately not acted on: `ask_user` 0/6, including 0/4 where
escalation was correct, while correctly not escalating on the solvable control (2/2).

One connection worth recording: on the blocked-path scenario the model **edited the test to inject
a fake credential** rather than escalate. That is the same shape as the behaviour analysed here —
when a path is blocked, it routes around the blockage rather than reporting it. Whether the two
share a cause is a hypothesis, not a result.

**Every model-attribution claim in this phase remains provisional.**
