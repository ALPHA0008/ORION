# Experiment 5 — Developer Validation

# ⚠️ NOT RUN — NO ACCESS TO HUMAN PARTICIPANTS

**Status: BLOCKED. Zero developers were interviewed. No data exists in this directory.**

This is the most important experiment in the brief, and I could not run any part of it. I have no
way to recruit, contact, or observe human developers. I did **not** simulate participants, invent
personas, or estimate what developers "would probably say" — a fabricated signal here would be worse
than no signal, because the entire BUILD/PIVOT/STOP decision is supposed to rest on it.

What follows is the **instrument**, ready to run: recruitment criteria, a demo script, a
non-leading interview protocol, the instrumentation schema, and pre-registered success thresholds.
Pre-registering the thresholds *before* seeing data is deliberate — it is what stops the results
being rationalised after the fact.

Sections 9 (demand measurement) and 11 (positioning) of the brief are blocked for the same reason
and are specified below.

---

## 1. Why this blocks the decision

Experiments 1–4 established that the architecture **works**:

| Hypothesis | Technical half | Product half |
|---|---|---|
| H-01 durable runs | **SUPPORTED** (real SIGKILL → resume, 9/9) | **UNRESOLVED** |
| H-02 replay | **SUPPORTED** (exact, repeatable, 4/4) | **UNRESOLVED** |
| H-03 fork | **SUPPORTED** (provenance, divergence, 8/8) | **UNRESOLVED** |
| H-09 small durable core | **SUPPORTED** (529 LOC) | **UNRESOLVED** |
| H-10 time travel compelling | works | **UNRESOLVED** |

Working is necessary and not sufficient. Ruflo demonstrates the failure mode of building
technically-real capabilities nobody invokes: correct Raft, correct DQN, correct HNSW — all
unreachable or uncalled. **A durable runtime that developers do not use is the same failure with
better engineering.**

There is also a specific reason for concern already in the evidence: `FINDINGS.md` records that
**Hermes has the largest user base of the three audited projects and has no run-level durability**.
Its users tolerate re-running. That is a real market signal pointing *against* H-01, and it cannot
be argued away from the terminal.

---

## 2. Recruitment

**Target: 20–30 participants** who *currently ship agents*, not people interested in agents.

Screening question (must pass): *"In the last 30 days, have you written or modified code that calls
an LLM in a loop with tools?"*

Quota — the mix matters more than the total:

| Segment | n | Why |
|---|---|---|
| LangGraph / CrewAI users | 5–7 | closest competitor; they already chose a framework |
| Claude Agent SDK / OpenAI Agents SDK users | 5–7 | they own their loop; do they want ours? |
| Custom model-loop builders | 5–7 | most likely to value a small core (H-09) |
| Coding-agent users (Claude Code, Cursor, OpenHands) | 3–5 | interactive bias — expected to care *least* about durability |
| **Runs agents unattended** (cron, CI, queues) | **≥8, overlapping** | **the hypothesised buyer. If H-01 fails here, it fails everywhere.** |

The last row is the real experiment. If unattended operators do not want durability, nobody does.

---

## 3. Demo protocol — show, do not pitch

**Rule: no architecture talk before the demo.** Do not say "event-sourced", "append-only",
"projection", or "durable execution". Those words test whether the *idea* sounds good, not whether
the *capability* is wanted.

Run this, silently, on a shared screen (≈4 minutes):

```
1. start an agent on a multi-step task     -> it works for ~30s
2. kill -9 the process, visibly            -> "I just killed it"
3. restart                                  -> it continues from where it stopped
4. show the history                         -> every model call, tool call, denial, degradation
5. fork at the step that went wrong         -> take a different branch
6. STOP TALKING
```

Then ask exactly one question and wait — do not fill silence:

> **"What did you just see?"**

Their unprompted framing is the highest-value data point in the study. If they describe it as
"crash recovery", H-01 is live. If they describe it as "debugging" or "I could see what it did",
the product may be a **debugger**, not a runtime — which is the pivot in brief §14.

---

## 4. Interview guide (non-leading)

Ask in this order. Never say "would you use X?" before they have named their own problem.

**Current state (before any opinion of ours)**
1. Walk me through the last agent you shipped. What broke?
2. When an agent run fails halfway, what happens today? *(listen for: "I re-run it")*
3. How long does your longest agent run take? What supervises it?
4. When an agent does something wrong, how do you work out why?
5. What have you built yourself that you wish came from the framework?

**Reaction (after the demo)**
6. What did you just see? *(verbatim — do not paraphrase in notes)*
7. Which of those things, if any, is a problem you actually have?
8. Which is irrelevant to you?
9. What would you have to stop doing to adopt this?
10. What would stop you adopting it? *(expect: trust, lock-in, maturity, "I'd just re-run")*
11. Would you trust it for work nobody is watching? Why or why not?

**Behavioural, not attitudinal**
12. "Can I send you the repo?" → **record whether they say yes**
13. If yes → **do they install within 7 days?** (this is the real answer to every earlier question)

