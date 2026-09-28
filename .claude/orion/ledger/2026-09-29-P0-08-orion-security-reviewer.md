# P0 / S5 REVIEW — orion-security-reviewer

VERDICT: APPROVE (static review; suites not run by reviewer).
- HIGH (fixed by this change → release note): old shadow name = first 8 path bytes → workspaces sharing an 8-char prefix
  (e.g. everything under C:\Users) shared one checkpoint repo → cross-project content exposure / restore contamination (same user, local).
  sha1 fix sound. Residual LOW: drive-letter case yields two shadows (harmless). Old shadows orphaned, may hold mixed history → tell users to delete.
- LOW: requestTimeoutMs has no upper bound; >2^31-1 clamps to 1ms → abort storm; tiny values same; repo-level config could DoS. Fix: bound e.g. 1000..2^31-1 in validator + env guard.
- INFO: emitWarning filter narrow; qwen shim never touches tool_calls; tx retry bounded, fails closed; tests isolated; secret scan clean.
- P2 opinion: `bash -lc` host profile sourcing = MEDIUM (env/secret exposure, reproducibility) → `bash --noprofile --norc` + scrubbed env.
