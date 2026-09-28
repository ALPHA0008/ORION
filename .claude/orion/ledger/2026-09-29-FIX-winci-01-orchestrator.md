# FIX-winci / S1 — orchestrator triage from user-supplied CI logs

Evidence (user pasted, run 36488558856 job 109151329529, Node 24.21.0 windows-latest):
crash/matrix-container 7/20 FAIL (status stays "running", world ∅/∅); sandbox/sandbox, sandbox/limits, sandbox/network-live, shipped/w6-shipped exit 1 with
`docker: Error response from daemon: invalid option: Windows does not support PidsLimit` on `docker run ... --pids-limit 256 ... alpine:3`.
Second excerpt (older run, pre-P0): w6-shipped exit 2 after "ORION_SANDBOX=container was requested but no container runtime is available" — the in-process process.exit(2) path (P0-03 inference now observed).

Classification: RUNTIME (container runtime detection) + RIG. detectRuntime accepts a daemon that answers but runs WINDOWS containers (GitHub windows-latest default); Linux image alpine:3 cannot run there at all — PidsLimit is only the first rejection.
Rejected fix (external suggestion): drop --pids-limit on Windows = silent weakening of a declared limit (forbidden; fail-open) and would not work (Linux image still unrunnable).
Approved fix (user, 2026-09-29): detectRuntime must require a Linux-container engine (e.g. `docker info` OSType == linux / `{{.OSType}}`); Windows-container mode → "no usable container runtime" → product refuses fail-closed with actionable hint; tests skip loudly as on no-Docker hosts.
Pipeline: FIX → test-author (RED) → implementer → invariant + security review → gate (local) → commit (approval) → push → CI.
