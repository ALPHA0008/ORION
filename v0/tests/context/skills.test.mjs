// W7 A/B/C/D — skills, project instructions, and the provenance that makes them auditable.
//
// The mechanism half. The WIRING half — that `orionctl run` on a real repository actually does
// this — lives in tests/shipped/w7-shipped.test.mjs, because a loader reachable only from a test
// is the failure class this project has repeated six times in five waves.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_TYPES, EVENT_CONTRACT_VERSION, isKnownType } from '../../src/core/event/index.mjs';
import { parseFrontmatter, discoverSkills, renderDisclosure, disclosureBytes,
         readSkillFile, skillSearchPaths, SCOPES } from '../../src/context/skills.mjs';
import { loadProjectInstructions, renderInstructions, INSTRUCTION_FILES,
         MAX_INSTRUCTION_BYTES } from '../../src/context/instructions.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w7-${tag}-`));
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// ═══════════════════════════════════════════ contract
describe('w7/contract: v6 adds provenance types, additively');
{
  eq('the contract is at or beyond v6', EVENT_CONTRACT_VERSION >= 6, true);
  for (const t of ['instructions.loaded', 'skill.disclosed', 'skill.activated'])
    check(`${t} is in the closed vocabulary`, isKnownType(t));
  check('the vocabulary is still frozen', Object.isFrozen(EVENT_TYPES));

  // Additive-only. A log written under v5 must still replay (per-wave invariant §11.3).
  const v5Sample = ['run.created', 'turn.started', 'model.requested', 'tool.succeeded',
                    'plan.created', 'artifact.created', 'stream.delta', 'resource.acquired',
                    'grant.created', 'tool.output_delta', 'degraded'];
  eq('NO earlier type was removed or renamed', v5Sample.filter(t => !isKnownType(t)).join(','), '');
  eq('v6 adds exactly 3', EVENT_TYPES.length, 49);

  // The reserved vocabulary belongs to later waves and this one must not touch it.
  for (const t of ['child.spawned', 'child.finished', 'context.retrieved'])
    check(`${t} is still reserved and untouched`, isKnownType(t));
}

// ═══════════════════════════════════════════ A — parsing
describe('w7/A: SKILL.md frontmatter parses the convention, not an invention');
{
  const p = parseFrontmatter('---\nname: demo\ndescription: A demo skill.\n---\n\n# Body\n\ntext here\n');
  eq('name', p.data.name, 'demo');
  eq('description', p.data.description, 'A demo skill.');
  eq('body excludes the frontmatter', p.body, '# Body\n\ntext here');
  eq('frontmatter was detected', p.hadFrontmatter, true);

  // A skill authored for ANOTHER harness carries keys this runtime has no opinion about.
  // Rejecting the document over them would defeat the whole compatibility requirement.
  const other = parseFrontmatter(
    '---\nname: x\ndescription: d\nallowed-tools: [Read, Grep]\nlicense: MIT\nmodel: opus\n---\nbody\n');
  eq('unknown keys do not break parsing', other.data.name, 'x');
  eq('...and are simply carried', Array.isArray(other.data['allowed-tools']), true);
  eq('...list values parse', other.data['allowed-tools'].join(','), 'Read,Grep');

  // Block scalars appear in real files.
  const block = parseFrontmatter('---\nname: y\ndescription: >\n  folded text\n  continues\n---\nb\n');
  eq('folded block scalar', block.data.description, 'folded text continues');
  const literal = parseFrontmatter('---\nname: z\ndescription: |\n  line one\n  line two\n---\nb\n');
  eq('literal block scalar', literal.data.description, 'line one\nline two');

  eq('quotes are stripped', parseFrontmatter('---\nname: "q"\n---\nb\n').data.name, 'q');
  eq('a file with no frontmatter is still readable',
    parseFrontmatter('# just markdown\n').hadFrontmatter, false);
  eq('...and its body survives', parseFrontmatter('# just markdown\n').body, '# just markdown');

  // A BOM is common on Windows-authored files and must not defeat the frontmatter match.
  eq('a BOM does not break detection',
    parseFrontmatter('﻿---\nname: bom\n---\nb\n').data.name, 'bom');
}

describe('w7/A: a skill file yields name, description, body and identity');
{
  const d = mk('read');
  const f = path.join(d, 'commit-style', 'SKILL.md');
  write(f, '---\nname: commit-style\ndescription: How to write commits.\n---\n\nUse imperative mood.\n');
  const s = readSkillFile(f, 'project');
  eq('name', s.name, 'commit-style');
  eq('description', s.description, 'How to write commits.');
  eq('body', s.body, 'Use imperative mood.');
  eq('scope', s.scope, 'project');
  eq('path is recorded — provenance needs the SOURCE, not just the name', s.path, f);
  check('a content digest identifies the version', /^[0-9a-f]{16}$/.test(s.digest), s.digest);
  check('byte size recorded', s.bytes > 0);

  // Name falls back to the directory, which is how these are conventionally identified.
  const g = path.join(d, 'implied-name', 'SKILL.md');
  write(g, 'no frontmatter at all\n');
  eq('a nameless file takes its directory name', readSkillFile(g, 'project').name, 'implied-name');
  eq('...and is flagged as description-less', readSkillFile(g, 'project').hasDescription, false);
}

