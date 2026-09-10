// W7 A + D — skill discovery, parsing, and the precedence ladder.
//
// WHAT A SKILL IS HERE, AND WHAT IT IS NOT
//
// A skill is INSTRUCTION TEXT. It is markdown with YAML frontmatter that the model may read and
// follow, and it has exactly the same trust posture as the system prompt itself. There is no
// plugin engine, no sandboxed evaluation, and no loading of skill *code*: a fenced code block in
// a `SKILL.md` is text the model may choose to run through the ordinary tool path, where the
// authorizer and the sandbox boundary apply as they always do. This is precisely why the plan
// calls W7 "no new trust boundary", and it must stay that way — the moment a skill could execute,
// W7 would have quietly become W9's problem without W9's gating.
//
// PROGRESSIVE DISCLOSURE IS A BUDGET DECISION, NOT A UX ONE
//
// At run start only `name` + `description` of each skill is put in front of the model — a line
// or two each. The BODY is loaded only when the model activates one. Wave 3 established that
// outbound context is budgeted (`contextBudgetBytes`, default 24_000, measured on the real
// outbound array) and that budget is what keeps a long run affordable. A dozen skills inlined in
// full would consume it before the conversation started, so disclosure is what makes skills
// compatible with the context discipline rather than a way around it.
//
// THE FORMAT IS BORROWED, NOT INVENTED (plan §10.2 W7, verbatim: "Do not invent a format where a
// convention exists"). `SKILL.md` with YAML frontmatter carrying `name` and `description` is what
// Claude Code and the `.agents` convention already use, so a skill authored for another harness
// loads here unchanged. The frontmatter parser below is deliberately small and tolerant: it reads
// the keys this runtime needs and ignores the rest rather than rejecting a document because it
// carries fields another harness cares about.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Precedence, weakest to strongest (plan §10.2 W7): bundled → user → project → plugin.
 *
 * A later source overrides an earlier one of the same skill name. The ordering is the plan's and
 * the reasoning is ordinary: the runtime's own defaults are the weakest claim, an operator's
 * machine-wide preference beats them, the project being worked on beats that, and an explicitly
 * installed plugin is the most specific statement of intent.
 */
export const SCOPES = Object.freeze(['bundled', 'user', 'project', 'plugin']);
const SCOPE_RANK = Object.freeze(Object.fromEntries(SCOPES.map((s, i) => [s, i])));

/** Directory layouts to search, per scope. Ecosystem conventions come FIRST within a scope. */
export function skillSearchPaths({ workspace, home = null, bundled = null, env = process.env }) {
  const userHome = home ?? env.ORION_HOME ?? null;
  const out = [];
  const add = (scope, dir) => { if (dir) out.push({ scope, dir }); };

  // bundled — shipped with the runtime
  add('bundled', bundled);

  // user — machine-wide, the operator's own skills
  if (userHome) {
    add('user', path.join(userHome, 'skills'));
  }
  if (env.HOME || env.USERPROFILE) {
    const h = env.HOME ?? env.USERPROFILE;
    // The ecosystem conventions, read at the user level exactly as other harnesses do.
    add('user', path.join(h, '.claude', 'skills'));
    add('user', path.join(h, '.agents', 'skills'));
  }

  // project — the repository being worked on. These are the ones that matter most in practice,
  // and reading the existing conventions is what makes an already-authored skill work here.
  if (workspace) {
    add('project', path.join(workspace, '.claude', 'skills'));
    add('project', path.join(workspace, '.agents', 'skills'));
    add('project', path.join(workspace, '.orion', 'skills'));
  }

  // plugin — explicitly installed, most specific
  const pluginDirs = String(env.ORION_SKILL_PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const d of pluginDirs) add('plugin', d);

  return out;
}

/**
 * Parse YAML frontmatter.
 *
 * Deliberately a small reader rather than a YAML dependency: the runtime ships zero production
 * dependencies, and frontmatter in this convention is a flat map of scalars. It handles the
 * shapes that appear in real skill files — quoted and unquoted scalars, `>`/`|` block strings,
 * and simple inline lists — and IGNORES anything it does not understand instead of failing. A
 * skill written for another harness will carry keys this runtime has no opinion about; rejecting
 * the document over them would defeat the compatibility requirement.
 */
export function parseFrontmatter(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { data: {}, body: src.trim(), hadFrontmatter: false };

  /** @type {Record<string, any>} */
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let raw = kv[2].trim();

    // Block scalars: `key: |` / `key: >` followed by an indented block.
    if (raw === '|' || raw === '>' || raw === '|-' || raw === '>-') {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        block.push(lines[++i].replace(/^\s{1,4}/, ''));
      }
      data[key] = raw.startsWith('>') ? block.join(' ').trim() : block.join('\n').trim();
      continue;
    }
    // Inline list: `key: [a, b]`
    if (/^\[.*\]$/.test(raw)) {
      data[key] = raw.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean);
      continue;
    }
    // Block list: `key:` followed by `- item` lines.
    if (raw === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[++i].replace(/^\s*-\s+/, '').trim()));
      }
      data[key] = items.length ? items : '';
      continue;
    }
    data[key] = unquote(raw);
  }
  return { data, body: src.slice(m[0].length).trim(), hadFrontmatter: true };
}

