# Paging (§10)

Suite: `v0/tests/readpaging/readpaging.test.mjs` — **26 passed, 0 failed**.

Only the assertions' own regexes changed (`(\d+)\t` → `(\d+)\|`); they were coupled to the
separator. No paging behaviour was modified.

## Verified

| property | result |
|---|---|
| first returned line number correct | ✅ `offset=10, limit=3` starts at 10 |
| last returned line number correct | ✅ footer states `lines A-B of N` |
| content fidelity intact | ✅ full 400-line file reconstructs **exactly** by paging |
| no gaps between pages | ✅ every line of the file is reachable |
| no unintended overlap | ✅ footer's next `offset` is `last + 1` |
| **tabs faithfully represented** | ✅ 400 tab-indented lines round-trip |
| numbering cannot merge with content | ✅ delimiter is outside the whitespace alphabet |
| `offset` past EOF | reported, not thrown |
| `offset 0` | clamped to line 1 |
| single over-long line | returned, not dropped |
| sandbox truncation notice | still surfaced on **every** page |

## The core paging property still holds

```
every line of the file is reachable            ok   (400/400)
reconstructed content matches the file exactly  ok
paging terminates in a sane number of pages     ok
```

Phase 1's capability win — `read(path, offset, limit)` — is fully intact.

## Bound unchanged (§11)

`READ_PAGE_BYTES` = 1,500; `MSG_CLAMP` = 2,000; `WINDOW` = 40. **None were touched.** A page of
400 tab-indented lines measures 1,566 bytes new vs 1,497 old for the same 107 lines — the
difference is line-count-dependent packing, not a change in the bound. The separator is one
character in both formats, so **per-line cost is identical**.
