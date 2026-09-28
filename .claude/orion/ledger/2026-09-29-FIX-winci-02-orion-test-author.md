# FIX-winci / S3 RED — orion-test-author

STATUS: DONE (RED on Windows). New: tests/_helpers/fake-docker.mjs (fake docker/podman first on PATH; windows|linux|dead modes; invocation log;
Windows = node.exe hard-linked as docker.exe + --require preload; Linux = /bin/sh shim), tests/sandbox/wincontainers.test.mjs, tests/shipped/winci-shipped.test.mjs; run-all registers both.
RED: wincontainers 4/3 (detectRuntime returns "docker" for OSType=windows; no fallthrough to linux podman); guards green (linux detected; dead→null; detection never runs `docker run`).
RED: winci-shipped 1/10 — reproduces the CI failure (docker run --pids-limit ... PidsLimit error), exit 1 not 2, no actionable message.
GREEN requires: detectRuntime checks OSType (info {{.OSType}} / version {{.Server.Os}}), non-linux = unusable, try next candidate; makeSandbox refusal names windows containers + "switch Docker Desktop to Linux containers".
NOT PROVEN: Linux shim branch (CI will exercise); ~80MB copy if hard link crosses volumes; full suite not run.
