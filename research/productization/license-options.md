# License Options — Analysis Only

**No LICENSE file is added by this wave.** This is an analysis; the choice is yours.

## Current state

| item | finding |
|---|---|
| `LICENSE` file | **absent** |
| `README.md` §Licence | *"Not yet chosen. Treat as all-rights-reserved until one is added."* |
| package metadata | **none** — no `package.json` exists anywhere |
| copyright notices in source | none found in `v0/src` |
| third-party runtime dependencies | **zero** — every import is a `node:` builtin or relative |

The README is already honest about the status, which is the right default.

## What "no license" means today

Under default copyright, **all rights reserved**. Nobody may legally use, copy, modify or
redistribute the code, even though it is visible. For an OSS release this is the single hardest
blocker — a repository without a license is not open source regardless of intent.

## The dependency situation is unusually clean

The runtime has **no third-party production dependencies**:

```
node:child_process · node:crypto · node:fs · node:os · node:path · node:sqlite
```

All six are Node builtins. Consequences:

- **No inherited copyleft.** No GPL/AGPL dependency can force a license choice.
- **No attribution obligations** from a dependency tree.
- **No license-compatibility matrix to compute.** This is rare and it means the choice is
  genuinely free.

One caveat to check before release: `research/repos/` contains **cloned third-party repositories**
(QM, Hermes Agent, Ruflo) used for the audit. They are gitignored and never committed, but the
*findings* derived from reading them live in `research/`. Those are original analysis, not derived
code — worth a deliberate confirmation that no third-party source was copied into `v0/src`.

## MIT

- **Implications**: maximum adoption, minimum friction. Permissive; users may relicense, embed in
  proprietary products, and are not obliged to contribute back.
- **Fit**: strong if the goal is the harness becoming widely used infrastructure.
- **Risk to the Kernlbase split**: MIT lets anyone — including a competitor — build the governance
  layer you intend to keep commercial, on top of your runtime, with no obligation.

## Apache-2.0

- **Implications**: permissive like MIT, plus an **express patent grant** and a patent-retaliation
  clause, plus a `NOTICE`/attribution requirement on redistribution.
- **Fit**: the conventional choice for infrastructure a company intends to build a commercial
  product beside. The patent grant is meaningful for anything with novel execution semantics —
  and this runtime has 13 ADRs of them.
- **Cost**: marginally more ceremony (NOTICE file, change notes on modified files).

## Others briefly considered

| license | why not the default here |
|---|---|
| **BSL / SSPL** | Not OSI-approved open source. Would contradict the stated "open-source harness" positioning. |
| **AGPL** | Copyleft over network use. Deters exactly the commercial adopters the OSS/Kernlbase split is designed to attract. |
| **MPL-2.0** | File-level copyleft. Defensible, but unusual for a runtime and adds adopter friction for little gain here. |

## Recommendation

**Apache-2.0**, for three reasons grounded in this project specifically:

1. **Patent grant.** The value here is execution semantics — pre-state witnesses, fencing,
   recovery classes, replay/fork. Apache-2.0's explicit grant is the standard protection for
   exactly that kind of contribution, and MIT is silent on patents.
2. **Commercial-adjacent norm.** The intended structure (OSS runtime → Kernlbase control plane)
   is the same shape as projects that conventionally choose Apache-2.0. Enterprises' legal
   review of Apache-2.0 is routine.
3. **No dependency constraints force otherwise.** With zero third-party production dependencies,
   the choice is unconstrained — so pick on strategy, not compatibility.

If maximum frictionless adoption outweighs patent protection, **MIT** is the reasonable
alternative. Both are defensible; neither is blocked by the codebase.

## Required before any OSS release

1. Choose the license and add `LICENSE` at the repository root.
2. Update `README.md` §Licence to match.
3. Add the license field to `package.json` **when it is created** (it does not exist yet).
4. Confirm explicitly that no audited third-party source was copied into `v0/src`.
5. Decide whether `research/` and `eval/` ship under the same license or stay unpublished — they
   contain the evidence, not the product, and that is a separate decision.