**Trap questions — to detect politeness bias**
14. "What's the closest thing you already use?" *(a vague answer means they have no felt need)*
15. "If this existed a year ago, what would you have used it for?" *(no concrete instance = no need)*
16. "What would you pay?" *(not for pricing — a zero answer with enthusiastic words is a flag)*

**Do not:** describe the architecture, defend the design, correct their misunderstanding of what it
does, or ask "wouldn't it be useful if…". Record confusion as data.

---

## 5. Instrumentation (brief §9)

Emit one event per action to a local file; ship only with consent.

```json
{"t":"2026-08-27T10:00:00Z","anon_id":"sha256(install)","event":"run.started",
 "props":{"run_id_hash":"...","tools":6,"external_adapter":false}}
```

Funnel:
```
invited -> installed -> first run completed
        -> used resume -> used replay -> used fork
        -> returned (day 2..7) -> registered a custom tool
        -> connected a second model -> used authorize()
```

Derived metrics:
```
activation      = first_run_completed / installed
D7 retention    = returned_day7 / installed
repeat rate     = users with >=3 runs / installed
time-travel use = used(resume|replay|fork) / active users     <-- THE metric
unattended use  = runs started by cron/CI / total runs
crash rate      = runs with a reaper requeue / total runs     <-- does the problem even occur?
```

**`crash rate` is the sleeper metric.** If real runs essentially never die, H-01's premise is
false regardless of what anyone says in an interview.

Explicitly **not** a success metric: GitHub stars, HN position, Twitter engagement, newsletter
signups.

---

## 6. Positioning test (brief §11)

Separate instrument: 5 landing variants, same demo GIF, identical CTA.

| | Copy |
|---|---|
| A | Durable agent runtime |
| B | Time travel for AI agents |
| C | Agents that survive crashes |
| D | Replay and fork any agent run |
| E | The runtime for long-running autonomous agents |

Measure: comprehension (unprompted "what does this do?"), scroll depth, CTA rate, and — most
diagnostically — **which words they repeat back**. Run as a first-message test in developer
communities plus a 5-way split on the docs page.

Prediction to be falsified: **B and D will outperform A and E**, because A and E name a *category*
while B and D name a *capability*. C is the risk case — it may read as "fixes a problem I don't
have", which is exactly the H-01 question in copy form.

---

## 7. Pre-registered thresholds

Fixed before data collection.

| Signal | STRONG | MODERATE | WEAK | NEGATIVE |
|---|---|---|---|---|
| Unprompted "I want this" after demo | ≥8/25 | 4–7 | 1–3 | 0 |
| Names a concrete past incident it would have fixed | ≥12/25 | 7–11 | 3–6 | ≤2 |
| Accepts the repo link | ≥15/25 | 10–14 | 5–9 | ≤4 |
| **Installs within 7 days** | ≥8/25 | 5–7 | 2–4 | ≤1 |
| Completes a first run | ≥6/25 | 3–5 | 1–2 | 0 |
| **Uses resume / replay / fork unprompted** | **≥5** | 3–4 | 1–2 | **0** |
| Returns on day 7 | ≥5/25 | 3–4 | 1–2 | 0 |
| Registers a custom tool | ≥3 | 2 | 1 | 0 |
| Runs something unattended | ≥3 | 2 | 1 | 0 |

**Decision rules, also pre-registered:**

- **BUILD** — STRONG or MODERATE on *installs*, **and** ≥3 developers use time travel unprompted,
  **and** ≥2 run unattended work.
- **BUILD — MODIFIED** — installs are MODERATE but usage concentrates on **one** capability. Ship
  that one; cut the others from V0.
- **PIVOT** — they use **replay/explain** but ignore **resume**. That means the product is an
  *agent debugger / trajectory inspector*, not a durable runtime. This is a real possible outcome,
  named in brief §14, and the evidence in §1 (Hermes' users tolerate re-running) makes it more
  likely than it first appears.
- **STOP** — WEAK/NEGATIVE on installs **and** zero unprompted time-travel usage **and** the modal
  answer to Q2 is "I just re-run it".

---

## 8. Threats to validity for whoever runs this

1. **Demo bias.** A crash-recovery demo makes crashes salient. Ask Q2 *before* the demo so the
   baseline is uncontaminated.
2. **Politeness.** Verbal enthusiasm is near-worthless. Weight installs and usage; treat "that's
   cool" as noise.
3. **Selection.** Recruiting from agent-infrastructure circles oversamples people who like
   infrastructure. Deliberately include people who just want their agent to work.
4. **Novelty.** Fork is fun to watch once. D7 retention distinguishes a toy from a tool.
5. **n = 25 is thin** for anything but a large effect. Treat the thresholds as directional.
6. **The prototype has a scripted model** (Experiment 4 §6.1). Before showing it to anyone, wire a
   real provider — otherwise the demo is not credible and the study is invalid.

---

## 9. Prerequisite before this can run

The Experiment 4 prototype needs a real model provider (~1 day: the `Model` interface exists;
`makeScriptedModel` is swapped for a real client). Nothing else in the demo path is missing.
