# P0 / S6 VERIFY triage (sandbox/limits) — orion-failure-analyst

Classification: RIG — Docker Desktop 29.8.1 on WSL2 runs cgroup v1 (docker info: Cgroup Version 1, cgroupfs).
limits.test.mjs:70-72 reads cgroup v2 files (/sys/fs/cgroup/cpu.max etc.) → SandboxError before any assertion → exit 1, 0 assertions.
MEASURED (n=1): with product flags --cpus 1.0 --memory 512m --pids-limit 256, v1 files show cfs_quota 100000/100000, memory 512MiB, pids.max 256 → limits DO bind.
Independent of P0: git diff for src/sandbox and tests/sandbox empty.
Test defect (secondary): v2-only assumption; should detect layout (v2 / v1 equivalents / loud SKIP-with-reason), keep channels 2+ running; real FAIL only if files show no limit.
§11.4: W6.1 "limits bind" NOT re-proven on this rig; enforcement under load (channels 2+) not run here; alpine:latest pulled during triage.
Options: user switches WSL2 to cgroup v2 (.wslconfig kernelCommandLine=cgroup_no_v1=all + wsl --shutdown), and/or version-aware test (outside P0 unless approved).
