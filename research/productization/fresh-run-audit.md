# Fresh-Run Audit — Mechanical Measurement

No developer persona. No fabricated usability feedback. Every line below is an executed command and
its actual output.

## Install steps — measured

| step | required today |
|---|---|
| clone the repo | yes |
| `npm install` | **impossible — no `package.json`** |
| build / transpile | **none** (plain ESM) |
| install dependencies | **none** (zero third-party) |
| make binary available | **not possible** — invoke as `node <abs-path>/v0/src/cli/index.mjs` |

**Install is: clone, then have Node ≥22.** Nothing else. The only missing piece is the manifest that
would make it an `npm i -g` / `npx`.

## Configuration steps — measured

Env vars only, all documented in `--help`:

| var | required | default |
|---|---|---|
| `HARNESS_BASE_URL` | **yes** to run | none |
| `HARNESS_API_KEY` | provider-dependent | none |
| `HARNESS_MODEL` | **yes** to run | none |
| `HARNESS_HOME` | no | `~/.harness` |
| `HARNESS_POSTURE` | no | `auto` |

No config file, no init command, no scaffolding. For a local Ollama user, two exports.

## Time to first invocation — measured

```
node <cli> --help      → usage, exit 0        instant
node <cli> doctor      → full env report      instant, creates ~/.harness + db
node <cli> run "…"     → live run             ~35s end-to-end (qwen3:8b, local)
```

The database is created on first use; no migration or init step.

## Unconfigured behaviour — measured

```
$ node <cli> run "fix calc.py"          # no env vars set
Run #1c77984311  <cwd>
────────────────────────────────────────────────
No model configured.
  Set HARNESS_BASE_URL (an OpenAI-compatible endpoint) and HARNESS_API_KEY.
```

The error is **clear, specific, and names the exact variables**. This is better than most tools at
this stage.

```
$ node <cli> doctor
  home              …/fresh2/.harness
  database          …/harness.db ok
  runs              1
  model endpoint    NOT SET (HARNESS_BASE_URL)
  api key           absent
  posture           auto
  stale leases      none
  db integrity      ok
```

`doctor` is a genuine diagnostic, not a stub.

## Full happy path — measured end to end

Fresh directory, one buggy file, local model:

```
$ node <cli> run "Fix the bug in calc.py: add() should return a+b not a-b"
Run #95044d62bb  <cwd>
  ✓ grep (no matches) [INCOMPLETE RESULT] 1 director(y/ies) unreadabl
  🙋 The file 'calc.py' is not found or is a directory. Please co
paused — awaiting_human
  resume with:  harness resume #95044d62bb
  history:      harness explain #95044d62bb
```

The run completed the loop, escalated durably, and printed the next commands. Then `status`,
`explain`, `replay`, `fork` and `list` all worked against it (see `trajectory-surface.md`).

## Blockers and defects found

| # | finding | severity | evidence |
|---|---|---|---|
| 1 | **No `package.json`** — cannot `npm install`, no `harness` binary | **blocking for OSS** | absent from repo |
| 2 | **`run` exits 0 when unconfigured** | **medium** | `exit=0` after "No model configured" — breaks scripting/CI |
| 3 | **`grep` with a file path returns ENOTDIR / "no matches"** | **high** | reproduced directly; caused the live agent to wrongly conclude `calc.py` was missing and escalate |
| 4 | `grep` with no path descends into `.harness/` | medium | returned event-log binary and `workspaces/*.git/hooks/*` |
| 5 | No `--version` | low | needs `package.json` |
| 6 | `doctor` does not probe endpoint reachability | low | reports `NOT SET`, never tries a request |

**Defect 3 is the most consequential.** It is not cosmetic: on the very first realistic task
attempted in a clean directory, a working file was reported as missing, and the agent escalated to a
human as a *correct response to bad information*. Any new user's first run is likely to hit it.

## What is NOT broken

- No install friction beyond the missing manifest.
- No hidden setup, no scaffolding, no migrations.
- Error messages name the fix.
- The CLI is location-independent (verified from `C:\`).
- 608 tests pass from a clean checkout with `node v0/tests/run-all.mjs`.

## Fixes required before v0.1 — documented, not implemented

1. Add `package.json` with `bin`, `exports`, `engines: >=22`. (Blocking.)
2. Fix `grep` file-path handling. (High — affects first-run experience.)
3. Exclude `.harness/` from `grep`. (Medium — leaks runtime state into agent context.)
4. Non-zero exit on configuration failure. (Medium — scriptability.)
