# FIX-winci / CI triage round 2 — orchestrator (from user-pasted log, job 109160251205)

Product fix CONFIRMED on CI: w6-shipped output shows "runtime serves Windows containers: docker (windows) … Switch Docker Desktop to Linux containers … Refusing to fall back".
52/54 suites pass on windows-latest. Remaining 2 = instrument (test guard) defects:
1. mcp/live: tests/mcp/live.test.mjs:317 constructs ContainerSandbox in the "server runs INSIDE the container" section without the detectRuntime skip guard → SandboxError runtime_missing (exit 1).
2. shipped/w6-shipped: "W6.1: ORION_IMAGE reaches the container backend" section calls makeSandbox in-process with no runtime → CLI refusal process.exit(2) kills the test process (library-level exit, noted P0-03).
Rejected: external suggestion to run the full suite on Ubuntu only (drops 52 passing Windows suites; Windows is first-class).
Next: orion-test-author — make both sections use the same skip guard as sibling sections; reproduce locally with fake windows docker (tests/_helpers/fake-docker.mjs); no src edits.
