# Experiment 2 — Tool Recovery Classification

**Corpus:** the 86 tools actually registered in Hermes (`hermes-agent@d62a05e9`), extracted by parsing
every `registry.register(...)` call in `tools/*.py`, plus the 6 proposed V0 tools.
**Method:** classify by the question *"the process dies after the effect but before
`tool.succeeded` is written — what happens if the runtime re-issues the call?"*
34 tools classified below; 12 verified by executable simulation (`simulate.mjs`).

---

## 0. Baseline finding: nobody declares this today

`tools/registry.py:204-212` — the complete `ToolEntry.__slots__`:
```python
__slots__ = ("name", "toolset", "schema", "handler", "check_fn",
             "requires_env", "is_async", "description", "emoji",
             "max_result_size_chars", "dynamic_schema_overrides")
```
**No `effects`, no `idempotency`, no `read_only`.** The most mature harness in the audit carries no
recovery metadata whatsoever. So the proposed contract is not a refinement of prior art — it is new,
and `OPEN-QUESTIONS.md` E-04 was right to flag it as the least-evidenced decision in the design.

---

## 1. Classification taxonomy (revised — see `results.md` §3 for why)

| Class | Meaning | Re-issue after crash |
|---|---|---|
| `READ_ONLY` | no world effect | always safe |
| `MUTATING_SAFE_RETRY` | `f(f(x)) == f(x)` for these args | safe |
| `MUTATING_SELF_VERIFYING` | carries a precondition the effect invalidates | safe — **rejects itself** |
| `EXTERNALLY_DEDUPLICATED` | remote honours an idempotency key | safe if key propagated |
| `TRANSACTIONAL` | effect + dedup marker commit atomically | exactly-once |
| `MUTATING_UNSAFE_RETRY` | duplicates on re-issue | **never safe** |
| `UNKNOWN` | cannot be determined statically | must escalate |

---

## 2. Proposed V0 toolset (6 tools)

| Tool | Class | Re-issue outcome | Verified |
|---|---|---|---|
| `read` | `READ_ONLY` | identical | ✅ sim #1 |
| `grep` | `READ_ONLY` | identical | ✅ sim #2 |
| `write` | `MUTATING_SAFE_RETRY` | identical (whole-content write) | ✅ sim #3 |
| `edit` | `MUTATING_SELF_VERIFYING` | **rejected**: "old_string not found" | ✅ sim #4 |
| `bash` | **`UNKNOWN`** | **depends entirely on the command** | ✅ sims #5, #6 |
| `ask_user` | `READ_ONLY` (durable request, deduped by id) | identical | ✅ sim #12 |

**5 of 6 are trivially recoverable. `bash` is the entire problem.**

---

## 3. Real Hermes tools (28 classified)

### File / code
| Tool | Class | Reasoning |
|---|---|---|
| `read_file` | `READ_ONLY` | pure read |
| `search_files` | `READ_ONLY` | pure read |
| `write_file` | `MUTATING_SAFE_RETRY` | whole-content write is idempotent |
| `patch` | `MUTATING_SELF_VERIFYING` | `old_string` precondition (`tools/file_tools.py:2456-2464`); a replay finds no match and errors — verified |
| `execute_code` | `UNKNOWN` | arbitrary code; same problem as `bash` |
| `terminal` | `UNKNOWN` | arbitrary shell |
| `process` | `UNKNOWN` | process lifecycle; kill is safe-retry, spawn is not |
| `read_terminal` | `READ_ONLY` | reads buffer |
| `close_terminal` | `MUTATING_SAFE_RETRY` | closing a closed terminal is a no-op |

### Memory / skills / state
| Tool | Class | Reasoning |
|---|---|---|
| `memory` (write) | `MUTATING_SAFE_RETRY` | keyed upsert |
| `skill_manage` (create) | `MUTATING_SAFE_RETRY` | atomic write of full content (`skill_manager_tool.py:972-977`) |
| `skill_manage` (patch) | `MUTATING_SELF_VERIFYING` | search/replace precondition (`:1143-1209`) |
| `skill_view`, `skills_list` | `READ_ONLY` | |
| `session_search` | `READ_ONLY` | FTS query |
| `todo` | `MUTATING_SAFE_RETRY` | keyed set |
| `project_create` | `MUTATING_SAFE_RETRY` | name-keyed; second create errors "exists" |
| `project_switch`, `project_list` | `MUTATING_SAFE_RETRY` / `READ_ONLY` | switch is a set |

### External / network — the dangerous group
| Tool | Class | Reasoning |
|---|---|---|
| `web_search`, `web_extract` | `READ_ONLY` | GET semantics |
| `image_generate` | `MUTATING_UNSAFE_RETRY` | **bills twice**, produces a different image (non-deterministic) |
| `video_generate`, `xai_video_edit`, `xai_video_extend` | `MUTATING_UNSAFE_RETRY` | same — expensive and non-deterministic |
| `text_to_speech` | `MUTATING_UNSAFE_RETRY` | bills twice (output usually identical) |
| `discord` (send) | `MUTATING_UNSAFE_RETRY` | **double-post**, user-visible, irreversible |
| `yb_send_dm`, `yb_send_sticker` | `MUTATING_UNSAFE_RETRY` | double-send |
| `feishu_drive_add_comment` | `MUTATING_UNSAFE_RETRY` | duplicate comment |
| `feishu_drive_reply_comment` | `MUTATING_UNSAFE_RETRY` | duplicate reply |
| `ha_call_service` | `UNKNOWN` | `toggle` is unsafe; `turn_on` is safe. **Argument-dependent.** |
| `ha_get_state`, `ha_list_entities` | `READ_ONLY` | |
| `cronjob` (create) | `MUTATING_SAFE_RETRY` if id-keyed, else `UNSAFE` | depends on whether the caller supplies an id |
| `delegate_task` | `MUTATING_UNSAFE_RETRY` | **spawns a second child run** — expensive, and the duplicate does real work |
| `kanban_create` | `MUTATING_UNSAFE_RETRY` | duplicate card |
| `kanban_comment` | `MUTATING_UNSAFE_RETRY` | duplicate comment |
| `kanban_complete`, `kanban_block` | `MUTATING_SAFE_RETRY` | state set, not increment |
| `browser_click`, `browser_type`, `browser_press` | `MUTATING_UNSAFE_RETRY` | a second click may submit a form twice |
| `browser_navigate`, `browser_snapshot` | `MUTATING_SAFE_RETRY` / `READ_ONLY` | navigation is a set |
| `computer_use` | `MUTATING_UNSAFE_RETRY` | synthetic input events replay |

