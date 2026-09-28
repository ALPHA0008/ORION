# ALPHA — Brand / Namespace Availability Gate

**Investigation only. Nothing was renamed, registered, published, created or committed.**

All checks performed **2026-09-03, 11:21–11:35 UTC** against live registries and DNS.

---

## Executive summary

**Decision: `ALPHA_WITH_CAUTION`** — usable, but with two collisions that must be decided
deliberately before public launch, not discovered after it.

The namespace mechanics are **clean**: every surface we would actually own — `@kernlbase/alpha`,
`kernlbase/alpha` on GitHub, `alpha.kernlbase.com` — is free. Our exact technical niche
("alpha runtime") is **empty on GitHub: 10 repositories, all zero stars**.

Two findings materially qualify that:

1. **`alpha.dev` is live and is a direct-category competitor** — *"Alpha.dev — Event-Driven
   Predictive Agent OS… Perceive, predict, act, evolve."* Event-driven, agent, OS/runtime. This is
   the single most serious finding, and it was not on the candidate list to check — it surfaced
   from DNS.
2. **"Alpha" is DeepMind's house naming convention** in AI — AlphaFold (14.8k★), AlphaGeometry
   (4.9k★), AlphaZero, AlphaCodium (4.0k★, *code generation*). Any AI product called ALPHA is read
   against that prior.

Neither blocks the technical rollout. Both mean **plain "ALPHA" standing alone is weak
positioning**, while **"ALPHA by Kernlbase" is defensible** — and the Kernlbase half is genuinely
ours (`kernlbase.com` is live and is your site).

---

## 1. npm — unscoped

```text
npm: alpha
status:    COLLISION — package EXISTS
owner:     jacksontian
category:  "Node API doc search" (developer utility, unrelated domain)
activity:  created 2012-08-21 · last publish 2018-04-04 · 9 versions · 722 downloads/month
relevance: LOW in purpose — but it SHIPS A BINARY NAMED `alpha` ({"alpha": "./bin/alpha"})
risk:      COLLISION (not high-risk) — dormant 8 years, but the unscoped name is unavailable
           and the binary name is already claimed on npm
```

We were never going to publish unscoped, so this constrains the **CLI name**, not the package.

Ecosystem scan: 19,928 npm packages match "alpha", but the top results are overwhelmingly the
*colour-channel* and *ISO-3166* senses (`color-alpha`, `postcss-alpha-function`,
`iso-3166-1-alpha-2`, `@pixi/filter-alpha`). **Almost none use "alpha" as a product name.** That is
noise, not collision.

---

## 2. npm — scoped

| package | HTTP | status |
|---|---|---|
| `@kernlbase/alpha` | **404** | **AVAILABLE** |
| `@kernlbase/alpha-cli` | **404** | AVAILABLE (fallback) |
| `@kernlbase/alpha-runtime` | **404** | AVAILABLE (fallback) |
| `@kernlbase/harness` (current) | 404 | still unpublished |

`npm search scope:kernlbase` → **0 packages**. The scope is entirely unused.

**Caveat carried forward from Track B:** availability is not publishing *authority*. `npm whoami`
returns `ENEEDAUTH` on this machine, so whether the authenticated publisher can claim `@kernlbase`
remains **UNKNOWN** until login. Recorded as `NPM_PUBLISH_BLOCKED` in the Track-B start state.

---

## 3. CLI executable — `alpha`

**Status: COLLISION, low practical severity.**

| evidence | finding |
|---|---|
| npm `alpha` package | ships `bin: {"alpha": "./bin/alpha"}` |
| its activity | last published **2018**, 722 downloads/month |
| `alpha-cli` on npm | exists but exposes `react`, `react-generate`, `react-new` — **not** `alpha` |
| active dev tool named `alpha` in our category | **none found** |

The distinction the brief asks for:

- *"Some unrelated executable named `alpha` exists"* — **true** (a dormant 2018 doc-search tool).
- *"An active developer tool in our category already uses `alpha`"* — **false**.

A scoped package **can** expose a binary named `alpha`; npm scopes do not namespace binaries, so
`npm i -g @kernlbase/alpha` would install an `alpha` command that shadows the old package for
anyone who has both. Practically unlikely; worth knowing.

