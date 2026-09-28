# COSMOS — Brand / Namespace Availability Gate

**Investigation only. Nothing was renamed, registered, published, created or committed.**

All checks performed **2026-09-03, 11:28–11:36 UTC** against live registries and DNS.

---

## Executive summary

**Decision: `COSMOS_BLOCKED`** — for the developer-infrastructure category specifically.

The namespace *mechanics* are actually slightly better than ALPHA's: `@kernlbase/cosmos` is free,
`kernlbase/cosmos` is free, and — unlike `alpha` — **no npm package owns a `cosmos` binary**, so
the CLI name is technically clear.

That is not the problem. The problem is that **COSMOS is already a major brand in developer
infrastructure, three times over, and all three are alive**:

| incumbent | what it is | scale |
|---|---|---|
| **Azure Cosmos DB** (Microsoft) | globally distributed database | **3,303,045 npm downloads/month** |
| **Cosmos SDK / Cosmos Network** | blockchain framework, "Internet of Blockchains" | **1,343,421 downloads/month** (`@cosmjs/stargate`) |
| **React Cosmos** | component sandbox for developers | **206,404 downloads/month** |
| **NVIDIA Cosmos** | *"open platform of world models"* — AI infrastructure | **11,717 stars, pushed today** |

Combined, that is roughly **4.85 million monthly npm downloads** across brands named Cosmos, all
aimed at the same audience we are: developers.

This is a different failure mode from ALPHA. ALPHA's collisions were *semantic* (DeepMind's naming
convention) and one *category-adjacent* site. COSMOS's collisions are **incumbent brands owned by
Microsoft and NVIDIA, actively shipping, in developer tooling**. A developer told to
`npm install @kernlbase/cosmos` will reasonably assume a Cosmos DB or Cosmos SDK integration.

---

## 1. npm — unscoped

```text
npm: cosmos
status:    COLLISION — package EXISTS
owner:     aikar
category:  "Distributed Event Driven application development framework"
activity:  created 2011-04-19 · last publish 2017-11-23 · 4 versions · 796 downloads/month
relevance: MODERATE — "distributed event driven framework" is uncomfortably close to our
           event-sourced runtime vocabulary, though the package is long abandoned
risk:      COLLISION — name unavailable, but dormant for 9 years and ships NO binary
```

**Notable:** unlike `alpha`, this package has `bin: none`. The unscoped *package* name is taken; the
*command* name is not.

Ecosystem scan: **3,719 npm packages** match "cosmos". Unlike ALPHA — where matches were mostly the
colour-channel/ISO-code senses and therefore noise — these are **real product families**:
`@azure/cosmos`, `@cosmjs/*`, `@cosmos-kit/*`, `react-cosmos-*`, `@vercel/cosmosdb-server`,
`@bitgo/sdk-coin-cosmos`. Almost every hit is a *brand*, not a common noun.

---

## 2. npm — scoped

| package | HTTP | status |
|---|---|---|
| `@kernlbase/cosmos` | **404** | **AVAILABLE** |
| `@kernlbase/cosmos-cli` | **404** | AVAILABLE |
| `@kernlbase/cosmos-runtime` | **404** | AVAILABLE |

Scope `@kernlbase` remains empty (0 packages). Publishing *authority* is still **UNKNOWN** —
`npm whoami` returns `ENEEDAUTH` on this machine.

**Availability here is misleading.** The scoped name being free says nothing about whether a
developer will interpret `@kernlbase/cosmos` as related to Cosmos DB or the Cosmos SDK. They will.

---

## 3. CLI executable — `cosmos`

**Status: LIKELY AVAILABLE (technically), COLLISION (practically).**

| package | ships `cosmos` binary? |
|---|---|
| `cosmos` | **no** — `bin: none` |
| `cosmos-cli` | no — it is a markdown API tool, `bin: none` |
| `cosmjs` | no — security holding package |
| `create-cosmos-app` | ships `cca` and `create-cosmos-app` — **not** `cosmos` |

So `cosmos` as a command is **technically unclaimed on npm** — genuinely better than `alpha`, whose
binary name is owned by a dormant package.

