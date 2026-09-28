# FIX-winci / S5 REVIEW — orion-invariant-reviewer

VERDICT: APPROVE (0 CRITICAL/HIGH, 3 LOW). Ran wincontainers 7/0, winci-shipped 11/0.
detectRuntime callers audited (cli:1115 reap, container:134 ctor, :358/:378 prune/list, index.mjs:107 export, 6 suites) — compatible.
Inv 8: resume under Windows-mode daemon → loud exit 2, never local fallback. Pre-run rejection → stderr + exit 2 (no run to attach degraded to) — correct.
process.exit(2) in makeSandbox unchanged in kind. Tests honest (fail if OS check removed). Linux shim read, correct by inspection, NOT PROVEN until CI. cli/index.mjs is LF.
LOW: ContainerSandbox ctor error doesn't surface rejected runtimes; LOW: on Windows CI container suites now SKIP → Linux CI leg must stay mandatory; LOW: 'no value' text match brittle.
Orchestrator decision: all 5 LOWs (2 security + 3 invariant) → backlog, not blocking; commit + push to verify on CI.
