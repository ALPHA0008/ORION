# Model A Baseline — Gemma 4 31B (frozen)

Carried forward unchanged from earlier phases. No Gemma run was repeated for this experiment;
these are the committed artifacts.

## Runtime

| item | value |
|---|---|
| git revision | `9c1d0db713617c5d92ebe3c0940f7f746b75bfc8` |
| working tree | clean |
| OS | Windows 11 Pro 10.0.26100 |
| Node | v24.18.0 |
| regression suite at freeze | **441 passed, 0 failed across 16 suites** |

## Model

| item | value |
|---|---|
| model | `gemma4-31b` (`RedHatAI/gemma-4-31B-it-NVFP4`) |
| server | vLLM, OpenAI-compatible `/v1` |
| parameters | 31B dense |
| quantization | NVFP4 |
| context | 32,768 |
| sampling | server defaults (not explicitly pinned) |
| max output | harness default |
| tool-call mode | **text**, requires parsing |
| shim | `gemma-native-tool-calls` + `gemma-channel-markers`, ~100% of responses |

## Task set

22 bracketed tasks (4 easy / 10 medium / 8 hard) over 5 pinned repositories:
`is-number@98e8ff1d`, `slugify@7c318bd1`, `p-limit@df476048`, `ansi-styles@c1c3dd4e`,
`camelcase@3146708d`. Bracket status at freeze: **22/22 valid**.

## Results carried in

| run | success | source |
|---|---:|---|
| `v0-real-baseline` | 31.8% (7/22) | before paged `read` |
| `v0-real-iteration01` | 63.6% (14/22) | after paged `read` |
| **`edit-diagnostic`** | **68.2% (15/22)** | current head — **the comparison baseline** |
| hard-task repeats (3×) | 8/24 = 33.3% | `hard-repeat-gemma.json` |
| escalation probe | `ask_user` 0/6 (0/4 where correct; 2/2 controls correct) | `escalation-gemma.json` |

## Behavioural findings to be re-tested under Model B

| finding | phase |
|---|---|
| paged `read` doubled success (31.8% → 63.6%) | 1 |
| edit diagnostics did **not** raise `edit_recovery_rate` (67% → 67%) | 2 |
| `edit` failures were caused by our **TAB line-number separator**, not the primitive | 3 |
| model escapes to `write` after `edit` fails (5 write vs 1 corrected edit) | 2–3 |
| `ask_user` never called, even when escalation was correct | 2 |
| `write` misclassifies applied-then-changed → destructive reissue | 4 |
