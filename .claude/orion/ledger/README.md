# Team ledger — append-only

One file per specialist handoff, written by the orchestrator only:

`<YYYY-MM-DD>-<phase>-<NN>-<agent>.md` — e.g. `2026-09-29-P0-01-orion-architect.md`

Each file holds the verbatim `=== ORION HANDOFF ===` block (see `../PIPELINE.md` §4), plus an
optional orchestrator note below it. Files are never edited after they are written; a correction
is a new file that references the old one. This is the team's own event log.
