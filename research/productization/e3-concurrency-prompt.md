ORION HARNESS — E3 CONCURRENCY MEASUREMENT (parallel-run ceiling against the real store)

CONTEXT
You are working in the ORION agent-runtime repo at D:\Abhijith P\Desktop\harness (Windows,
PowerShell 5.1, git bash). Everything up to Wave 10 is closed, a local model is a verified
worker (see research/productization/local-ollama-model.md — endpoint, config, PATH gotcha,
evidence run_ef0d26938a), and the E4 real-project evaluation exists or is in progress
(v0/eval/, research/productization/e4-real-project-report.md if present). E3 MEASURES THE
STORE'S CONCURRENCY CEILING — it does not build harness features. It answers one question:
can multiple runs write the same SQLite store at once without corruption/contention that
breaks runs? This data gates W13 ops sizing, W14 storage decisions, and container sizing.

READ FIRST
  - research/productization/local-ollama-model.md  (endpoint env, PATH gotcha — MANDATORY)
  - research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md  (§12 evaluation strategy;
    E3 = concurrency measurement 2/4/8/16)
  - research/productization/e4-real-project-report.md  (if it exists — reuse its runner
    conventions rather than inventing new ones)
  - v0/src/core/run/store.mjs, v0/src/core/replay/index.mjs  (the store and replay contract
    E3 must not violate)
  - v0/tests/run-all.mjs and v0/tests/results-* conventions (how this repo records outcomes)

ENDPOINT / ENV (identical to E4 — do not change)
  ORION_BASE_URL=http://localhost:11434/v1
  ORION_MODEL=qwen3.6:35b-a3b-q4_K_M
  ORION_API_KEY=ollama
  CRITICAL PATH GOTCHA (mandatory before every run):
    $env:PATH = "C:\Program Files\nodejs;C:\Users\abhijith.p\AppData\Local\Programs\Git\bin;C:\Users\abhijith.p\AppData\Local\Programs\Git\usr\bin;$env:PATH"

TASK — MEASURE, DO NOT BUILD
1) Zero new components unless strictly required by the measurement. Reuse the E4 runner if
   it exists: if v0/eval/run-e4.mjs is present, extend or wrap it with a concurrency
   driver; if absent, build a minimal runner v0/eval/run-e3.mjs following the same style
   (Node >=22, ESM, zero new deps).

2) DRIVER (run-e3.mjs):
   - Pick a small, fixed task set — REUSE the E4 tasks if available (same repos, same
     tasks, same temp-workspace-per-run copying so runs never corrupt source repos). If
     E4 doesn't exist yet, use 2-3 trivial-but-real tasks (read + verify) on ONE of the
     repos in research/repos/ — enough work that generation time dominates setup.
   - Run the SAME store, the SAME sandbox base, the SAME task set at these concurrency
     levels: 1, 2, 4, 8, 16 concurrent processes (each a separate `node
     src/cli/index.mjs run` process; ORION_WORKSPACE must point INSIDE the shared test
     workspace so every run writes the SAME run.db).
   - Each level: at least 2 repetitions so variance is visible.
   - Record per level: wall time per run, total wall time, and OBSERVABLE
     errors/corruption — from the CLI's own status/explain output, and from a store
     integrity pass (replay each run; any replay mismatch or failed invariant is a FAIL).
   - Compare against 16-24 free CPU cores available locally (Core Ultra 9 285K).

3) PASS/FAIL CRITERIA (write these in the report, don't discover them after):
   - PASS: all runs at level N completed, every run replays clean, no interleaving
     corruption, no deadlock/timeout that a serial run would not also hit.
   - The store is the single writer — expect contention; the number you're producing is
     THE CEILING (the highest N that passes + a note on what broke at N+1).
   - A corrupted run (replay mismatch, wrong events, lost lease) is a FAIL regardless of
     wall time — the store's invariants outrank throughput.

4) REPORT
   Write research/productization/e3-concurrency-report.md, §11.4 honest style:
   - the measured table: level | mean wall/run | total wall | failures | replay status;
   - the ceiling number and the exact failure mode just above it (quote from CLI output);
   - what this does NOT prove: it is one store, one workload, one machine — not a
     capacity claim for Postgres or multi-machine; it is the SQLite-single-file ceiling
     only;
   - implication line for W13 (ops sizing) and W14 (storage): what the number implies
     about running 2 devs in parallel today.
   If E4 already exists, cross-link the two reports.

STANDING REPO RULES (non-negotiable)
  - NEVER commit results-*.json, run.db*, wg-fixtures/, wg-homes/, archify-out/.
  - NEVER `git add -A` / `git add .`. Stage ONLY intended files.
  - Event-log contract frozen at v6/49 — NO new event types.
  - No new npm dependencies.
  - Do NOT modify v0/src/** except a genuine bug; report such a bug in the report's
    how-we-found-it section with the smallest proposed fix — do not silently refactor.
  - Honesty: a result with no failure ledger is a defect. A concurrency test that hides
    corruption to report a higher number is the worst kind of defect in this repo.

ENVIRONMENT NOTES
  - Node v24.18.0 at C:\Program Files\nodejs\.
  - Only Ollama model installed: qwen3.6:35b-a3b-q4_K_M. Do NOT pull others.
  - Ollama default concurrency: watch for order-of-magnitude slower generation under load
     (num_parallel / num_gpu behavior) and note it — but the RUNS are what we measure, and
     the runner must wait for each process just like a real operator would.
  - %TEMP%\opencode is the approved scratch area for temp workspaces.

DELIVERABLES (in order, stop after each for user check like E4)
  1. v0/eval/run-e3.mjs (or the E4 extension) — dry-run at level 1 to prove the harness
     still passes single-Process control, then scale up.
  2. The measured table + ceiling number + failure mode at the ceiling.
  3. research/productization/e3-concurrency-report.md.