But `create-cosmos-app` exists precisely because the **Cosmos blockchain ecosystem** owns that
mental space. Typing `cosmos run "fix the bug"` in a room of developers invites the question
*"which Cosmos?"* — and the honest answer is that ours is the fourth.

---

## 4. npx

| form | viability |
|---|---|
| `npx @kernlbase/cosmos` | **VIABLE** — scoped name free, can expose any binary |
| `npx cosmos` | **COLLISION** — resolves to the abandoned 2017 `cosmos` package |

Same trap as ALPHA: the unscoped form runs a stranger's package and must never be documented.

---

## 5. GitHub

| repository | HTTP | status |
|---|---|---|
| `kernlbase/cosmos` | **404** | **AVAILABLE** |
| `kernlbase/cosmos-runtime` | 404 | AVAILABLE |
| `kernlbase/cosmos-agent` | 404 | AVAILABLE |

The `kernlbase` org still **does not exist** — unchanged from the ALPHA gate, and still a
pre-existing Track-B defect.

### Ecosystem collision — this is the serious part

**24,136 repositories** contain "cosmos" in the name. The top of that list:

| repo | stars | what |
|---|---|---|
| OpenGenus/cosmos | 13,745 | algorithms dataset |
| **NVIDIA/cosmos** | **11,717** | **"open platform of world models" — AI infrastructure** |
| react-cosmos/react-cosmos | 8,686 | UI component sandbox |
| cosmos/cosmos-sdk | 7,052 | blockchain framework |
| azukaar/Cosmos-Server | 6,137 | self-hosted server platform |
| CosmosOS/Cosmos | 3,190 | **OS construction kit** |
| cosmos/cosmos | 1,297 | Internet of Blockchains |
| astronomer/astronomer-cosmos | 1,255 | dbt-on-Airflow orchestration |

**NVIDIA/cosmos, verified live:** created 2024-12-30, **last pushed 2026-09-03 — today**, 855
forks, own product page at `nvidia.com/en-us/ai/cosmos/`. This is not a legacy name; it is an
actively marketed NVIDIA AI platform.

`CosmosOS/Cosmos` (an "operating system construction kit") and `astronomer-cosmos` (orchestration)
are both *runtime/orchestration-shaped*, which is our exact shelf.

### Our specific niche

| query | total | reading |
|---|---|---|
| `cosmos runtime` | **7 repos**, top has 7 stars | niche technically empty… |
| `cosmos agent` | 65 | top is **AzureCosmosDB/cosmosdb-agent-kit** — Microsoft, in the agent space |

The "empty niche" reading that favoured ALPHA does **not** transfer. With ALPHA, `alpha+runtime`
being empty meant open field. With COSMOS, the field is empty only because the name is so thoroughly
associated with *databases and blockchains* that nobody builds runtimes under it.

---

## 6. Domains

| domain | HTTP | serving |
|---|---|---|
| **`cosmos.dev`** | **200** | **"Cosmos — OpenShift Operators"** — developer infrastructure |
| `cosmos.ai` | 302 | occupied (redirects) |
| `getcosmos.dev` | 200 | "Cosmos - Everything you need. One place." |
| `usecosmos.dev` | no HTTP | possibly available |
| `cosmos.network` | 200 | "Cosmos \| Secure and Performant Blockchain for Institutions" |
| **`cosmos.kernlbase.com`** | no HTTP | **AVAILABLE to us** (we control the zone) |
| `kernlbase.com/cosmos` | n/a | **AVAILABLE** |

`cosmos.dev` — the domain a developer would guess — is **already a developer-infrastructure
product** (OpenShift Operators). That is worse than the ALPHA situation only in kind, not degree:
`alpha.dev` was an agent OS; `cosmos.dev` is Kubernetes operator tooling.

---

## 7. AI / developer-product collisions

