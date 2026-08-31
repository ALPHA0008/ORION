# Trajectory-Level Differential Analysis (§16)

## Task-level split

| group | n | tasks |
|---|---:|---|
| both PASS | 2 | `isnum-string-trim`, `slug-preserve-conflict` |
| Gemma only | 13 | most of medium/hard |
| Qwen only | 1 | `isnum-nan-guard` |
| **neither** | 6 | `ansi-brightness-bit`, `camel-leading-capital`, `camel-numbers-identifier`, `camel-preserve-consecutive`, `slug-decamelize-acronym`, `slug-trailing-separator` |

## Qwen's dominant failure: correct diagnosis, no action

19 of 19 Qwen failures are `no_edits_made`. These are **not** confused runs.
`camel-unicode-uppercase` (0 edits, `model_finished`):

> The problem is clear. On line 1: `const UPPERCASE = /[A-Z]/u;`
> This regex only matches **ASCII** uppercase letters… The fix is to use the Unicode property
> escape `\p{Lu}`, consistent with how `LOWERCASE` already uses `[\p{Ll}]` on line 2.

Right line, right cause, right fix, and corroborated against a neighbouring line — then it
stopped and reported prose instead of calling `edit`. `camelcase` was **0/7 with zero edit
attempts on all seven tasks.**

## Second Qwen-specific mechanism: absolute-path assumptions

Qwen repeatedly searched paths that do not exist in this harness:

```
find /home/user -maxdepth 3 -type f ...
ls -la /
find /tmp -maxdepth 3 -name ...
for d in /tmp/fx-*/; do echo ...
```

and addressed files as `/index.js`, `/testbed/index.js`, `/tmp/harness-real-eval/work/.../index.js`.

| | Gemma | Qwen |
|---|---:|---:|
| `path escapes sandbox` denials | **0** | **28** |
| runs containing at least one denial | 0 | **14 of 22** |

**Containment held on every one.** Tested directly against the exact paths Qwen used:

```
READ  /index.js                            -> blocked: path escapes sandbox
READ  /testbed/index.js                    -> blocked: path escapes sandbox
READ  /tmp/harness-real-eval/work/x/...    -> blocked: path escapes sandbox
WRITE /etc/pwned.txt                       -> blocked: path escapes sandbox
escaped file exists on host? false
```

The security property is intact. But the *capability* cost is real: Qwen burned turns on denied
paths, contributing to its `no_edits_made` rate. `/testbed` in particular suggests training on a
harness that uses that convention.

**Correction to an earlier count in this analysis:** an initial grep reported "15 containment
violations". That was a false positive — it matched the word *escape* in task text about regex
escaping. The real figure is **28 denials, 0 violations**, established by executing the paths
rather than pattern-matching logs.

## First divergence on the 6 shared failures

| task | Gemma | Qwen |
|---|---|---|
| `ansi-brightness-bit` | `no_progress`, **0 edits** | `no_edits_made`, 0 edits |
| `camel-leading-capital` | `no_progress`, **0 edits** | `no_edits_made`, 0 edits |
| `camel-numbers-identifier` | `no_edits_made`, **0 edits** | `no_edits_made`, 0 edits |
| `camel-preserve-consecutive` | `no_progress`, 9 edits | `no_edits_made`, 0 edits |
| `slug-decamelize-acronym` | `no_progress`, 2 edits | `no_edits_made`, 0 edits |
| `slug-trailing-separator` | `budget_exhausted`, 10 edits | `no_edits_made`, 0 edits |

**On 3 of 6, Gemma also made zero edits.** Different labels, same event: analysis completed, no
mutation issued. This is the phase-2 "stage 5 — select-edit" failure appearing in **both** models.

## The one Qwen-only pass

`isnum-nan-guard`: Gemma looped through 11 model calls of `bash` probes and died on
`no_progress`; Qwen went `bash bash bash read read read **edit** bash` — read, edited once,
verified, done. When Qwen does act, it acts efficiently (duplicate action rate **0.002** vs
Gemma's 0.268).

## Classification (§17)

| observation | label |
|---|---|
| Gemma's `old_string not found` storm | **HARNESS-SPECIFIC** — our TAB read separator (phase 3) |
| Gemma's `degraded` on 343 responses | **ADAPTER-SPECIFIC** — vLLM without a tool-call parser |
| Gemma's `write` fallback | **MODEL-SPECIFIC**, conditional on the harness defect |
| Qwen's absolute-path attempts | **MODEL-SPECIFIC** — trained on a different workspace convention |
| Qwen's `no_edits_made` at 19/19 | **MODEL-SPECIFIC** |
| **"diagnose but don't act" (stage 5)** | **shared across both models — strongest harness candidate** |
| **`ask_user` 0/6 in both** | **HARNESS / POLICY-SPECIFIC** — see [escalation-comparison.md](escalation-comparison.md) |
