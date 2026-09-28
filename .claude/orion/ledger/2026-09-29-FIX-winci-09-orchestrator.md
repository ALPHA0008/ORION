# FIX-winci / CLOSE — orchestrator

CI run 36493148309 (de73774): ALL 7 jobs SUCCESS — test node22/24 × ubuntu/windows, static checks, package validation, eval selfcheck.
Windows CI red since the W6–W10 range is now green. Node 24 verified (ubuntu + windows).
On windows-latest (Windows-container Docker) container suites skip loudly; Linux isolation proofs come from ubuntu CI + local Docker Desktop.
Backlog (LOW): non-Linux wording; test cleanup in finally; ContainerSandbox ctor message should name rejected runtimes; 'no value' match; keep Linux CI leg mandatory; makeSandbox process.exit (library-level).
