// W7 C — project instructions: the project's standing brief.
//
// WHY THESE ARE NOT PROGRESSIVE
//
// Skills are opt-in: the model sees a catalogue and pulls in what it judges relevant. Project
// instructions are the opposite — they are the conventions that apply to everything the agent
// does in this repository, and an agent that has to *decide* to read the build command has
// already had the chance to guess it wrong. So they are ALWAYS loaded, and the budget cost is
// accepted deliberately (with a cap, below) rather than traded away.
//
// ECOSYSTEM COMPATIBILITY, AND WHY ONLY ONE FILE IS READ
//
// `AGENTS.md` is the cross-harness convention; `CLAUDE.md` is recognised as an EQUIVALENT at the
// same precedence step. The plan is explicit that they are one voice, not two ("do not load both
// as distinct voices"), and that is the right call for a reason worth stating: a repository that
// carries both almost always carries the same brief twice, and loading both would double the
// tokens while inviting the model to reconcile two texts that were never meant to disagree. So
// exactly one file wins, deterministically, and the loser is RECORDED as shadowed — because
// "why is my CLAUDE.md being ignored?" is a question the trajectory should answer.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Candidate filenames, strongest first.
 *
 * `AGENTS.md` leads because it is the neutral cross-harness convention and this runtime is not
 * Claude Code; a project that has deliberately written one is stating its intent for any agent.
 */
export const INSTRUCTION_FILES = Object.freeze(['AGENTS.md', 'CLAUDE.md', '.agents/AGENTS.md']);

/**
 * A hard ceiling on how much of a project brief enters every single request.
 *
 * Wave 3 made outbound context budgeted and measured; an unbounded `AGENTS.md` would defeat that
 * silently, because unlike a tool result it is re-sent on EVERY turn and is never compacted away
 * (the system prompt is rebuilt fresh each turn — worker `#buildMessages`). A 100 KB brief would
 * therefore cost 100 KB per model call for the life of the run. Truncation is announced in the
 * text the model sees AND recorded on the event, so a silently-halved brief is not possible.
 */
export const MAX_INSTRUCTION_BYTES = 8 * 1024;

export const instructionDigest = (s) =>
  crypto.createHash('sha256').update(String(s ?? '')).digest('hex').slice(0, 16);

/**
 * Find and read the project's instruction file.
 *
 * @returns {{found: boolean, path?: string, name?: string, text?: string, digest?: string,
 *            bytes?: number, truncated?: boolean, shadowed?: {name:string,path:string}[]}}
 */
export function loadProjectInstructions(workspace, { maxBytes = MAX_INSTRUCTION_BYTES } = {}) {
  if (!workspace) return { found: false, shadowed: [] };

  const present = [];
  for (const rel of INSTRUCTION_FILES) {
    const p = path.join(workspace, rel);
    try {
      const st = fs.statSync(p);
      if (st.isFile()) present.push({ name: rel, path: p });
    } catch { /* absent */ }
  }
  if (!present.length) return { found: false, shadowed: [] };

  const [winner, ...rest] = present;
  let raw;
  try { raw = fs.readFileSync(winner.path, 'utf8'); }
  catch { return { found: false, shadowed: [] }; }

  const full = Buffer.byteLength(raw, 'utf8');
  let text = raw.trim();
  let truncated = false;
  if (full > maxBytes) {
    // Cut on a line boundary so the model is not handed a half sentence, and SAY SO in the text
    // itself — a truncation the model cannot see is a truncation it will reason past.
    const slice = Buffer.from(raw, 'utf8').subarray(0, maxBytes).toString('utf8');
    text = slice.slice(0, slice.lastIndexOf('\n') > 0 ? slice.lastIndexOf('\n') : slice.length).trim()
      + `\n\n[...truncated: this file is ${full} bytes and only the first ${maxBytes} are shown.`
      + ` Read ${winner.name} directly if you need the rest.]`;
    truncated = true;
  }

  return {
    found: true,
    path: winner.path,
    name: winner.name,
    text,
    digest: instructionDigest(raw),   // the digest is of the FILE, not the truncated view
    bytes: full,
    truncated,
    // Recorded so "my CLAUDE.md is being ignored" has an answer in the log rather than in a
    // support thread.
    shadowed: rest.map(r => ({ name: r.name, path: r.path })),
  };
}

/** The block that goes into the system prompt. Clearly fenced so its authority is unambiguous. */
export function renderInstructions(loaded) {
  if (!loaded?.found) return null;
  return `Project instructions from ${loaded.name} — these are the conventions of the repository\n`
    + `you are working in. Follow them unless the task explicitly overrides them.\n\n`
    + loaded.text;
}