| name | company | URL | category | similarity | severity |
|---|---|---|---|---|---|
| **Azure Cosmos DB** | **Microsoft** | azure.microsoft.com | distributed database | different product, **overwhelming brand mass** — 3.3M dl/mo | **HIGH-RISK COLLISION** |
| **Cosmos SDK / Network** | Interchain Foundation | cosmos.network | blockchain framework | different product, **1.3M dl/mo, owns `cosmos.network`** | **HIGH-RISK COLLISION** |
| **NVIDIA Cosmos** | **NVIDIA** | nvidia.com/en-us/ai/cosmos | **AI world-model platform** | **AI infrastructure — adjacent to us**, actively shipping | **HIGH-RISK COLLISION** |
| React Cosmos | OSS | react-cosmos.org | dev component sandbox | developer tool, 206k dl/mo | COLLISION |
| Cosmos (npm, 2011) | aikar | — | *"distributed event driven framework"* | **closest vocabulary match**, but abandoned | COLLISION (dormant) |
| Cosmos.dev | — | cosmos.dev | OpenShift operators | developer infrastructure | COLLISION |
| CosmosOS | OSS | github | OS construction kit | runtime-shaped, 3.2k stars | COLLISION |
| astronomer-cosmos | Astronomer | github | dbt/Airflow orchestration | orchestration, 1.3k stars | COLLISION |

**Eight meaningful collisions, three of them high-risk and two backed by Microsoft and NVIDIA.**

Compare ALPHA: one high-risk collision (`alpha.dev`) plus semantic dilution. COSMOS is
categorically more crowded **in our own space**.

---

## 8. Trademark / legal-risk screen

**Technical/market screen only. Not legal advice. Not trademark clearance.**

| entity | class of use | signal |
|---|---|---|
| **Microsoft — Azure Cosmos DB** | computer software, cloud database | **obvious major conflict risk** — global brand, enormous spend, same buyer |
| **NVIDIA — Cosmos** | AI software platform | **obvious major conflict risk** — active product, same broad class |
| **Interchain — Cosmos Network** | blockchain software | **potentially relevant conflict** — established mark, owns `cosmos.network` |
| React Cosmos | OSS developer tool | low-relevance (OSS, unregistered likely) |
| Generic "cosmos" (astronomy, common noun) | descriptive | mildly weakens distinctiveness |

Two of the world's largest technology companies operate products called **Cosmos** in software and
AI. Whatever the formal trademark position — which this screen cannot determine — that is a
practical brand-adjacency problem regardless of legal outcome.

**Classification: PROFESSIONAL LEGAL REVIEW REQUIRED**, and unlike ALPHA, this screen surfaced
**obvious major conflict signals** rather than merely "potentially relevant" ones.

---

## 9. Brand discoverability

| search | dominated by |
|---|---|
| COSMOS + runtime | Cosmos DB, CosmosOS |
| COSMOS + agent | **AzureCosmosDB/cosmosdb-agent-kit** (Microsoft) |
| COSMOS + developer | Azure Cosmos DB documentation |
| COSMOS + AI infrastructure | **NVIDIA Cosmos** |
| COSMOS + framework | Cosmos SDK (blockchain) |
| COSMOS + harness | unrelated |

**There is no search phrase where we would surface.** Even "Cosmos by Kernlbase" competes against
Microsoft's and NVIDIA's SEO. With ALPHA, the Kernlbase qualifier was enough to carve out a lane;
with COSMOS, the qualifier is fighting two of the largest marketing budgets in technology.

---

## 10. Product naming test

```bash
npm install -g @kernlbase/cosmos
npx @kernlbase/cosmos

cosmos run "Fix the bug"
cosmos status
cosmos replay
cosmos explain
cosmos fork
cosmos doctor
```

| criterion | assessment |
|---|---|
| readability | **strong** — clean, unambiguous spelling |
| memorability | **strong** — evocative, real word |
| command ergonomics | **good** — `cosmos run` reads well; two syllables more than `alpha` |
| **ambiguity** | **severe** — "cosmos" means *Azure database* or *blockchain* to most developers. `cosmos status` is genuinely ambiguous with Cosmos SDK node tooling. |
| developer credibility | **good in isolation**, but immediately raises "is this a Cosmos DB thing?" |
| **semantic fit** | **weak** — "cosmos" suggests vastness/distribution. Our product is a *local, single-workspace, durable execution runtime*. The name promises the opposite of what it is. |

