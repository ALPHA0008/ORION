# Baseline Lock — CAPABILITY_V1_STAGE1

Everything that must be held constant for a baseline number to mean anything. Recorded **before**
the baseline runs, so the configuration cannot be retrofitted to the result.

**Label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

## Identity — the three coordinates

| coordinate | value |
|---|---|
| corpus version | `CAPABILITY_V1_STAGE1` |
| corpus sha256 | `0a9a279d48a491dacdadfd714c2c588bfb8a79adb4d536680241f1ebcf8300bb` |
| corpus size | 17 tasks |
| runtime commit | `7d5e5b6` (V0 runtime unchanged since `d6c2c77`) |
| `git status --porcelain v0/src` | **empty** — Rule 9 verified |

## Runtime configuration — shipped defaults only

| setting | value | note |
|---|---|---|
| system prompt | `DEFAULT_SYSTEM`, 320 chars, sha256 `eeab8d89…` | unmodified |
| tools | `read`, `grep`, `write`, `edit`, `bash`, `ask_user` | full surface, unrestricted |
| authorizer | `posture: permissive`, `escalateUnsafeRecovery: false` | measures capability, not approval UX; hard denials still apply |
| `completionContract` | **not set** | ADR-013 is opt-in; the baseline is the shipped default |
| `ACTION_PROMPT` | **not set** | phase-9 experiment, never shipped |
| `compactContext` | **false** | ADR-001 bounded projection only (`WINDOW=40`, `MSG_CLAMP=2000`) |
| `maxTurns` | 40 | |
| task timeout | 900 000 ms (15 min) | |
| budget | 4 000 000 tokens · 600 tool calls · $100 | effectively non-binding; turns/time bind first |
| Node | v24.18.0 | |

## Model arms — identical except the endpoint

| | Gemma | Qwen |
|---|---|---|
| model id | `gemma4-31b` (`RedHatAI/gemma-4-31B-it-NVFP4`) | `qwen3.6:35b` |
| server | vLLM · `172.20.7.22:8000/v1` | Ollama · `localhost:11434/v1` |
| context window | **32 768** | **262 144** |
| tool calls | via `applyGemmaToolCallShim` | native |
| warm latency (trivial call) | **56 ms** | **2 560 ms** |

**These serving environments are not equivalent and no artifact will pretend otherwise.** Two
asymmetries are load-bearing:

1. **Context: 8×.** On real repositories this is a live alternative explanation for any Gemma
   failure involving lost context, and must be ruled out from the trajectory before a capability
   claim is made.
2. **Speed: ~45×.** Qwen is the arm at genuine risk of `TIMEOUT`. Per §19, any timeout or
   finite-progress asymmetry is **deployment-attributable unless the trajectory proves otherwise**.

The shim is an adapter difference too: a Gemma-only failure in tool-call construction is
`ADAPTER_SPECIFIC`, not `MODEL_SPECIFIC`, and §23 keeps those apart.

## Verification — frozen with the rest

- `pytest` exit status. **No LLM judge anywhere in the path** (§11).
- Success requires `FAIL_TO_PASS` to pass **and** `PASS_TO_PASS` not to regress.
- `PASS_TO_PASS` capped at 25 ids; ids that are unrunnable (upstream truncation), uncollectable at
  this commit, or unaddressable by pytest (`::` inside a parameter) are excluded **and counted**
  per task, so coverage is never overstated.
- The oracle is restored from git before every verdict, so edits to test files are discarded.
  Proven by 25/25 anti-gaming attacks defended, with gold-patch positive controls through the same
  path.

## Smoke test (§14) — passed before scaling

5 tasks × Gemma against this exact configuration: **3 PASS / 2 FAIL**, no infrastructure defects.
Checkout, sandbox, tools, trajectory recording, verifier, cleanup and persistence all exercised.

Both failures were **correctly scored agent failures**: the agent edited only test files and never
touched source, so oracle-restore discarded the work and the target test still failed. That is the
anti-gaming defence firing on live runs rather than on synthetic attacks.

## Repeats

1 per task (§17). No variance estimate; single-run results are not to be read as stable behaviour
(§26).
