# Name Gate — Round 2: AURORA · ORION · APEX · VOYAGER · COMET

**Investigation only. Nothing was renamed, registered, published, created or committed.**

All checks performed **2026-09-03, 11:37–11:48 UTC** against live registries and DNS.
Same method as [alpha-name-availability.md](alpha-name-availability.md) and
[cosmos-name-availability.md](cosmos-name-availability.md).

---

## Executive summary

**No candidate in this round clears the bar. Ranked decision:**

| # | name | decision | the one thing that decides it |
|---|---|---|---|
| 1 | **ORION** | `ORION_WITH_CAUTION` | **best of the five** — no major-vendor AI brand; but `orion` binary is owned (Eclipse Orion, 11,961 dl/mo) |
| 2 | **AURORA** | `AURORA_WITH_CAUTION` | AWS Aurora is a household database brand; `aurora.dev` is a blockchain |
| 3 | **APEX** | `APEX_BLOCKED` | Oracle APEX + Salesforce Apex (a **programming language**) + NVIDIA/apex + Apex.AI |
| 4 | **VOYAGER** | `VOYAGER_BLOCKED` | **MineDojo/Voyager (7.2k★) is an LLM agent** — our exact category |
| 5 | **COMET** | `COMET_BLOCKED` | **comet.com = "The AI Developer Platform"** (Comet ML, 21.8k★) + `rpamis/comet` = *"agent skill harness"* |

**Nothing here beats ALPHA**, and nothing here beats **KERNL**, which remains unscreened but is
coined, collision-free by construction, and already yours.

### The structural finding

**All five unscoped npm names are taken.** All five are dormant (last publish 2015–2020), so none
is *actively* contested on npm — but none is obtainable either.

More decisive: **the CLI binary is claimed for every single one.**

| candidate | who owns the `<name>` binary |
|---|---|
| `aurora` | `aurora-cli` → `bin: {aurora}` |
| `orion` | `orion` itself → `bin: {orion}` (Eclipse Orion) **and** `orion-cli` |
| `apex` | *(no package ships bare `apex`)* — **`apex-cli` ships `apex-cli`, not `apex`** |
| `voyager` | `voyager-cli` → `bin: {voyager}` |
| `comet` | `comet-cli` **and** `cometjs` → `bin: {comet}` |

APEX is the only one where the bare binary appears unclaimed — and APEX is blocked on brand grounds
anyway. This is the same trap documented in the ALPHA gate: a free scoped package name does not
mean a free command name.

**Every `@kernlbase/<name>` and every `kernlbase/<name>` on GitHub is available (all HTTP 404)** —
for all five. That surface never discriminates between candidates, so it cannot decide this.

---

## 1. npm — unscoped

| name | status | owner | created | last publish | dl/mo | ships binary |
|---|---|---|---|---|---|---|
| `aurora` | COLLISION | ianpaschal | 2011-10-06 | 2019-01-10 | 161 | no |
| `orion` | COLLISION | gheorghe, libingw | 2012-11-22 | 2019-03-29 | **11,961** | **yes — `orion`** |
| `apex` | COLLISION | dillonkrug | 2012-09-05 | 2020-01-01 | 714 | no |
| `voyager` | COLLISION | davidglivar | 2013-10-18 | 2015-02-18 | 4,982 | no |
| `comet` | COLLISION | rousan | 2013-09-08 | 2019-03-06 | 95 | no |

Descriptions, verbatim:

- `aurora` — *"A small entity-component-system game engine/framework."*
- `orion` — *"An Eclipse Orion server written in Node.js."* — **Eclipse Foundation lineage**
- `apex` — *"Work In Progress"* (a squatted stub, effectively)
- `voyager` — *"A STATIC SITE GENERATOR FROM THE EDGE OF THE SOLAR SYSTEM."*
- `comet` — *"A http long polling comet implementation"* — note "comet" is also a **generic web
  technique** (long-polling), which weakens it as a distinctive mark

**`orion` at 11,961 downloads/month is the most-used of the five** and the only one shipping the
command name we would want. That is a real, ongoing conflict, not a dormant one.

---

## 2. npm — scoped, and GitHub