---

## 4. Distribution

| Class | Count | Share |
|---|---|---|
| `READ_ONLY` | 11 | 32% |
| `MUTATING_SAFE_RETRY` | 10 | 29% |
| `MUTATING_SELF_VERIFYING` | 2 | 6% |
| `MUTATING_UNSAFE_RETRY` | 15 | 44%* |
| `UNKNOWN` (argument-dependent) | 4 | 12% |

\* percentages exceed 100 because `skill_manage` and `cronjob` appear in two rows by mode.
Of 34 distinct classifications: **23 (68%) are safe to re-issue; 11 (32%) are not.**

The `OPEN-QUESTIONS.md` E-04 threshold was: *"if more than roughly a third land in unkeyed-mutating,
the crash-resume story needs rethinking."* **Measured: 32% unsafe + 12% unknown = 44% problematic.**
That is at or over the threshold — so the recovery story does need the rethink, and §3 of
`results.md` provides it.

---

## 5. The finding that breaks the proposed contract

`ARCHITECTURE.md` §2.6 proposes per-**tool** metadata:
```
idempotency: None | Key(args)
```

**Simulations #5 and #6 refute this.** Same tool, `bash`, opposite safety:

```
bash (>> append)   re-issue → DUPLICATED   (2 lines, expected 1)
bash (mkdir -p)    re-issue → identical    (safe)
```

Recovery safety is a property of the **invocation**, not the tool. `bash`, `execute_code`,
`terminal`, `process`, `ha_call_service` and `cronjob` are all argument-dependent — that is
**6 of the highest-traffic tools in the corpus**, including the single most-used one.

A per-tool declaration would have to mark `bash` as `UNKNOWN`, which forces escalation on *every*
crash-interrupted shell call — the most common case. That is unusable.

---

## 6. What the evidence actually supports

Three properties do real work, ranked by strength:

**1. Self-verifying preconditions (strongest — needs no key).**
`patch` and `git commit` both **reject their own replay**. The effect invalidates the precondition,
so a duplicate cannot apply and fails loudly. This is better than an idempotency key because it
requires no cooperation from the runtime *or* the remote. Verified: sim #4, sim #7.

**2. Transactional dedup (only real exactly-once).**
Sim #11: when the effect and the dedup marker commit in **one transaction**, re-issue is provably
a no-op. Only available for stores the harness controls.

**3. Externally-deduplicated keys (requires remote cooperation).**
Sim #9: works, but the harness can only *propagate* the key. It cannot create the guarantee.

And one that does not work:

**4. Per-tool `idempotency: none | key(args)` — insufficient**, per §5.

---

## 7. Proposed replacement contract

Declared **per invocation**, not per tool, and computed by the tool from its own arguments:

```
recovery(args) -> {
  class: READ_ONLY | SAFE_RETRY | SELF_VERIFYING | EXTERNALLY_DEDUPED | TRANSACTIONAL | UNSAFE,
  precondition?: <token the effect invalidates>,   // e.g. content hash, old_string, git sha
  dedup_key?: string,                               // propagated to the remote
  verify?: () => 'applied' | 'not-applied' | 'unknown'   // cheap post-hoc probe
}
```

The `verify` probe is the important addition and it is **not in the current architecture**. Several
tools that are unsafe to *retry* are cheap to *check*:

| Tool | verify probe |
|---|---|
| `git commit` | `rev-parse HEAD` vs recorded sha |
| `kanban_create` | list cards, match title + timestamp window |
| `discord` send | fetch last N messages, match content |
| `write_file` | hash the file, compare to intended content |
| `delegate_task` | query child runs for `parent_run_id` + args digest |

With `verify`, the recovery decision becomes:

```
on resume, tool.started with no terminal event:
  READ_ONLY | SAFE_RETRY | SELF_VERIFYING | TRANSACTIONAL  -> re-issue
  EXTERNALLY_DEDUPED (key present)                          -> re-issue
  UNSAFE with verify()                                      -> probe, then re-issue or skip
  UNSAFE without verify()                                   -> escalate to human
```

This converts a large part of the 44% problematic group into automatically recoverable cases, and
leaves escalation for the genuinely irreversible-and-unobservable ones (`send_email`,
`image_generate` billing, `computer_use`).

**Honest residual:** `bash` with an arbitrary command still lands in `UNSAFE`-without-`verify` unless
the *caller* supplies a precondition or the runtime can classify the command. QM's shell parser
(`command-policy.ts`) shows classification is feasible for a curated rule set, but general shell
recovery is unsolved and the design should say so rather than pretend otherwise.
