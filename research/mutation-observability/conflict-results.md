# Conflict Results — Q6 (pre-effect conflict)

Probe: `eval/mutation-observability/attribution-conflict.mjs` · data: `results/attribution-conflict.json`

## The scenario

Identical for both arms: the tool prepares to change `a.py`, a **third party changes the file
first**, then the tool's effect runs.

## Result — a real asymmetry

| arm | captures witness | refused | third-party change preserved | final content |
|---|---|---|---|---|
| `bash` (`echo AGENT > a.py`) | no | **no** | **NO** | `AGENT` |
| `write` (witnessed) | yes | **yes** | **YES** | `THIRD_PARTY` |

`write` refused with an actionable error:

```
a.py changed since it was read (expected 123d98c79967, found bd325426bdfd).
Re-read the file and rea[pply]…
```

`bash` silently overwrote the concurrent change.

## Reading it honestly

This is the **same shape** as the phase-4 lost update ADR-011 was built to eliminate — but the
severity is not the same, and overstating it would be wrong:

- ADR-011's defect was in **recovery**: the runtime *itself* re-issued a landed write after a crash
  and destroyed a concurrent change. The system did the damage while believing it was safe.
- This is in **normal execution**: the agent asked to overwrite a file, and the shell did what
  shells do. `> file` is unconditional truncation by definition — there is no shell semantics under
  which it consults a prior hash.

Crucially, the runtime never *reasons* about a bash effect having landed safely, because the
classifier already refuses to: every mutating form is `UNSAFE` → escalate.

## Does a correctness gap exist?

**A capability gap, yes. A correctness gap in the runtime, no** — on this evidence.

The bar §6 sets is whether "the runtime prevents overwriting Sx". It does not for bash. But the
guarantee `write` provides is only meaningful *because the runtime supplies the witness*; for bash
the equivalent would require the runtime to know which files a command will touch **before running
it**, which is the static shell analysis the project has repeatedly and correctly declined to build.

The honest statement is therefore:

> `bash` offers no pre-effect conflict protection, and cannot be given ADR-011's protection without
> either a shell analyser or a fundamentally different sandbox (copy-on-write, overlay, or
> per-call snapshot). That is a **larger redesign**, not a small fix.

## Practical exposure in this project

Currently **zero**, and it is worth being precise about why rather than dismissing it:

- The capability runner is single-worker per task; no concurrent actor touches the tree.
- The verifier restores the oracle from git before judging, so agent edits to test files cannot
  change a verdict (25/25 anti-gaming attacks defended).
- No Stage-1 task verdict depended on a concurrent modification.

The exposure would become real with concurrent workers on one workspace, or with a human editing
alongside the agent. Neither exists today.
