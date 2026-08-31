// Diagnosis -> action instrument (§2-§4, §21).
//
// Classifies committed trajectories WITHOUT an LLM judge (§2). Detection is deliberately
// conservative: a run counts as DIAGNOSIS_COMPLETE only on trajectory evidence plus a
// task-specific signal, and anything that cannot be established is reported as UNDETECTED
// rather than guessed.
//
// Reads reports; changes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.join(HERE, '..', 'reports');

// Task-specific evidence of a CORRECT diagnosis: the concrete symbol/'fix' the task turns on.
// Conservative by design — a run must name the actual defect, not merely mention the file.
export const DIAGNOSIS_SIGNALS = {
  'camel-unicode-uppercase':      [/\\p\{Lu\}/, /UPPERCASE/],
  'camel-separator-strip':        [/SEPARATORS/],
  'camel-leading-capital':        [/LEADING_CAPITAL/],
  'camel-leading-separators':     [/LEADING_SEPARATORS/],
  'camel-numbers-identifier':     [/NUMBERS_AND_IDENTIFIER|\\d\+/],
  'camel-identifier-endanchor':   [/IDENTIFIER/],
  'camel-preserve-consecutive':   [/preserveConsecutiveUppercase/],
  'isnum-finite-inversion':       [/isFinite/],
  'isnum-nan-guard':              [/num - num|NaN/],
  'isnum-string-trim':            [/trim\(\)/],
  'isnum-hidden-contract':        [/typeof|Boolean/],
  'plimit-active-count':          [/activeCount/],
  'plimit-concurrency-guard':     [/concurrency/],
  'plimit-error-propagation':     [/resolve|reject|catch/],
  'plimit-validate-concurrency':  [/validateConcurrency/],
  'slug-decamelize-acronym':      [/decamelize|\[A-Z\]/],
  'slug-lowercase-option':        [/lowercase/],
  'slug-trailing-separator':      [/separator/],
  'slug-overridable-replacements':[/overridableReplacements|&/],
  'slug-preserve-conflict':       [/preserveCharacters|separator/],
  'ansi-brightness-bit':          [/ansi256ToAnsi|value === 2|brightness/i],
  'ansi-16m-escape':              [/38;2|ansi16m/],
};

const MUTATORS = new Set(['edit', 'write']);

/** Parse the rendered trajectory into an ordered list of {kind, name, text}. */
export function parseTrajectory(explain) {
  const events = [];
  for (const line of String(explain ?? '').split('\n')) {
    let m;
    if ((m = /· (\w+) \{/.exec(line))) events.push({ kind: 'tool_call', name: m[1], text: line });
    else if ((m = /🧠 wants \d+ tool call/.exec(line))) events.push({ kind: 'model_wants', text: line });
    else if (/🧠 "/.test(line)) events.push({ kind: 'model_prose', text: line });
    else if (/✓ completed/.test(line)) events.push({ kind: 'completed', text: line });
    else if (/✕ failed/.test(line)) events.push({ kind: 'failed', text: line });
    else if (/✓ \w+ →/.test(line)) events.push({ kind: 'tool_result', text: line });
  }
  return events;
}

/**
 * Conservative DIAGNOSIS_COMPLETE detector (§2).
 *
 * Requires BOTH:
 *   - the run actually read the relevant source (evidence it looked), and
 *   - the final message names the task's concrete defect signal.
 *
 * Returns { diagnosed: true|false|null } where null means "cannot be reliably detected".
 */
export function detectDiagnosis(r) {
  const signals = DIAGNOSIS_SIGNALS[r.task_id];
  if (!signals) return { diagnosed: null, why: 'no task signal defined' };

  const events = parseTrajectory(r.explain);
  const didRead = events.some(e => e.kind === 'tool_call' && e.name === 'read');
  const finalMsg = String(r.final_message ?? '');
  const named = signals.some(re => re.test(finalMsg));

  if (!didRead) return { diagnosed: false, why: 'never read the source' };
  if (!named) return { diagnosed: false, why: 'final message does not name the defect' };
  return { diagnosed: true, why: 'read source AND named the concrete defect' };
}

/** Classify one run into A/B/C/D (§4) plus the action metrics (§3, §21). */
export function classify(r) {
  const events = parseTrajectory(r.explain);
  const mutations = events.filter(e => e.kind === 'tool_call' && MUTATORS.has(e.name));
  const d = detectDiagnosis(r);

  // §3 latency: model calls between the LAST read and the first mutation.
  let latency = null, firstAction = 'none';
  if (mutations.length) {
    firstAction = mutations[0].name;
    const idx = events.indexOf(mutations[0]);
    latency = events.slice(0, idx).filter(e => e.kind === 'model_wants' || e.kind === 'model_prose').length;
  }

  // §12: did the run terminate with prose and no mutation at all?
  const prematureCompletion = r.agent_reason === 'model_finished' && mutations.length === 0;

  let outcome;
  if (d.diagnosed === null) outcome = 'UNDETECTED';
  else if (!d.diagnosed) outcome = 'D-incorrect-or-absent-diagnosis';
  else if (mutations.length === 0) outcome = 'C-diagnosis-no-action';
  else if (r.outcome === 'PASS') outcome = 'A-diagnosis-correct-action';
  else outcome = 'B-diagnosis-wrong-action';

  return {
    task_id: r.task_id, model_outcome: r.outcome, failure_class: r.failure_class ?? null,
    diagnosis_complete: d.diagnosed, diagnosis_why: d.why,
    outcome, mutations: mutations.length, first_action: firstAction,
    action_latency_model_calls: latency,
    premature_completion: prematureCompletion,
    agent_reason: r.agent_reason,
    model_calls: r.metrics?.model_calls ?? null,
  };
}

/** Aggregate the §21 metrics over a report. */
export function summarise(rows) {
  const detected = rows.filter(r => r.diagnosis_complete !== null);
  const diagnosed = detected.filter(r => r.diagnosis_complete);
  const acted = diagnosed.filter(r => r.mutations > 0);
  const correctAction = diagnosed.filter(r => r.outcome === 'A-diagnosis-correct-action');
  const lat = acted.map(r => r.action_latency_model_calls).filter(n => n != null);
  return {
    runs: rows.length,
    undetected: rows.length - detected.length,
    diagnosis_complete: diagnosed.length,
    action_attempted: acted.length,
    diagnosis_to_action_rate: diagnosed.length ? +(acted.length / diagnosed.length).toFixed(3) : null,
    correct_action_given_correct_diagnosis:
      diagnosed.length ? +(correctAction.length / diagnosed.length).toFixed(3) : null,
    premature_completion: rows.filter(r => r.premature_completion).length,
    task_success: rows.filter(r => r.model_outcome === 'PASS').length,
    mean_action_latency: lat.length ? +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(1) : null,
    by_outcome: rows.reduce((acc, r) => { acc[r.outcome] = (acc[r.outcome] ?? 0) + 1; return acc; }, {}),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const files = process.argv.slice(2);
if (files.length) {
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(REPORTS, f), 'utf8'));
    const rows = (d.results ?? []).filter(r => r.explain).map(classify);
    console.log(`\n=== ${f} (${d.model}) ===`);
    console.log(JSON.stringify(summarise(rows), null, 2));
    console.log('\nper task:');
    for (const r of rows)
      console.log(`  ${r.task_id.padEnd(30)} ${String(r.model_outcome).padEnd(5)} ` +
        `diag=${String(r.diagnosis_complete).padEnd(5)} mut=${r.mutations} ` +
        `${r.outcome}${r.premature_completion ? '  [premature]' : ''}`);
  }
}
