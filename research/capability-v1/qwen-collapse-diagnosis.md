# Qwen 3.6 35B empty-completion collapse — diagnosis in progress

## Status
**RESOLVED — see `qwen-empty-completion/` in this directory for the completed analysis
(18 deliverables, final decision `QWEN_INTERACTION_MECHANISM_CONFIRMED`).** The corrected replay
instrument reproduces the empty terminal completion deterministically on flask-4045, pytest-9359,
and the minimal-state pylint-7993 (0 B tool feedback), with token counts matching the live
terminal. `NO_COMMON_*` antecedent across the 17 runs. Content-causality and serving-state both
refuted. This note is retained as the working timeline; the definitive record lives forward.

## The phenomenon
Qwen 3.6 35B (Ollama OpenAI-compat `localhost:11434/v1`, native tool calls) terminated
all 17 Stage-1 tasks with an empty completion: terminal `model.responded` with
`content=''`, `tool_calls=[]`, mostly `fin=length`. Every task `model_finished`, all
`turns=1`, durations 9–125s. No timeout, no max-turns, no context-limit (262K window,
inTokens only ~3–4K).

## Falsified hypotheses (in order)
1. **max_tokens=2048 cap** — falsified: terminal outputs 9–590 tokens, isolation probe
   generated 428 tokens cleanly with `fin=stop`.
2. **Qwen cannot sustain long tool loops** — falsified: 14-round controlled loop with
   fake results never collapsed.
3. **Message-count / loop-length threshold** — falsified: control loop reached 65
   messages (30 rounds) without collapse.
4. **Context / token budget** — falsified: inTokens only ~3–4K, window 262K.
5. **Temperature** — not the difference: harness uses temp=0, replays use temp=0.
6. **Single specific tool result string** (WSL "path escapes sandbox", `ls /testbed`
   failure, empty bash find, etc.) — falsified: replacing any single error/empty result
   with a benign stub still collapsed in flask-4045.
7. **Content volume alone** — falsified: same-length benign filler (lorem-ipsum control)
   survived 5 continuation rounds where real content collapsed.
8. **Stub-continuation hybrid is a faithful mirror** — likely falsified: see
   counterexample below.

## Established facts (reproducible)
- Replaying flask-4045's actual 18/19-message history (harness `DEFAULT_SYSTEM` prompt,
  temp=0) against Qwen collapses deterministically within 2–4 continuation rounds
  (`fin=length`, out 2–35 tokens, empty).
- Replacing the four large real-content results of flask-4045 (the 1527-char `ls -la`
  dump, the 1498-char listing, the 1515-char paginated source read, and a second read)
  with benign stubs → survives 5 rounds, no collapse.
- Replacing ALL tool results with stubs → survives 5 rounds.
- Same-length benign filler (not real content) → survives 5 rounds.
- => In flask-4045 the real *content* of accumulated tool results (actual path
  listings + source lines of blueprints.py) is causally implicated in the collapse.

## Counterexample / not yet conclusive
- The **same replay method does NOT reproduce** for pytest-dev__pytest-9359: its
  all-real 25-message history survives 5 continuation rounds (real run collapsed at
  that point). So my stub-continuation replay is not a faithful mirror of every
  original run.
- All 17 real runs collapsed (universal empirically), but only flask-4045 reproduces in
  the hybrid replay. The universality in real runs vs non-reproduction of one replay
  suggests collapse also depends on the runtime interaction (real tool results
  streaming back and accumulating) or run-time serving state.

## Current best hypothesis
Qwen 3.6 35B's Ollama OpenAI-compat endpoint has a **content-and-interaction-dependent
empty-completion failure** in the harness tool loop: convolving real accumulated tool
results, it sometimes (often) emits an empty `fin=length` completion. Not a harness
schema bug, not token/loop/temp. In flask-4045 the real source-content results are
clearly causal; for other tasks the trigger is not isolated.

## Implications
- No runner-only fix is validated yet. Rerunning with a naive change (max_tokens bump,
  temperature tweak) is unsupported.
- The 0/17 Qwen run remains uncommitted/un-quarantined pending this diagnosis.
- A runner-side *detection/retry* (treat empty completion as a model failure and allow
  recovery) is a candidate, but is an intervention not yet approved and touches the
  frozen method; must be justified as infra/model-interaction failure handling.

## Data sources
- `eval/capability-v1/runs/qwen3.6_35b.json` (0/17), `qwen3.6_35b.log`.
- flask-4045 DB: `Temp/capability-v1/_runs/pallets__flask-4045-1788257486085.db`.
- pytest-9359 DB: `Temp/capability-v1/_runs/pytest-dev__pytest-9359-1788258501025.db`.
- Replay scripts (throwaway, in `$env:TEMP`): extract4.mjs, replay2.mjs, control.mjs,
  bisect3/4/5/6.mjs.

## Next steps (uncommitted)
Option A — finish bisection on a second reproducing task to confirm content-causality
across tasks before declaring a mechanism.
Option B — test a runner-side empty-completion retry/continue mechanism on flask-4045
(replay only) to see if a practical recovery is possible without breaking the frozen
method.
Option C — stop and treat the Qwen arm as unusable under this harness (quarantine run),
keep Gemma 3/17 as sole baseline, record defect as a model-interaction failure in the
failure table.