Secondary consideration: `alpha` is a **very common shell variable/alias name** and a widely used
release-channel word (`v2.0.0-alpha`). `alpha run …` is slightly ambiguous in a way `harness run …`
is not.

---

## 4. npx

There is no independent npx namespace — `npx` resolves whatever `npm` resolves.

| form | viability |
|---|---|
| `npx @kernlbase/alpha` | **VIABLE** — scoped name is free; runs our `bin` |
| `npx alpha` | **COLLISION** — resolves to the 2018 `alpha` package, not ours |

So the scoped form is the only correct instruction to publish in docs. `npx alpha` would silently
run someone else's package — a real footgun if it ever appeared in our README.

---

## 5. GitHub

| repository | HTTP | status |
|---|---|---|
| `kernlbase/alpha` | **404** | **AVAILABLE** |
| `kernlbase/alpha-runtime` | 404 | AVAILABLE |
| `kernlbase/alpha-agent` | 404 | AVAILABLE |
| `kernlbase/alpha-engine` | 404 | AVAILABLE |
| `kernlbase/harness` (declared in package.json) | 404 | **does not exist** |
| `ALPHA0008/harness` (actual remote) | **200** | exists, public |

**The `kernlbase` GitHub org itself does not exist** (`api.github.com/users/kernlbase` → Not Found).
Every `kernlbase/*` path is unclaimed — including the one `v0/package.json` already points at. That
is a pre-existing Track-B defect independent of this naming decision.

### Ecosystem collision

247,815 repos contain "alpha" in the name. Filtered to what matters:

| query | total | top results |
|---|---|---|
| `alpha runtime` | **10, all 0 stars** | our exact niche is **empty** |
| `alpha agent` | 678 | dominated by **quant-finance** "alpha mining" (AlphaAgent, AlphaQuanter) |
| `alpha llm` | 115 | mostly research papers, finance factor mining |

Highest-star "alpha" repos: AlphaFold (14.8k), AlphaPose (8.6k), AlphaFold3 (8.5k), alpha_vantage
(4.9k), AlphaGeometry (4.9k), alpha-zero-general (4.5k), alphalens (4.4k), **AlphaCodium (4.0k)**.

Two dominant semantic fields, neither ours:
- **DeepMind AI research** — AlphaFold / AlphaZero / AlphaGeometry / AlphaCodium
- **Quantitative finance** — "alpha" as excess return (Alpha Vantage, alphalens, alpha mining)

**Would a developer confuse our ALPHA with these?** Not with a *specific* one — but they would
arrive with a prior that "Alpha-something" means *DeepMind-style AI research* or *trading*, and our
product is neither.

---

## 6. Domains

DNS + HTTP, checked live:

| domain | result | note |
|---|---|---|
| **`kernlbase.com`** | **200 — "Kernl · The decision ledger for enterprise AI"** | **this is yours** — matches the Kernlbase governance layer exactly |
| `alpha.kernlbase.com` | no HTTP response | **AVAILABLE to us** — we control the parent zone |
| `kernlbase.com/alpha` | n/a | **AVAILABLE** — path on our own site |
| **`alpha.dev`** | **200 — "Event-Driven Predictive Agent OS"** | **occupied by a direct-category product** |
| `alpha.ai` | DNS resolves, no HTTP | occupied |
| `getalpha.dev` | resolves | occupied |
| `usealpha.dev` | resolves | occupied |

**Every standalone `alpha` domain is gone.** The viable branding URLs are the ones we already own:
`alpha.kernlbase.com` and `kernlbase.com/alpha`.

Per the brief, domain scarcity is **not** a prerequisite for the name — and it is not the reason for
the caution verdict. `alpha.dev`'s *content* is.

---

## 7. AI / developer-product collisions