const unquote = (s) => {
  const t = String(s ?? '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1);
  return t;
};

/** Content hash — the identity that makes replay checkable and an edit visible in the log. */
export const skillDigest = (s) =>
  crypto.createHash('sha256').update(String(s ?? '')).digest('hex').slice(0, 16);

/**
 * Read one `SKILL.md`.
 *
 * `name` falls back to the containing directory, which is how these are conventionally
 * identified and means a file missing the key is still usable rather than silently dropped.
 */
export function readSkillFile(file, scope) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const { data, body, hadFrontmatter } = parseFrontmatter(text);
  const dirName = path.basename(path.dirname(file));
  const name = String(data.name ?? dirName).trim();
  if (!name) return null;
  const description = String(data.description ?? '').trim();
  return {
    name,
    description,
    body,
    scope,
    path: file,
    // A skill with no description is still loadable but is much less useful under progressive
    // disclosure, because description is ALL the model sees before activating. Flagged rather
    // than rejected — refusing it would break compatibility with a file another harness accepts.
    hasDescription: description.length > 0,
    hadFrontmatter,
    digest: skillDigest(text),
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

/** Find every `SKILL.md` under `dir` (one level of skill directories, plus `dir/SKILL.md`). */
function scanDir(dir, scope) {
  const found = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  // `<dir>/SKILL.md` — a single skill placed directly in the search path.
  if (entries.some(e => e.isFile() && e.name.toLowerCase() === 'skill.md')) {
    const s = readSkillFile(path.join(dir, entries.find(e => e.name.toLowerCase() === 'skill.md').name), scope);
    if (s) found.push(s);
  }
  // `<dir>/<skill-name>/SKILL.md` — the conventional layout.
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    let inner;
    try { inner = fs.readdirSync(path.join(dir, e.name), { withFileTypes: true }); } catch { continue; }
    const f = inner.find(x => x.isFile() && x.name.toLowerCase() === 'skill.md');
    if (!f) continue;
    const s = readSkillFile(path.join(dir, e.name, f.name), scope);
    if (s) found.push(s);
  }
  return found;
}

/**
 * Discover every available skill, resolved by precedence.
 *
 * @returns {{skills: any[], shadowed: any[], searched: {scope:string,dir:string,found:number}[]}}
 */
export function discoverSkills({ workspace = null, home = null, bundled = null, env = process.env } = {}) {
  const searched = [];
  /** @type {Map<string, any>} */
  const byName = new Map();
  const shadowed = [];

  for (const { scope, dir } of skillSearchPaths({ workspace, home, bundled, env })) {
    const found = scanDir(dir, scope);
    searched.push({ scope, dir, found: found.length });
    for (const s of found) {
      const prev = byName.get(s.name);
      if (!prev) { byName.set(s.name, s); continue; }
      // Same name, two sources: the stronger scope wins. Recorded rather than silently dropped,
      // because "my project skill did not take effect" is exactly the question a shadowing bug
      // produces and the log should be able to answer it.
      if (SCOPE_RANK[s.scope] >= SCOPE_RANK[prev.scope]) {
        shadowed.push({ name: s.name, hidden: prev.path, hiddenScope: prev.scope,
                        winner: s.path, winnerScope: s.scope });
        byName.set(s.name, s);
      } else {
        shadowed.push({ name: s.name, hidden: s.path, hiddenScope: s.scope,
                        winner: prev.path, winnerScope: prev.scope });
      }
    }
  }

  const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { skills, shadowed, searched };
}

/**
 * The DISCLOSURE text — names and descriptions only.
 *
 * This is the whole of progressive disclosure: what the model sees before it has chosen anything.
 * It is deliberately compact, and it names the activation mechanism explicitly, because a
 * catalogue the model cannot act on is just tokens.
 */
export function renderDisclosure(skills, { maxDescription = 220 } = {}) {
  if (!skills.length) return null;
  const lines = skills.map(s => {
    const d = s.description
      ? (s.description.length > maxDescription
          ? s.description.slice(0, maxDescription) + '…'
          : s.description)
      : '(no description provided)';
    return `  - ${s.name}: ${d}`;
  });
  return 'Available skills — instruction packs you can load when relevant.\n'
    + 'Only the names and descriptions are shown. To read one in full, call the `skill` tool\n'
    + 'with its name; its instructions then apply to the rest of this run.\n'
    + lines.join('\n');
}

/** Bytes the disclosure adds to every request — the number the budget discipline cares about. */
export const disclosureBytes = (skills) =>
  Buffer.byteLength(renderDisclosure(skills) ?? '', 'utf8');