| candidate | `@kernlbase/<name>` | `kernlbase/<name>` |
|---|---|---|
| aurora | **404 AVAILABLE** | **404 AVAILABLE** |
| orion | **404 AVAILABLE** | **404 AVAILABLE** |
| apex | **404 AVAILABLE** | **404 AVAILABLE** |
| voyager | **404 AVAILABLE** | **404 AVAILABLE** |
| comet | **404 AVAILABLE** | **404 AVAILABLE** |

Scope `@kernlbase` remains empty; publishing authority still **UNKNOWN** (`npm whoami` → `ENEEDAUTH`).
The `kernlbase` GitHub **org still does not exist** — unchanged pre-existing Track-B defect.

**This table is uninformative.** Availability is uniform, so the decision rests entirely on brand
collision and CLI-name collision below.

---

## 3. GitHub ecosystem pressure

| candidate | repos named | top repo | stars |
|---|---|---|---|
| **APEX** | **61,804** | apexcharts/apexcharts.js | 15,145 |
| **AURORA** | **30,702** | flipped-aurora/gin-vue-admin | 24,989 |
| **ORION** | **19,351** | orion-lib/OrionTV | 5,500 |
| **COMET** | 11,343 | **comet-ml/opik** | **21,761** |
| **VOYAGER** | 7,213 | **Nagi-ovo/voyager** | **19,933** |

Raw counts mislead — COMET and VOYAGER have the *fewest* repos but the **worst** collisions,
because theirs are in our category.

### Our niche — `<name> runtime`

| candidate | repos | top |
|---|---|---|
| aurora | 10 | 7★ |
| apex | 8 | 5★ |
| orion | 4 | 0★ |
| voyager | 1 | 0★ |
| comet | **0** | — |

All effectively empty. As established in the COSMOS gate, an empty niche is only meaningful if the
*name itself* is not already spoken for elsewhere — and for COMET and VOYAGER it is.

---

## 4. Category collisions — the deciding evidence

### COMET — `COMET_BLOCKED`

| entity | evidence | severity |
|---|---|---|
| **Comet ML** | `comet.ai` → **`comet.com`: "Comet - The AI Developer Platform"** | **CRITICAL** |
| **comet-ml/opik** | **21,761★, pushed 2026-09-03 (today)** — *"Debug, evaluate, and monitor your LLM applications, RAG systems, and agentic workflows"* | **CRITICAL** |
| **rpamis/comet** | 2,913★, pushed **today** — ***"Comet: agent skill harness for turning ideas into evaluated workflows"*** | **CRITICAL** |
| Perplexity Comet | `perplexity.ai/comet` → HTTP 301, live (Perplexity browser) | HIGH |
| apache/datafusion-comet | 1,264★ | MODERATE |
| generic "comet" | long-polling web technique — descriptive, weakens distinctiveness | MODERATE |

**`rpamis/comet` describes itself as an "agent skill harness."** That is our product category in our
own vocabulary, actively developed, 2.9k stars. Combined with Comet ML being *"The AI Developer
Platform"* for LLM observability — and Perplexity shipping a consumer product called Comet — this
name is the most contested of the five in the AI space specifically.

### VOYAGER — `VOYAGER_BLOCKED`

| entity | evidence | severity |
|---|---|---|
| **MineDojo/Voyager** | **7,174★** — *"An Open-Ended Embodied Agent with Large Language Models"* | **CRITICAL** |
| **Nagi-ovo/voyager** | **19,933★, pushed 2026-09-02** — *"Enhancement suite for Gemini, AI Studio, Claude & ChatGPT"* | **CRITICAL** |
| thedevdojo/voyager | 11,805★ — Laravel Admin | HIGH |
| APIs-guru/graphql-voyager | 8,161★ | MODERATE |
| adrielcafe/voyager | 3,090★ — Compose navigation | MODERATE |

**MineDojo/Voyager is one of the best-known LLM-agent repos in existence.** Naming an agent runtime
"Voyager" in 2026 reads as a reference to it, not as an independent brand. The second hit is an LLM
tooling suite with ~20k stars, pushed yesterday.

`voyager.dev` and `voyager.ai` returned no HTTP — possibly available — but that cannot rescue a name
this occupied inside our own category.

### APEX — `APEX_BLOCKED`

| entity | evidence | severity |
|---|---|---|
| **Salesforce Apex** | **a programming language** named Apex | **CRITICAL** |
| **Oracle APEX** | Oracle Application Express — major enterprise dev platform | **CRITICAL** |
| **NVIDIA/apex** | 8,999★, pushed 2026-09-01 — PyTorch extension | HIGH |
| **Apex.AI** | `apex.ai` → **"Apex.AI \| Software that moves"** — automotive OS company | HIGH |
| apexcharts | 15,145★ | HIGH |
| apex/up | 8,793★ — serverless deploys | MODERATE |