| name | what it is | URL | category | similarity | severity |
|---|---|---|---|---|---|
| **Alpha.dev** | *"Event-Driven Predictive Agent OS powering AIUSD, the financial world model"* | `alpha.dev` | **agent OS / runtime** | **HIGH — event-driven + agent + OS is our vocabulary** | **HIGH-RISK COLLISION** |
| **Wolfram\|Alpha** | computational knowledge engine | `wolframalpha.com` (live) | AI/compute, consumer + API | low product overlap, **very high name recognition** | COLLISION (brand shadow) |
| **AlphaSense** | AI market-intelligence SaaS | `alphasense.com` (live) | AI SaaS, enterprise | different category, **well-funded, strong mark** | COLLISION (trademark-relevant) |
| **DeepMind Alpha\*** | AlphaFold / AlphaZero / AlphaGeometry / AlphaCodium | github.com/google-deepmind | AI research | AlphaCodium is *code generation* — adjacent to us | COLLISION (semantic) |
| **Aleph Alpha** | European LLM company | npm `@aleph-alpha/*` | LLM provider | different name, adjacent space | LOW-RELEVANCE |
| **Alpha Vantage / alphalens / AlphaAgent** | quant-finance tooling | various | finance | different domain, **crowds search** | LOW-RELEVANCE individually |

The one that matters is **Alpha.dev**. It is not "someone using the word Alpha" — it is an
*event-driven agent OS*, and our product is an *event-sourced agent runtime*. A developer
encountering both would have to work to tell them apart.

Mitigating: its actual product is *"AIUSD, the financial world model"* — finance prediction, not
developer execution infrastructure. Overlapping vocabulary, different buyer.

---

## 8. Trademark / legal-risk screen

**This is a technical/market screen. It is not legal advice and it is not trademark clearance.**

| entity | class of use | signal |
|---|---|---|
| **Wolfram\|Alpha** | computer software, AI/computation | **potentially relevant conflict** — famous mark in software |
| **AlphaSense** | AI SaaS, enterprise software | **potentially relevant conflict** — direct software/AI class |
| **Alpha.dev** | agent OS / AI software | **potentially relevant conflict** — same class, currently trading |
| Alpha Bank / Alpha Industries / etc. | finance, apparel | low-relevance (different classes) |
| Generic "alpha" (release channel, colour channel, ISO codes) | descriptive term of art | **weakens distinctiveness** |

**Two structural observations, offered as screening signals only:**

1. "ALPHA" alone is a **common descriptive word** in software (alpha release, alpha channel, alpha
   in finance). Descriptive/common terms are typically **harder to protect** as marks.
2. There are **active software/AI companies trading under Alpha-formative names**. That is exactly
   the pattern that warrants a professional search before a funded public launch.

**Classification: PROFESSIONAL LEGAL REVIEW RECOMMENDED** before public launch or any registration.
**No obvious absolute blocker** was found — nothing that makes the name unusable — but the space is
occupied by well-resourced parties in the same class.

---

## 9. Brand discoverability

| search | dominated by |
|---|---|
| ALPHA + agent | quant-finance "alpha mining" agents |
| ALPHA + runtime | **nothing** — 10 repos, 0 stars (open field) |
| ALPHA + harness | unrelated (test harnesses, hardware) |
| ALPHA + developer | release-channel usage ("alpha version") |
| ALPHA + AI infrastructure | DeepMind Alpha\* research |
| ALPHA + coding agent | AlphaCodium |

**Unqualified "ALPHA" is not discoverable** — searches resolve to DeepMind, Wolfram, or finance.
**"ALPHA by Kernlbase" / "Kernlbase ALPHA" is discoverable**, because `kernlbase` is a coined,
unique token that we already own.

This is the practical argument for Option B/C over Option A, independent of legal risk.

---

## 10. Product naming test

```bash
npm install -g @kernlbase/alpha
npx @kernlbase/alpha

alpha run "Fix the bug"
alpha status
alpha replay
alpha explain
alpha fork
alpha doctor
```

| criterion | assessment |
|---|---|
| readability | **strong** — five letters, unambiguous spelling, no vowel tricks |
| memorability | **strong** — a real word with existing positive connotation |
| command ergonomics | **good** — `alpha run` / `alpha replay` read cleanly; same syllable count as `harness` |
| **ambiguity** | **weak point** — "alpha" already means *pre-release quality* to every developer. `alpha run` can read as "run the alpha version". This is the ergonomics cost, and it is real for a product whose whole pitch is *durability and trustworthiness*. |
| developer credibility | **good** with the Kernlbase qualifier; **generic** standing alone |

The pre-release connotation deserves weight. A runtime marketing itself on reliability, named after
the software industry's word for *"not yet stable"*, carries a small permanent explanation cost.

---

## 11. Brand + technical identity options

