# The `read` Path — Traced (§2)

```
model
  ↓ tool_call { path, offset?, limit? }
Worker.#invokeTool                       validate → authorize → captureWitness (write only)
  ↓ tool.run(args)
tools.read.run → readPaged(sandbox, …)
  ↓ sandbox.read(p)
fs.readFileSync(abs)                     ← BYTES
  ↓ buf.toString('utf8')                 ← bytes become TEXT (UTF-8 decode)
clamp(text, `file ${p}`)                 ← sandbox bound, 64 KB, splices a truncation marker
  ↓
readPaged:
  raw.split('\n')                        ← LINE SPLITTING
  pop a trailing empty element
  slice by offset/limit
  `${n.padStart(width)}\t${line}`        ← NUMBERING + SEPARATOR  ◄── THE DEFECT
  budget by READ_PAGE_BYTES (1,500)      ← TRUNCATION, after numbering
  header / footer / truncation notice
  ↓ returns a string
Worker: append('tool.succeeded', { result: String(out) })   ← EVENT TRUTH
  ↓
projection: push({ role:'tool', content: p.result })        ← MODEL VIEW
  clampContent → MSG_CLAMP (2,000)
```

## Where each transformation happens

| stage | location | note |
|---|---|---|
| bytes → text | `sandbox.read` | `buf.toString('utf8')` — one decode, no re-encode |
| sandbox bound | `clamp()` | 64 KB; splices `…[file X truncated: N bytes > L limit]…` |
| line splitting | `readPaged` | on `\n` only — a `\r` therefore stays **attached to the line** |
| line numbering | `readPaged` | right-aligned to the width of the total line count |
| **separator** | `readPaged` | **a literal TAB — merges with source indentation** |
| truncation | `readPaged` | **after** numbering, budgeted in characters against `READ_PAGE_BYTES` |
| projection clamp | `projection.clampContent` | `MSG_CLAMP` 2,000, appends a `…[+N chars]` notice |

## Findings

1. **The separator is the only distortion.** Tabs stay tabs, newlines stay newlines, the decode is
   a single UTF-8 pass with no re-encode. Nothing else rewrites source bytes.

2. **Truncation happens after numbering**, so a page boundary can never split a line number from
   its content.

3. **`\r` is preserved but invisible.** Splitting on `\n` leaves `\r` at the end of a CRLF line, so
   the model sees it only as an unexplained trailing character. Byte-faithful, but not
   *unambiguous* — relevant to the §4 contract.

4. **There is exactly one rendering.** `tool.succeeded.result` is both what the log records and
   what the projection shows the model, so §22's "model saw A, log recorded B" corruption is
   structurally impossible here.

5. **Two independent bounds** — sandbox 64 KB and page 1,500 chars — both stay untouched (§11).