Salesforce Apex being **a programming language** is disqualifying on its own for a developer tool:
`apex run` is ambiguous with executing Apex code. Add Oracle's platform of the same name, NVIDIA's
active PyTorch library, and a company literally at `apex.ai`, and there is no lane.

61,804 GitHub repos — the most crowded name of the five.

### AURORA — `AURORA_WITH_CAUTION`

| entity | evidence | severity |
|---|---|---|
| **AWS Aurora** | Amazon flagship managed database | **HIGH** |
| **aurora.dev** | live — *"Aurora - The Network of Virtual Chains"*, Ethereum-compatible | **HIGH** |
| aurora-develop/aurora | 2,498★ — *"free chatgpt api"* | MODERATE |
| flipped-aurora/gin-vue-admin | 24,989★ | MODERATE |
| `aurora-cli` | owns the `aurora` binary | MODERATE |
| aurora.ai | **for sale** (Spaceship.com) | — |

Structurally the COSMOS problem again: a major cloud-database brand (AWS Aurora) plus a blockchain
holding `aurora.dev`. Not as bad as COSMOS — AWS Aurora is a *database*, further from us than Azure
Cosmos DB was — and no dominant AI-agent collision. But "Aurora" to a developer means AWS.

`aurora.ai` being listed for sale is the only acquirable premium domain surfaced in this entire
round.

### ORION — `ORION_WITH_CAUTION` — best of the five

| entity | evidence | severity |
|---|---|---|
| **npm `orion`** | Eclipse Orion, **11,961 dl/mo, owns the `orion` binary** | **HIGH** |
| orion-lib/OrionTV | 5,500★ — RN media player | MODERATE |
| RookieEnough/Orion-Store | 3,220★ | MODERATE |
| sintel-dev/Orion | 1,368★ — time-series anomaly detection | MODERATE |
| dromara/orion-visor | 1,303★ — ops/bastion platform | MODERATE |
| `orion.dev` / `orion.ai` | **no HTTP — possibly available** | — |

**ORION is the only candidate with no major-vendor AI/cloud brand attached.** No AWS, no Oracle, no
NVIDIA, no Salesforce, no LLM-agent landmark. Its collisions are mid-sized OSS projects spread
across unrelated categories (TV player, app store, anomaly detection, ops console) — dilution, not
confrontation.

Its real cost is the **CLI name**: `orion` is owned by Eclipse Orion, the most-downloaded package in
this round at ~12k/month. Unlike the other candidates' dormant squatters, this one is genuinely in
use.

Both `orion.dev` and `orion.ai` returned no HTTP and may be registrable — the only candidate where
*both* premium domains look open.

---

## 5. Domains

| candidate | `.dev` | `.ai` | `<name>.kernlbase.com` |
|---|---|---|---|
| aurora | **200 — blockchain** | **for sale** | available |
| orion | **no HTTP — possibly free** | **no HTTP — possibly free** | available |
| apex | no HTTP | **301 → Apex.AI** | available |
| voyager | no HTTP | no HTTP | available |
| comet | no HTTP | **301 → comet.com (Comet ML)** | available |

All five `<name>.kernlbase.com` subdomains are unclaimed (we control the zone).
"No HTTP" means no live site — **not** confirmed registrable; no WHOIS check was performed.

---

## 6. Trademark / legal-risk screen

**Technical/market screen only. Not legal advice. Not trademark clearance.**

| candidate | conflicting entities in software/AI class | classification |
|---|---|---|
| **APEX** | **Salesforce (Apex language)**, **Oracle (APEX)**, Apex.AI, NVIDIA | **OBVIOUS MAJOR CONFLICT SIGNALS** |
| **COMET** | **Comet ML** (comet.com), **Perplexity** (Comet browser) | **OBVIOUS MAJOR CONFLICT SIGNALS** |
| **AURORA** | **Amazon (AWS Aurora)**, Aurora Labs (blockchain) | **OBVIOUS MAJOR CONFLICT SIGNALS** |
| **VOYAGER** | thedevdojo Voyager, MineDojo Voyager (mostly OSS/academic) | **POTENTIALLY RELEVANT CONFLICTS** |
| **ORION** | Eclipse Orion (Eclipse Foundation), assorted mid-size OSS | **POTENTIALLY RELEVANT CONFLICTS** |

