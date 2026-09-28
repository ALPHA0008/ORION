# FIX-winci / S4 GREEN — orion-implementer

STATUS: DONE. container/index.mjs: new detectRuntimeReport → {runtime, rejected:[{bin, os}]}; detectRuntime = wrapper (same return shape).
Per candidate: liveness probe → OS via `version {{.Server.Os}}` then `info {{.OSType}}` → explicit non-linux rejected, next candidate. Limits untouched.
cli/index.mjs makeSandbox: rejected-only case prints "runtime serves Windows containers: docker (windows)" + "Switch Docker Desktop to Linux containers … or use podman" + no-fallback note, exit 2. No-runtime message unchanged.
Decision: unknown/failed OS query → ACCEPT (podman lacks {{.OSType}}; old podman is Linux-only; wrong guess fails loudly at run, never falls back).
Evidence: wincontainers 7/0; winci-shipped 11/0; real Docker suites ran: sandbox 78, limits 23, network-live 26, matrix-container 27, w6 77, mcp/live 66 (all 0 fail);
typecheck/lint clean; contract 6/49; full npm test 2397/0/54.
NOT PROVEN: Linux fake shim (CI); real Windows-mode daemon; real podman.
