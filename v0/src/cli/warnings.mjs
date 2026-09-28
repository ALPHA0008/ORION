// P0: keep `orionctl <verb> --json 2>&1` machine-readable on Node 22.
//
// Node 22 prints `ExperimentalWarning: SQLite is an experimental feature...` to stderr the first
// time `node:sqlite` loads, and a script merging the streams gets it glued to the JSON. This is a
// cosmetic Node notice about the runtime's own dependency, not a degradation of ORION behaviour,
// so it gets no `degraded` event (ADR-010 is about ORION falling back, which nothing here does).
// Why wrap `process.emitWarning` rather than swap the 'warning' listener: the drop happens before
// the event exists, so every other warning — including user `--trace-warnings`/`--no-warnings`
// handling and any listener someone else installed — goes through Node's printer untouched.
// Why not NODE_NO_WARNINGS: that silences deprecations and real problems too.

/** @param {unknown} warning @param {unknown} [typeOrOptions] */
export function isSqliteExperimentalWarning(warning, typeOrOptions) {
  const type = typeof typeOrOptions === 'string' ? typeOrOptions
    : (typeOrOptions && typeof typeOrOptions === 'object' && 'type' in typeOrOptions) ? typeOrOptions.type
    : warning instanceof Error ? warning.name : undefined;
  const message = typeof warning === 'string' ? warning : warning instanceof Error ? warning.message : '';
  return type === 'ExperimentalWarning' && /\bSQLite\b/.test(message);
}

/** Install once, from the CLI entry only — never from a library import. */
export function filterSqliteExperimentalWarning() {
  const original = process.emitWarning;
  if (/** @type {any} */ (original).orionSqliteFilter) return;
  /** @type {any} */
  const filtered = function (/** @type {any} */ warning, /** @type {any[]} */ ...rest) {
    if (isSqliteExperimentalWarning(warning, rest[0])) return;
    return original.call(process, warning, ...rest);
  };
  filtered.orionSqliteFilter = true;
  process.emitWarning = filtered;
}