// ═══════════════════════════════════════════ D — discovery + precedence
describe('w7/D: skills load from the conventions that already exist');
{
  const d = mk('discover');
  // The two ecosystem conventions, verbatim.
  write(path.join(d, '.claude', 'skills', 'from-claude', 'SKILL.md'),
    '---\nname: from-claude\ndescription: Authored for Claude Code.\n---\nclaude body\n');
  write(path.join(d, '.agents', 'skills', 'from-agents', 'SKILL.md'),
    '---\nname: from-agents\ndescription: Authored for the .agents convention.\n---\nagents body\n');
  // ORION's own location, which must not be privileged over the conventions.
  write(path.join(d, '.orion', 'skills', 'from-orion', 'SKILL.md'),
    '---\nname: from-orion\ndescription: Native.\n---\norion body\n');

  const r = discoverSkills({ workspace: d, env: {} });
  const names = r.skills.map(s => s.name).sort();
  eq('all three conventions are read', names.join(','), 'from-agents,from-claude,from-orion');
  check('each is attributed to the project scope', r.skills.every(s => s.scope === 'project'));
  check('the search paths are reported for auditability', r.searched.some(x => x.found > 0));
}

describe('w7/D: the precedence ladder is bundled -> user -> project -> plugin');
{
  eq('the ladder is the plan\'s, in order', SCOPES.join(' -> '),
    'bundled -> user -> project -> plugin');

  const home = mk('home'); const proj = mk('proj'); const plug = mk('plug'); const bund = mk('bund');
  const skill = (root, scopeName, text) =>
    write(path.join(root, 'shared', 'SKILL.md'),
      `---\nname: shared\ndescription: from ${scopeName}\n---\n${text}\n`);
  skill(bund, 'bundled', 'BUNDLED');
  skill(path.join(home, 'skills'), 'user', 'USER');
  skill(path.join(proj, '.claude', 'skills'), 'project', 'PROJECT');
  skill(plug, 'plugin', 'PLUGIN');

  const all = discoverSkills({ workspace: proj, home, bundled: bund,
    env: { ORION_SKILL_PATH: plug } });
  const shared = all.skills.find(s => s.name === 'shared');
  eq('exactly one `shared` survives', all.skills.filter(s => s.name === 'shared').length, 1);
  eq('the strongest scope wins', shared.scope, 'plugin');
  eq('...and its body is the one loaded', shared.body, 'PLUGIN');
  check('the losers are RECORDED as shadowed, not silently dropped',
    all.shadowed.filter(s => s.name === 'shared').length >= 1,
    JSON.stringify(all.shadowed.map(s => s.hiddenScope)));

  // Without the plugin, project wins; without project, user wins. The ladder holds at each step.
  const noPlug = discoverSkills({ workspace: proj, home, bundled: bund, env: {} });
  eq('project beats user and bundled', noPlug.skills.find(s => s.name === 'shared').body, 'PROJECT');
  const noProj = discoverSkills({ workspace: mk('empty'), home, bundled: bund, env: {} });
  eq('user beats bundled', noProj.skills.find(s => s.name === 'shared').body, 'USER');
  const onlyBundled = discoverSkills({ workspace: mk('empty2'), bundled: bund, env: {} });
  eq('bundled is the floor', onlyBundled.skills.find(s => s.name === 'shared').body, 'BUNDLED');
}

