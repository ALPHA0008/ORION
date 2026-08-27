# Baseline — recorded before any change (Step 0)

**Date:** 2026-08-27
**Rule observed:** the harness was not modified before this baseline was recorded.

## Environment

| item | value |
|---|---|
| Node | v24.18.0 |
| OS | Windows 11 Pro 10.0.26100 (MINGW64_NT-10.0-26100) |
| Arch | x86_64 |
| SQLite | `node:sqlite` (built in to Node 24) |
| Runtime dependencies | **none** — no `package.json`, no `node_modules` |
| Build step | none |
| Git SHA | **N/A — `harness/` is not a git repository.** Version identity is the file tree itself. |

## Source size

```
src total          1,936 lines
  core               823
  agent              623
  sandbox+auth+cli   490
tests + benchmarks 1,912 lines
```

## Test baseline — 268/268

```
OK    unit/event-store          26 passed, 0 failed  (5.4s)
OK    concurrency/lease         45 passed, 0 failed  (2.2s)
OK    crash/matrix               6 passed, 0 failed  (12.6s)
OK    recovery/recovery         53 passed, 0 failed  (1.4s)
OK    replay/semantics          44 passed, 0 failed  (3.1s)
OK    integration/provider      53 passed, 0 failed  (7.3s)
OK    security/security         41 passed, 0 failed  (16.9s)
════════════════════════════════════════════════════════════
TOTAL: 268 passed, 0 failed across 7 suites
```

Reproduce: `cd v0 && node tests/run-all.mjs`

---

## Model availability audit (Step 1 prerequisite)

**Result: NO REAL MODEL IS REACHABLE FROM THIS ENVIRONMENT.**

### Credentials — none
```
ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY GOOGLE_API_KEY GEMINI_API_KEY
MISTRAL_API_KEY GROQ_API_KEY TOGETHER_API_KEY DEEPSEEK_API_KEY XAI_API_KEY
FIREWORKS_API_KEY PERPLEXITY_API_KEY CEREBRAS_API_KEY AZURE_OPENAI_API_KEY
AWS_ACCESS_KEY_ID HARNESS_API_KEY HARNESS_BASE_URL          -> none set
```

### Credential files — none
```
~/.anthropic ~/.config/anthropic ~/.openai ~/.ollama ~/.cache/lm-studio  -> absent
~/.aws                                                                   -> exists but EMPTY
                                                                            (no credentials, no config)
```

### Local inference servers — none
```
127.0.0.1:11434 (ollama)  1234 (LM Studio)  8080  8000  5000  4891  8081  -> nothing listening
```

### Inference binaries — none
```
ollama  llama-server  llamafile  lms   -> not installed
```

### Network — REACHABLE (this is the notable part)
```
api.openai.com/v1/models       -> HTTP 401   (reachable, needs auth)
api.anthropic.com/v1/models    -> HTTP 401   (reachable, needs auth)
openrouter.ai/api/v1/models    -> HTTP 200   (reachable, public model list)
bedrock-runtime.us-east-1      -> HTTP 404   (reachable, no credentials)
```

**The blocker is authentication, not connectivity.** A single API key for any
OpenAI-compatible endpoint unblocks every experiment in this phase — the adapter and CLI already
accept `HARNESS_BASE_URL` / `HARNESS_API_KEY` / `HARNESS_MODEL` with no code changes.

## Consequence for this phase

Steps 3–13 and 16–17 (every experiment requiring a real LLM) **cannot be executed here.**
Per the standing rule in this project, **no real-model behaviour is simulated, estimated, or
described as if it had been observed.**

What was done instead is recorded in `summary.md`:
- the real-model adapter was completed and hardened (Step 2),
- the full real-model experiment suite was **built and is runnable with one environment variable**,
- Step 14 (silent-degradation audit) was executed in full — it is a code audit and needs no model,
- Step 20 (security regression) was re-run.
