# Forking

```
fork(run, at)   new Run seeded with history[1..at]. The future is NEW.
```

```bash
harness fork #a81f2c --at 23
forked #a81f2c @23 -> #5cb406
```

The fork inherits everything up to event 23 as historical fact, records its provenance
(`parent_run_id`, `forked_from_seq`), and marks the boundary with a visible seam event so
`explain` shows where inherited history stops.

The source run is never modified. It still replays identically after being forked.

## Forking a run does not fork the world

**This is the sharp edge.** The event log branches; your filesystem does not. If you fork to a point
before an edit, but the edit is still applied on disk, the fork will reason about a state that does
not exist.

The CLI says so rather than pretending:

```
note: the WORKSPACE is not rewound automatically.
      run the fork in a fresh workspace, or restore a checkpoint first.
```

## Workspace checkpoints

`attachCheckpoints(sandbox, shadowDir)` gives the sandbox a bare **git shadow repo** — a separate
`.git` that never touches your own:

```js
const ref = sandbox.snapshot('before edit');
// … agent does things …
sandbox.restore(ref);        // byte-exact
```

Restores are byte-exact (`core.autocrlf=false` — an earlier version silently rewrote line endings
on Windows, which makes a checkpoint worse than useless).

Take a checkpoint before each authorized tool call, and a fork can rewind the workspace to its
fork point.

## Cost

Fork copies events by INSERT, so it is O(n):

| events | fork |
|---:|---:|
| 1,300 | 1.9 ms |
| 10,300 | 12.1 ms |
| 100,300 | 154 ms |
| 1,000,300 | **1,860 ms** |

Fine interactively. Copy-on-write is needed before million-event runs are routine.