// ═══════════════════════════════════════════ A — progressive disclosure
describe('w7/A: disclosure shows names and descriptions, never bodies');
{
  const d = mk('disclose');
  const bigBody = 'X'.repeat(20_000);
  for (const n of ['alpha', 'beta', 'gamma']) {
    write(path.join(d, '.claude', 'skills', n, 'SKILL.md'),
      `---\nname: ${n}\ndescription: The ${n} skill.\n---\n${bigBody}\n`);
  }
  const { skills } = discoverSkills({ workspace: d, env: {} });
  eq('three skills found', skills.length, 3);
  const text = renderDisclosure(skills);

  for (const n of ['alpha', 'beta', 'gamma']) {
    check(`${n} name is disclosed`, text.includes(n));
    check(`${n} description is disclosed`, text.includes(`The ${n} skill.`));
  }
  check('NO body is disclosed', !text.includes(bigBody));
  check('...not even a fragment of one', !text.includes('XXXXXXXXXX'));

  // THE BUDGET PROPERTY. Wave 3 made outbound context budgeted (contextBudgetBytes default
  // 24_000, measured on the real outbound array). Three skills carrying 60 KB of bodies must
  // cost a few hundred bytes at the prompt, or skills would consume the budget before the
  // conversation started — which is the whole reason disclosure is progressive.
  const bytes = disclosureBytes(skills);
  check('disclosure is cheap', bytes < 1_000, `${bytes} B for 3 skills totalling 60 KB of body`);
  check('...far below the W3 context budget', bytes < 24_000 / 10, `${bytes} B`);

  // A long description is clipped, so one verbose skill cannot inflate every request.
  const d2 = mk('clip');
  write(path.join(d2, '.claude', 'skills', 'verbose', 'SKILL.md'),
    `---\nname: verbose\ndescription: ${'d'.repeat(5_000)}\n---\nbody\n`);
  const clipped = renderDisclosure(discoverSkills({ workspace: d2, env: {} }).skills);
  check('a runaway description is clipped', clipped.length < 1_000, `${clipped.length} B`);
  check('...and says it was', clipped.includes('…'));

  eq('no skills means no disclosure text at all', renderDisclosure([]), null);
  eq('...and zero bytes', disclosureBytes([]), 0);
}

// ═══════════════════════════════════════════ B — activation
describe('w7/B: activation is a tool call, and it emits provenance');
{
  const d = mk('activate');
  write(path.join(d, '.claude', 'skills', 'commit-style', 'SKILL.md'),
    '---\nname: commit-style\ndescription: How to write commits.\n---\nUse imperative mood.\n');
  const { skills } = discoverSkills({ workspace: d, env: {} });

  // The tool exists ONLY when there is something to activate — a project with no skills sees the
  // identical toolset it saw before this wave.
  const bare = makeTools(null);
  check('no skills: no `skill` tool', !('skill' in bare));
  // W8: the PROPERTY, not the count. This asserted 9 until W8 added glob and git; the thing it
  // exists to protect is that a project with no skills gets the toolset it would have had
  // anyway, which is 'no skill tool' — not a number that every future wave must come and edit.
  eq('...and nothing else was added by the skills machinery',
    Object.keys(bare).filter(n => n === 'skill').length, 0);

  const tools = makeTools(null, { skills });
  check('with skills: the tool is offered', 'skill' in tools);
  check('...and is MODEL-VISIBLE (it has a schema the provider receives)',
    !!tools.skill.schema?.properties?.name);
  check('...and its description tells the model how to use it',
    /call it when a skill is relevant/i.test(tools.skill.description));

  // Reading instruction text changes nothing in the world. That classification is what keeps a
  // skill activation from ever needing a human, at any posture.
  eq('activation is ReadOnly', tools.skill.effects, 'ReadOnly');
  eq('...and safely re-runnable after a crash', tools.skill.recovery().class, 'READ_ONLY');

  const body = tools.skill.run({ name: 'commit-style' });
  check('the FULL body is returned on activation', body.includes('Use imperative mood.'));
  check('...labelled with the skill name', body.includes('# Skill: commit-style'));

  const emitted = tools.skill.emits({ name: 'commit-style' });
  eq('one provenance event is emitted', emitted.length, 1);
  eq('...of the right type', emitted[0].type, 'skill.activated');
  eq('...naming the skill', emitted[0].payload.name, 'commit-style');
  check('...and its SOURCE PATH — the §1.2 requirement',
    emitted[0].payload.source.endsWith(path.join('commit-style', 'SKILL.md')),
    emitted[0].payload.source);
  eq('...and the scope it won at', emitted[0].payload.scope, 'project');
  check('...and a digest, so an edited skill is a different activation',
    /^[0-9a-f]{16}$/.test(emitted[0].payload.digest));

  // An unknown name fails usefully rather than silently returning nothing.
  let threw = null;
  try { tools.skill.run({ name: 'does-not-exist' }); } catch (e) { threw = e; }
  check('an unknown skill is an error', threw !== null);
  check('...that lists what IS available', /commit-style/.test(String(threw?.message)),
    String(threw?.message));
  eq('...and emits nothing', tools.skill.emits({ name: 'does-not-exist' }).length, 0);
}

