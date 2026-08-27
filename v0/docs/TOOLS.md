# Tools

V0 ships six. Each declares a **recovery contract computed from its arguments** (see `RECOVERY.md`).

| tool | effects | recovery class | verify() |
|---|---|---|---|
| `read(path)` | ReadOnly | `READ_ONLY` | — |
| `grep(pattern, path?)` | ReadOnly | `READ_ONLY` | — |
| `write(path, content)` | Mutating | `SAFE_RETRY` | hash the file |
| `edit(path, old_string, new_string)` | Mutating | `SELF_VERIFYING` | look for old/new |
| `bash(cmd)` | Mutating | **argument-dependent** | — |
| `ask_user(prompt, options?)` | ReadOnly | `READ_ONLY` | always escalates |

## Writing a tool

```js
export const myTool = {
  description: 'One line the model will read.',
  schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
  effects: 'ReadOnly' | 'Mutating' | 'External',
  recovery: (args) => ({ class: 'SAFE_RETRY', verify: () => 'applied' | 'not-applied' | 'unknown' }),
  run: async (args) => 'result',
};
```

### Rules

1. **Compute `recovery` from `args`.** If safety depends on the arguments — as it does for anything
   shell-shaped — say so. Do not return a constant.
2. **Provide `verify()` whenever the effect is cheap to check.** It converts an escalation into an
   automatic decision. This is the single highest-value thing a tool author can do.
3. **Prefer content-addressed arguments.** `edit(path, old, new)` is resumable because the effect
   destroys the precondition. `append(path, text)` is not. Design for `SELF_VERIFYING` where you can.
4. **Bound your output at the source.** The sandbox clamps at 64 KB, but a tool that returns a
   5,000-line file has already wasted the tokens.
5. **Default to `UNSAFE`.** If you cannot reason about it, escalating to a human is correct.

## Validation

Arguments are validated against `schema` before execution. A bad call becomes an explicit
`tool.failed` the model can read and adapt to — never a crash, never a silent no-op:

```
invalid arguments: missing required property: content; property path must be string, got number
```

Unknown tool names are rejected, not fuzzy-matched, and the error lists what is available.

## Authorization

Every call passes through the seam before it runs:

```
authorize({ kind:'tool', name, args_digest, effects, recovery_class, command? }, ctx)
  -> allow | deny | escalate
```

Denial is enforced by the runtime, not by asking the model nicely. A denied tool never reaches
`tool.started`.