That last row matters independently of collisions. ALPHA at least had a *neutral* semantic fit;
COSMOS actively implies distributed-systems scale we explicitly do not claim (the README says
"single-user and local, not multi-tenant").

---

## 11. Brand + technical identity options

| option | brand | assessment |
|---|---|---|
| A | COSMOS | **not viable** — competes with Microsoft, NVIDIA, Cosmos SDK |
| B | COSMOS by Kernlbase | **weak** — the qualifier cannot outrun 4.85M monthly downloads of other Cosmoses |
| C | Kernlbase COSMOS | same problem |
| D | COSMOS Runtime | **worst** — "Cosmos runtime" reads as *a runtime for Cosmos SDK*, actively misleading |

**Unlike ALPHA, no qualified form rescues this.** With ALPHA, "by Kernlbase" carved out a defensible
lane. With COSMOS, every construction still lands inside somebody else's established brand — and
option D actively suggests we are blockchain tooling.

---

## 12. Decision matrix

| Surface | Candidate | Status | Risk | Evidence | Recommendation |
|---|---|---|---|---|---|
| Brand | COSMOS | **HIGH-RISK COLLISION** | **HIGH** | Azure Cosmos DB, NVIDIA Cosmos, Cosmos SDK — all active | **Do not adopt** |
| npm | `cosmos` | COLLISION | LOW | exists 2011, dormant 2017, 796 dl/mo, no binary | unavailable |
| npm scoped | `@kernlbase/cosmos` | **AVAILABLE** | **HIGH (brand)** | HTTP 404 | available but misleading |
| CLI | `cosmos` | **LIKELY AVAILABLE** | MEDIUM | no npm package ships this binary | technically clear, practically confusing |
| npx | `npx @kernlbase/cosmos` | AVAILABLE | MEDIUM | scoped name free | viable but inherits brand confusion |
| npx | `npx cosmos` | COLLISION | MEDIUM | resolves to abandoned 2017 package | never document |
| GitHub | `kernlbase/cosmos` | **AVAILABLE** | HIGH (brand) | HTTP 404; org absent | available, not advisable |
| Domain | `cosmos.kernlbase.com` | **AVAILABLE** | LOW | no HTTP; our zone | usable if name adopted |
| Domain | `cosmos.dev` | **COLLISION** | HIGH | live: "Cosmos — OpenShift Operators" | unobtainable |
| Legal | COSMOS (software/AI class) | **LEGAL REVIEW REQUIRED** | **HIGH** | Microsoft + NVIDIA active in class | **obvious major conflict signals** |

---

## 13. COSMOS vs ALPHA — direct comparison

| dimension | ALPHA | COSMOS |
|---|---|---|
| unscoped npm | taken, dormant, **owns the binary** | taken, dormant, **no binary** ✅ |
| scoped npm | available | available |
| CLI name free | ✗ (dormant pkg owns it) | ✅ **yes** |
| GitHub org path | available | available |
| our niche on GitHub | **empty — genuinely open** ✅ | empty *because the name means something else* |
| high-risk collisions | **1** (`alpha.dev`) | **3** (Microsoft, NVIDIA, Cosmos SDK) |
| combined incumbent scale | modest | **~4.85M npm downloads/month** |
| does a qualifier rescue it? | **yes** — "ALPHA by Kernlbase" works | **no** — every form lands in someone's brand |
| semantic fit to our product | neutral (though "alpha" = pre-release) | **poor** — implies distributed scale we disclaim |
| legal screen | potentially relevant conflicts | **obvious major conflict signals** |

**ALPHA is the materially safer name**, despite its own real problems.

---

## 14. Sources and timestamps

All checks **2026-09-03 11:28–11:36 UTC**:

| source | queried |
|---|---|
| `registry.npmjs.org/cosmos` | full packument — 2011 created, 2017 last publish, `bin: none` |
| `api.npmjs.org/downloads/point/last-month/` | `cosmos` (796), `@azure/cosmos` (3,303,045), `@cosmjs/stargate` (1,343,421), `react-cosmos` (206,404) |
| `registry.npmjs.org/@kernlbase%2F{cosmos,cosmos-cli,cosmos-runtime}` | all 404 |
| `registry.npmjs.org/-/v1/search?text=cosmos` | 3,719 matches, top 20 inspected |
| `registry.npmjs.org/{cosmos-cli,cosmjs,create-cosmos-app}` | binary inspection |
| `api.github.com/repos/kernlbase/{cosmos,cosmos-runtime,cosmos-agent}` | all 404 |
| `api.github.com/repos/NVIDIA/cosmos` | 11,717 stars, pushed 2026-09-03, homepage nvidia.com/en-us/ai/cosmos |
| `api.github.com/search/repositories` | `cosmos in:name` (24,136); `cosmos+runtime` (7); `cosmos+agent` (65) |
| DNS + HTTPS titles | `cosmos.dev`, `cosmos.ai`, `getcosmos.dev`, `usecosmos.dev`, `cosmos.network`, `cosmos.kernlbase.com` |

**Limits:** no formal trademark database search (USPTO API unreachable in the ALPHA gate, not
retried); npm publishing authority for `@kernlbase` still unverified; `cosmos.ai` returns a 302 and
its destination was not followed.

---

## 15. Final decision

# `COSMOS_BLOCKED`

There is a serious direct conflict in our product category and namespace. Three active incumbents —
**Microsoft (Azure Cosmos DB)**, **NVIDIA (Cosmos AI platform)**, and **Cosmos SDK/Network** —
occupy the name in developer and AI infrastructure, with roughly **4.85 million monthly npm
downloads** between them. `cosmos.dev` is already a developer-infrastructure product.

Critically, **no qualified form rescues it.** "COSMOS by Kernlbase" still competes with Microsoft
and NVIDIA for every search; "COSMOS Runtime" actively reads as *a runtime for Cosmos SDK*.

There is also a fit problem independent of collisions: "cosmos" connotes vastness and distribution,
while the product is explicitly **single-user and local**. The name would promise something the
README disclaims.

### Strongest five fallback candidates

Carrying forward the qualities that motivated both name searches — short, technical, premium,
phonetically strong, infrastructure-appropriate, not "AI Agent X", and viable as `<name> run` /
`<name> replay` / `<name> fork`:

| # | name | why |
|---|---|---|
| 1 | **KERNL** | already owned (`kernlbase.com` is live and yours), coined, zero collision, unifies product and company |
| 2 | **ALPHA** *(by Kernlbase)* | the prior gate returned `ALPHA_WITH_CAUTION` — **materially safer than COSMOS**: one high-risk collision instead of three, and a qualifier that actually works |
| 3 | **LEDGER** | the product *is* an append-only ledger of runs; honest, technical, matches the Kernl "decision ledger" language already on your site |
| 4 | **ANVIL** | durable, infrastructural, strong phonetics *(verify Foundry's `anvil` before adopting)* |
| 5 | **KEEL** | short, structural, stability connotation, uncrowded |

**Recommendation:** COSMOS should not be adopted. If the choice is between the two names screened
so far, **ALPHA by Kernlbase** is the defensible one — and **KERNL** is worth serious consideration,
since you already own the domain, the brand, and the mental association.

---

## COSMOS_NAME_GATE_COMPLETE

```
Decision:    COSMOS_BLOCKED
Brand:       COSMOS — HIGH-RISK COLLISION (Microsoft, NVIDIA, Cosmos SDK all active)
npm:         @kernlbase/cosmos — AVAILABLE but misleading; unscoped `cosmos` taken (dormant, no bin)
CLI:         cosmos — LIKELY AVAILABLE technically; practically ambiguous with Cosmos SDK tooling
npx:         npx @kernlbase/cosmos — viable  |  npx cosmos — COLLISION, never document
GitHub:      kernlbase/cosmos — AVAILABLE (org `kernlbase` still does not exist)
Domain:      cosmos.kernlbase.com — AVAILABLE  |  cosmos.dev — COLLISION (OpenShift Operators)
Legal screen: LEGAL REVIEW REQUIRED — OBVIOUS MAJOR CONFLICT SIGNALS (Microsoft, NVIDIA).
              This is not legal advice.
```

**STOP — rename not implemented.**