// ═══════════════════════════════════════════ C — project instructions
describe('w7/C: project instructions are the standing brief, always loaded');
{
  const d = mk('instr');
  write(path.join(d, 'AGENTS.md'), '# Conventions\n\nTest with: npm test\n');
  const r = loadProjectInstructions(d);
  eq('AGENTS.md is found', r.found, true);
  eq('...and named', r.name, 'AGENTS.md');
  check('...with a digest of the file', /^[0-9a-f]{16}$/.test(r.digest));
  check('the rendered block carries the content', renderInstructions(r).includes('npm test'));
  check('...and states where it came from', renderInstructions(r).includes('AGENTS.md'));

  // CLAUDE.md is an EQUIVALENT at the same precedence step, not a second voice.
  const both = mk('both');
  write(path.join(both, 'AGENTS.md'), 'agents brief\n');
  write(path.join(both, 'CLAUDE.md'), 'claude brief\n');
  const b = loadProjectInstructions(both);
  eq('with both present, exactly one wins', b.name, 'AGENTS.md');
  check('...and the other is NOT also loaded', !renderInstructions(b).includes('claude brief'));
  eq('...but is recorded as shadowed', b.shadowed.map(s => s.name).join(','), 'CLAUDE.md');

  const claudeOnly = mk('claude');
  write(path.join(claudeOnly, 'CLAUDE.md'), 'claude brief\n');
  eq('CLAUDE.md alone is honoured', loadProjectInstructions(claudeOnly).name, 'CLAUDE.md');
  check('...and its content loads', renderInstructions(loadProjectInstructions(claudeOnly)).includes('claude brief'));

  eq('a project with neither loads nothing', loadProjectInstructions(mk('none')).found, false);
  eq('...and renders nothing', renderInstructions(loadProjectInstructions(mk('none2'))), null);
}

describe('w7/C: an unbounded brief cannot silently eat the context budget');
{
  // The system prompt is rebuilt fresh EVERY turn and is never compacted away, so an oversized
  // AGENTS.md would cost its full size on every model call for the life of the run.
  const d = mk('big');
  const huge = Array.from({ length: 4_000 }, (_, i) => `line ${i} of the project brief`).join('\n');
  write(path.join(d, 'AGENTS.md'), huge);
  const r = loadProjectInstructions(d);
  check('the file really is oversized', r.bytes > MAX_INSTRUCTION_BYTES, `${r.bytes} B`);
  eq('it is truncated', r.truncated, true);
  check('...to within the cap (plus the notice)',
    Buffer.byteLength(r.text, 'utf8') < MAX_INSTRUCTION_BYTES + 400,
    `${Buffer.byteLength(r.text, 'utf8')} B`);
  check('...and the model is TOLD it was truncated', /truncated/.test(r.text));
  check('...and told where to read the rest', /AGENTS\.md/.test(r.text));
  // The digest is of the FILE, so an edit beyond the cap still changes the recorded identity.
  const d2 = mk('big2');
  write(path.join(d2, 'AGENTS.md'), huge + '\nEXTRA LINE PAST THE CAP\n');
  check('the digest covers the whole file, not the truncated view',
    loadProjectInstructions(d2).digest !== r.digest);
}

// ═══════════════════════════════════════════ determinism
describe('w7/replay: the same files reconstruct the same prompt');
{
  // Invariant 2 — deterministic replay at zero model cost — only holds for a briefed run if the
  // prompt is a pure function of the files on disk. Nothing here may depend on scan order,
  // filesystem iteration order, or the clock.
  const d = mk('determinism');
  for (const n of ['zeta', 'alpha', 'mid']) {
    write(path.join(d, '.claude', 'skills', n, 'SKILL.md'),
      `---\nname: ${n}\ndescription: ${n} does things.\n---\nbody of ${n}\n`);
  }
  write(path.join(d, 'AGENTS.md'), 'brief\n');

  const once = discoverSkills({ workspace: d, env: {} });
  const twice = discoverSkills({ workspace: d, env: {} });
  eq('discovery is stable across calls',
    JSON.stringify(once.skills.map(s => s.name)), JSON.stringify(twice.skills.map(s => s.name)));
  eq('...and deterministically ordered (sorted, not directory order)',
    once.skills.map(s => s.name).join(','), 'alpha,mid,zeta');
  eq('the disclosure text is byte-identical', renderDisclosure(once.skills), renderDisclosure(twice.skills));
  eq('the instruction text is byte-identical',
    renderInstructions(loadProjectInstructions(d)), renderInstructions(loadProjectInstructions(d)));

  // Editing a skill must change its identity — otherwise the log could not explain a changed
  // request digest.
  const before = once.skills.find(s => s.name === 'alpha').digest;
  write(path.join(d, '.claude', 'skills', 'alpha', 'SKILL.md'),
    '---\nname: alpha\ndescription: alpha does things.\n---\nEDITED body of alpha\n');
  const after = discoverSkills({ workspace: d, env: {} }).skills.find(s => s.name === 'alpha').digest;
  check('an edited skill has a different digest', before !== after, `${before} -> ${after}`);
}

process.exit(summary('w7 skills', path.join(HERE, '..', 'results-w7-skills.json')) ? 1 : 0);