Three of five carry conflicts with Salesforce, Oracle, Amazon, NVIDIA or Perplexity.
**PROFESSIONAL LEGAL REVIEW REQUIRED** for any adoption. This screen cannot and does not clear any
mark.

---

## 7. Product naming test

| candidate | `<name> run "fix the bug"` | ambiguity | semantic fit |
|---|---|---|---|
| **ORION** | reads cleanly, distinctive | moderate — Eclipse Orion, mostly outside our space | **neutral** — constellation, no false promise |
| **AURORA** | reads cleanly | **high** — "is this AWS Aurora?" | weak — light phenomenon, ephemeral; we sell durability |
| **APEX** | reads cleanly | **severe** — `apex run` collides with executing Salesforce Apex | weak — "peak/summit" implies benchmark leadership we explicitly disclaim |
| **VOYAGER** | 3 syllables, longest | **severe** — reads as the LLM-agent repo | weak — "voyage" implies exploration/autonomy; we sell recoverability |
| **COMET** | reads cleanly | **severe** — Comet ML is an LLM dev platform | weak — comets are transient; **actively wrong** for a durability product |

**Semantic fit matters independently of collisions**, as established in the COSMOS gate. This
product's pitch is *durable, inspectable, replayable*. AURORA (ephemeral light), COMET (transient
object) and VOYAGER (one-way journey) all connote **transience or departure** — the opposite. APEX
connotes **peak performance**, which the README explicitly disclaims ("no benchmark leadership of
any kind").

**ORION is the only one that promises nothing false.** A fixed constellation used for navigation is,
if anything, mildly on-message.

---

## 8. Decision matrix

| Surface | AURORA | ORION | APEX | VOYAGER | COMET |
|---|---|---|---|---|---|
| npm unscoped | COLLISION (dormant) | COLLISION (**active, 12k/mo**) | COLLISION (stub) | COLLISION (dormant) | COLLISION (dormant) |
| `@kernlbase/<n>` | AVAILABLE | AVAILABLE | AVAILABLE | AVAILABLE | AVAILABLE |
| **CLI binary** | **taken** (aurora-cli) | **taken** (Eclipse Orion) | **likely free** | **taken** (voyager-cli) | **taken** (comet-cli, cometjs) |
| `npx <name>` | COLLISION | COLLISION | COLLISION | COLLISION | COLLISION |
| GitHub `kernlbase/<n>` | AVAILABLE | AVAILABLE | AVAILABLE | AVAILABLE | AVAILABLE |
| `.dev` | **taken** | possibly free | possibly free | possibly free | possibly free |
| `.ai` | **for sale** | possibly free | **taken** | possibly free | **taken** |
| subdomain | available | available | available | available | available |
| **major-vendor brand** | **AWS** | **none** | **Oracle+Salesforce+NVIDIA** | none (but LLM landmark) | **Comet ML + Perplexity** |
| **AI-category collision** | minor | **none** | HIGH | **CRITICAL** | **CRITICAL** |
| semantic fit | weak | **neutral** | weak | weak | **actively wrong** |
| **verdict** | `WITH_CAUTION` | **`WITH_CAUTION`** | **`BLOCKED`** | **`BLOCKED`** | **`BLOCKED`** |

---

## 9. Cross-round comparison

| name | high-risk collisions | CLI free | AI-category clash | qualifier rescues it | verdict |
|---|---|---|---|---|---|
| **KERNL** *(unscreened)* | expected 0 | likely | none | n/a — it *is* the brand | **screen this next** |
| **ALPHA** | 1 (`alpha.dev`) | ✗ | 1 adjacent | **yes** | `ALPHA_WITH_CAUTION` |
| **ORION** | 1 (Eclipse Orion) | ✗ | **none** | probably | `ORION_WITH_CAUTION` |
| **AURORA** | 2 (AWS, aurora.dev) | ✗ | minor | partly | `AURORA_WITH_CAUTION` |
| **COSMOS** | 3 (MS, NVIDIA, Cosmos SDK) | ✓ | 1 (NVIDIA) | **no** | `COSMOS_BLOCKED` |
| **APEX** | 4 (Oracle, Salesforce, NVIDIA, Apex.AI) | ✓ | 1 | no | `APEX_BLOCKED` |
| **VOYAGER** | 2 OSS giants | ✗ | **2 CRITICAL** | no | `VOYAGER_BLOCKED` |
| **COMET** | 3 (Comet ML, Perplexity, +) | ✗ | **3 CRITICAL** | no | `COMET_BLOCKED` |

**ORION and ALPHA are the two live candidates.** ORION has the cleaner category (no AI-space
collision at all); ALPHA has the cleaner *product* story but sits next to `alpha.dev`'s agent OS and
carries the "pre-release" connotation.

---

## 10. Sources and timestamps

All checks **2026-09-03 11:37–11:48 UTC**:

| source | queried |
|---|---|
| `registry.npmjs.org/{aurora,orion,apex,voyager,comet}` | full packuments — owners, dates, `bin` fields |
| `registry.npmjs.org/{*-cli,*js}` | binary-ownership inspection, 10 packages |
| `api.npmjs.org/downloads/point/last-month/` | aurora 161 · orion 11,961 · apex 714 · voyager 4,982 · comet 95 |
| `registry.npmjs.org/@kernlbase%2F*` | all five → 404 |
| `api.github.com/repos/kernlbase/*` | all five → 404 |
| `api.github.com/search/repositories` | `<name> in:name` and `<name>+runtime+in:name`, all five |
| `api.github.com/repos/` | MineDojo/Voyager, comet-ml/opik, rpamis/comet, Nagi-ovo/voyager, NVIDIA/apex, apex/up |
| DNS + HTTPS titles | `<name>.dev`, `<name>.ai`, `<name>.kernlbase.com`, apex.ai, comet.com, aurora.dev, perplexity.ai/comet |

**Limits:** no formal trademark database search (USPTO API unreachable in the ALPHA gate, not
retried); **no WHOIS** — "no HTTP" means no live site, not confirmed registrable; npm publishing
authority for `@kernlbase` still unverified; Oracle APEX and Salesforce Apex were assessed from
established knowledge, not fetched (`apex.oracle.com` returned no HTTP from this network).

---

## 11. Final decision

```
AURORA   → AURORA_WITH_CAUTION   (AWS Aurora; aurora.dev is a blockchain; weak semantic fit)
ORION    → ORION_WITH_CAUTION    (best of round — no major-vendor AI brand; CLI name taken)
APEX     → APEX_BLOCKED          (Salesforce Apex is a LANGUAGE; Oracle APEX; NVIDIA; Apex.AI)
VOYAGER  → VOYAGER_BLOCKED       (MineDojo/Voyager is a landmark LLM agent — our exact category)
COMET    → COMET_BLOCKED         (comet.com = "The AI Developer Platform"; rpamis/comet =
                                  "agent skill harness"; Perplexity Comet)
```

**Recommendation: none of these five should displace the leaders.**

If a name from this round must be chosen, it is **ORION** — uniquely free of major-vendor AI
branding, semantically honest, and the only candidate where both `.dev` and `.ai` appear
unregistered. It would ship as **`@kernlbase/orion`** with a **non-`orion` binary** (the command
name belongs to Eclipse Orion), which is a real ergonomic cost.

**Standing recommendation is unchanged: screen KERNL.** You already own `kernlbase.com`, the token
is coined, and it is the only option in three rounds of screening with no incumbent to work around.

---

## NAME_GATE_ROUND2_COMPLETE

```
Screened:    AURORA, ORION, APEX, VOYAGER, COMET
Blocked:     APEX, VOYAGER, COMET
With caution: AURORA, ORION  (ORION strongest)
npm scoped:  @kernlbase/<all five> — AVAILABLE
GitHub:      kernlbase/<all five> — AVAILABLE (org `kernlbase` still does not exist)
CLI names:   ALL FIVE CLAIMED except possibly `apex` (which is blocked on brand grounds)
npx <name>:  COLLISION for all five — never document the unscoped form
Legal screen: LEGAL REVIEW REQUIRED for all. OBVIOUS MAJOR CONFLICT SIGNALS for
              APEX (Oracle/Salesforce), COMET (Comet ML/Perplexity), AURORA (AWS).
              This is not legal advice and not trademark clearance.
Leaders unchanged: KERNL (unscreened) > ALPHA ≈ ORION
```

**STOP — rename not implemented.**