| option | brand | assessment |
|---|---|---|
| **A** | ALPHA | **weakest** — collides semantically with DeepMind, Wolfram and Alpha.dev; undiscoverable |
| **B** | **ALPHA by Kernlbase** | **strongest** — "by Kernlbase" is a unique, owned token; standard infrastructure convention; keeps ALPHA as the product name |
| **C** | Kernlbase ALPHA | strong, near-equal to B; slightly more corporate, slightly less product-forward |
| **D** | ALPHA Runtime | **good and underrated** — "alpha runtime" is a **genuinely empty niche** (10 repos, 0 stars) and states the category outright |

**The brand can remain ALPHA.** The differentiation comes from the surrounding identity, and all
three qualified forms are available on every surface we control.

**Recommended: Option B**, with "ALPHA Runtime" (D) as a descriptive subtitle where category
clarity matters more than brevity.

---

## 12. Fallback names

Not required — ALPHA is not blocked. Listed only because the brief asks for them if collision is
serious, and `alpha.dev` is arguably serious. Each preserves the qualities cited: short, technical,
premium, phonetically strong, not "AI Agent X", and works as `<name> run` / `<name> replay`.

| # | name | why |
|---|---|---|
| 1 | **KERNL** | already owned (`kernlbase.com`), coined, zero collision, unifies brand + company |
| 2 | **LEDGER** | the product *is* an append-only ledger of runs; honest and technical |
| 3 | **ANVIL** | durable, infrastructural, strong phonetics; check Foundry's `anvil` collision |
| 4 | **TRACE** | trajectory-native in one word; somewhat crowded in observability |
| 5 | **RECALL** | replay/recovery semantics; memorable |
| 6 | **ATLAS** | infrastructure connotation; crowded (MongoDB Atlas) |
| 7 | **CINDER** | short, unusual, unclaimed-feeling |
| 8 | **KEEL** | structural, short, maritime-stable |
| 9 | **TETHER** | durability metaphor; collides with the stablecoin |
| 10 | **LOOM** | weaving execution threads; some ML collision (Loom video) |

Strongest five if ALPHA were dropped: **KERNL · LEDGER · ANVIL · KEEL · CINDER**.

---

## 13. Decision matrix

| Surface | Candidate | Status | Risk | Evidence | Recommendation |
|---|---|---|---|---|---|
| Brand | ALPHA | **COLLISION** (semantic) | **MEDIUM** | DeepMind Alpha\*, Wolfram\|Alpha, AlphaSense, Alpha.dev | Use **"ALPHA by Kernlbase"** |
| npm | `alpha` | **COLLISION** | LOW | exists since 2012, dormant since 2018, 722 dl/mo | Do not pursue unscoped |
| npm scoped | `@kernlbase/alpha` | **AVAILABLE** | LOW | HTTP 404; scope has 0 packages | **Proceed** (auth unverified) |
| CLI | `alpha` | **COLLISION** | LOW | dormant npm pkg owns the binary name; no active tool in category | Usable; note shadowing |
| npx | `npx @kernlbase/alpha` | **AVAILABLE** | LOW | scoped name free | **Use scoped form only** |
| npx | `npx alpha` | **COLLISION** | MEDIUM | resolves to a stranger's 2018 package | **Never document this form** |
| GitHub | `kernlbase/alpha` | **AVAILABLE** | LOW | HTTP 404; org does not yet exist | Proceed; **claim the org** |
| Domain | `alpha.kernlbase.com` | **AVAILABLE** | LOW | no HTTP; parent zone is ours | **Use this** |
| Domain | `alpha.dev` | **HIGH-RISK COLLISION** | **HIGH** | live "Event-Driven Predictive Agent OS" | Unobtainable; avoid confusion |
| Legal | ALPHA (software class) | **LEGAL REVIEW REQUIRED** | MEDIUM | Wolfram, AlphaSense, Alpha.dev active in class | Professional search pre-launch |

---

## 14. Sources and timestamps

All checks **2026-09-03 11:21–11:35 UTC**:

| source | queried |
|---|---|
| `registry.npmjs.org/alpha` | full packument — metadata, maintainers, `bin`, publish dates |
| `api.npmjs.org/downloads/point/last-month/alpha` | 722 downloads |
| `registry.npmjs.org/@kernlbase%2F{alpha,alpha-cli,alpha-runtime,harness}` | all HTTP 404 |
| `registry.npmjs.org/-/v1/search?text=scope:kernlbase` | 0 packages |
| `registry.npmjs.org/-/v1/search?text=alpha` | 19,928 matches, top 20 inspected |
| `registry.npmjs.org/{alphavantage,alpha-cli}` | binary-name inspection |
| `api.github.com/repos/kernlbase/{alpha,alpha-runtime,alpha-agent,alpha-engine,harness}` | all 404 |
| `api.github.com/repos/ALPHA0008/harness` | 200 |
| `api.github.com/users/kernlbase` | Not Found |
| `api.github.com/search/repositories` | `alpha in:name` (247,815); `alpha+agent` (678); `alpha+runtime` (10); `alpha+llm` (115) |
| DNS + HTTPS | `alpha.dev`, `alpha.ai`, `getalpha.dev`, `usealpha.dev`, `kernlbase.com`, `alpha.kernlbase.com` |
| HTTP title/meta | `alpha.dev`, `kernlbase.com`, `wolframalpha.com`, `alphasense.com` |
| USPTO TESS API | **not reachable** (HTTP 404) — trademark screen is web-signal-based only |

**Limits of this screen:** no formal trademark database search was performed (USPTO's API was
unreachable); npm publishing *authority* for `@kernlbase` is unverified pending login; `alpha.dev`
is JS-rendered so only its title/meta were read, not its full product surface.

---

## 15. Final decision

# `ALPHA_WITH_CAUTION`

ALPHA is **usable**. Every namespace we would actually own is free, and our precise technical
category is unoccupied. It is not blocked.

### Remaining risks, in order of seriousness

1. **`alpha.dev` — an active "Event-Driven Predictive Agent OS."** Same vocabulary, adjacent space.
   The strongest argument against unqualified "ALPHA". *Mitigation: always brand as "ALPHA by
   Kernlbase"; never use bare "Alpha" in a context where Alpha.dev could be meant.*
2. **Trademark exposure — LEGAL REVIEW REQUIRED.** Wolfram|Alpha and AlphaSense are active in the
   software/AI class. No absolute blocker found; a professional search is warranted before a funded
   public launch. *This report is not clearance.*
3. **Semantic dilution.** "Alpha" reads as DeepMind AI research or quant finance, and as
   *pre-release quality*. A durability-focused runtime named after the industry's word for
   "unstable" carries a permanent small explanation cost.
4. **`npx alpha` resolves to a stranger's package.** Must never appear in documentation.
5. **Discoverability.** Unqualified searches never reach us; the Kernlbase qualifier is load-bearing.
6. **`kernlbase` GitHub org does not exist.** Pre-existing Track-B defect — `v0/package.json`
   already points at a non-existent repo. Claim the org before publishing under any name.

### Recommended identity, if you proceed

| surface | value |
|---|---|
| Brand | **ALPHA by Kernlbase** |
| npm | `@kernlbase/alpha` |
| CLI | `alpha` |
| npx | `npx @kernlbase/alpha` *(scoped only)* |
| GitHub | `kernlbase/alpha` *(claim the org first)* |
| Domain | `alpha.kernlbase.com` |

---

## ALPHA_NAME_GATE_COMPLETE

```
Decision:    ALPHA_WITH_CAUTION
Brand:       ALPHA — COLLISION (semantic); viable as "ALPHA by Kernlbase"
npm:         @kernlbase/alpha — AVAILABLE (unscoped `alpha` taken, dormant)
CLI:         alpha — COLLISION, low severity (dormant 2018 package owns the binary)
npx:         npx @kernlbase/alpha — AVAILABLE  |  npx alpha — COLLISION, never document
GitHub:      kernlbase/alpha — AVAILABLE (org `kernlbase` does not exist yet — claim it)
Domain:      alpha.kernlbase.com — AVAILABLE  |  alpha.dev — HIGH-RISK COLLISION (occupied)
Legal screen: LEGAL REVIEW REQUIRED — no absolute blocker; Wolfram|Alpha, AlphaSense,
              Alpha.dev active in the software/AI class. This is not legal advice.
```

**STOP — rename not implemented.**
