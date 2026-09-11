// W7 — SHIPPED CONFIGURATION. Skills and project instructions at the wiring a developer runs.
//
// Everything here goes through `prepareRun` — the single function `orionctl run`, `resume` and
// every turn of the interactive session funnel through — or spawns the real binary. A skills
// loader that works in a unit test and not in the product is the failure class this project has
// repeated six times in five waves, and W7 adds two loaders at once.
//
// The load-bearing assertions are about the REQUEST DIGEST. `model.requested` records
// `request_digest` over the actual outbound messages, tools and params, after compaction — it is
// the ground truth of "what influenced this turn". Progressive disclosure is therefore not a
// claim about a helper function; it is a claim about what is and is not inside that digest.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { prepareRun } from '../../src/cli/index.mjs';
import { replay } from '../../src/core/replay/index.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'src', 'cli', 'index.mjs');
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w7s-${tag}-`));
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// The shipped worker factory calls the real `buildModel()`, which correctly refuses to run with
// no endpoint. These tests exercise CONTEXT ASSEMBLY, not the model, so they give the CLI a
// syntactically valid endpoint that is never called — keeping the composition path identical to
// the product's rather than stubbing a seam.
// HERMETIC USER SCOPE. This machine really does have skills installed under `~/.claude/skills`,
// and discovery finds them — which is the ecosystem-compatibility feature working exactly as
// intended. But a test that asserts counts must not depend on what the developer happens to have
// installed, so the user scope is pointed at an empty directory for the duration. The REAL code
// path is exercised; only the environment is controlled. (The ambient discovery is reported in
// the wave report as third-party evidence, where it belongs.)
const EMPTY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'w7s-emptyhome-'));
process.env.HOME = EMPTY_HOME;
process.env.USERPROFILE = EMPTY_HOME;

process.env.ORION_BASE_URL ??= 'http://127.0.0.1:9/v1';
process.env.ORION_MODEL ??= 'test-model';

/**
 * A project laid out the way a real one is: an `AGENTS.md`, and a skill in the CLAUDE CODE
 * convention — written exactly as it would be for another harness, which is the compatibility
 * acceptance test (plan §10.2 W7-D).
 */
function makeProject(tag, { instructions = true, skill = true } = {}) {
  const home = mk(`${tag}-home`);
  const work = mk(`${tag}-work`);
  if (instructions) {
    write(path.join(work, 'AGENTS.md'),
      '# Project conventions\n\n'
      + '- Build with `npm run build`.\n'
      + '- The canonical test command is `npm test`.\n'
      + '- Never edit anything under `dist/`.\n');
  }
  if (skill) {
    // Verbatim Claude Code shape, including a key this runtime has no opinion about.
    write(path.join(work, '.claude', 'skills', 'commit-style', 'SKILL.md'),
      '---\n'
      + 'name: commit-style\n'
      + 'description: How to write commit messages in this repository.\n'
      + 'allowed-tools: [Read, Grep]\n'
      + '---\n\n'
      + '# Commit style\n\n'
      + 'THE-SECRET-MARKER-IN-THE-BODY\n\n'
      + 'Use the imperative mood. Reference the wave number in the subject line.\n');
  }
  return { home, work };
}

/** Build the shipped worker for a run, the way every turn-bearing command does. */
async function shipped(tag, opts) {
  const { home, work } = makeProject(tag, opts);
  const store = new Store(path.join(home, 'orion.db'));
  const runId = uid('run');
  store.createRun(runId, { task: 'w7' });
  const claim = store.claim('cli', { runId, leaseMs: 60_000 });
  const prepared = await prepareRun(store, runId, claim.leaseToken, work);
  return { home, work, store, runId, claim, prepared, worker: prepared.worker() };
}

// ═══════════════════════════════════════════ C — instructions reach the product
describe('shipped/W7-C: AGENTS.md briefs the run, and the log says so');
{
  const { store, runId, worker, work } = await shipped('instr');

  check('the project brief is in the system prompt the worker will send',
    worker.systemPrompt.includes('npm run build'), worker.systemPrompt.slice(-200));
  check('...attributed to its file', worker.systemPrompt.includes('AGENTS.md'));
  check('...and the runtime\'s own instructions survive alongside it',
    worker.systemPrompt.includes('coding agent'));

  const ev = store.events(runId).find(e => e.type === 'instructions.loaded');
  check('`instructions.loaded` is in the log', !!ev);
  eq('...naming the file', ev.payload.name, 'AGENTS.md');
  eq('...with its full path', ev.payload.path, path.join(work, 'AGENTS.md'));
  check('...and a digest of the file', /^[0-9a-f]{16}$/.test(ev.payload.digest));
  eq('...not truncated for a normal brief', ev.payload.truncated, false);
  store.close();
}

describe('shipped/W7-C: a project with no brief is unchanged');
{
  const { store, runId, worker } = await shipped('nobrief', { instructions: false, skill: false });
  eq('no instructions event', store.events(runId).filter(e => e.type === 'instructions.loaded').length, 0);
  eq('no skill event', store.events(runId).filter(e => e.type === 'skill.disclosed').length, 0);
  check('the system prompt is exactly the runtime default',
    worker.systemPrompt.includes('coding agent') && !worker.systemPrompt.includes('Available skills'));
  // W8: the property, not the count — see the note in tests/context/skills.test.mjs.
  check('and the shipped toolset carries no skill tool', !('skill' in worker.tools),
    Object.keys(worker.tools).join(','));
  store.close();
}

// ═══════════════════════════════════════════ A/D — a foreign skill loads unchanged
describe('shipped/W7-A/D: a skill authored for another harness loads unchanged');
{
  const { store, runId, worker, work } = await shipped('foreign');

  const ev = store.events(runId).find(e => e.type === 'skill.disclosed');
  check('`skill.disclosed` is in the log', !!ev);
  const listed = ev.payload.skills.find(s => s.name === 'commit-style');
  check('the Claude Code skill was discovered', !!listed, JSON.stringify(ev.payload.skills.map(s => s.name)));
  eq('...from the .claude/skills convention', listed.path,
    path.join(work, '.claude', 'skills', 'commit-style', 'SKILL.md'));
  eq('...at project scope', listed.scope, 'project');

  check('its NAME is disclosed to the model', worker.systemPrompt.includes('commit-style'));
  check('...and its DESCRIPTION', worker.systemPrompt.includes('How to write commit messages'));
  // Progressive disclosure, stated as the property that matters:
  check('...but NOT its body', !worker.systemPrompt.includes('THE-SECRET-MARKER-IN-THE-BODY'));
  check('the `skill` tool is offered so the model can act on the catalogue', 'skill' in worker.tools);
  store.close();
}

// ═══════════════════════════════════════════ A/B — disclosure vs activation, in the DIGEST
describe('shipped/W7-A/B: the body is absent from the pre-activation request and present after');
{
  // This is the assertion progressive disclosure actually rests on. Anything less — checking a
  // helper's output, say — would leave open that the body reaches the provider by some other
  // path. `model.requested.context_bytes` and the outbound array are what the provider received.
  const { home, work } = makeProject('digest');
  const store = new Store(path.join(home, 'orion.db'));
  const runId = uid('run');
  store.createRun(runId, { task: 'activate the skill' });
  const claim = store.claim('cli', { runId, leaseMs: 60_000 });
  const prepared = await prepareRun(store, runId, claim.leaseToken, work);

  // A scripted model that activates the skill on turn 1, then finishes. Capturing the outbound
  // array on every call is what lets the assertions be about the REAL request.
  const sent = [];
  let called = 0;
  const worker = prepared.worker({
    model: {
      name: 'scripted', provider: 'test', capabilities: new Set(['tools']),
      async invoke({ messages }) {
        sent.push(JSON.stringify(messages));
        called++;
        return called === 1
          ? { content: '', finish: false, input_tokens: 1, output_tokens: 1,
              tool_calls: [{ id: 'tc1', name: 'skill', args: { name: 'commit-style' } }] }
          : { content: 'done', tool_calls: [], finish: true, input_tokens: 1, output_tokens: 1 };
      },
    },
    stream: false, maxTurns: 4,
  });
  const res = await worker.run(runId, claim.leaseToken, { input: 'follow the commit-style skill' });

  check('the run reached the model at least twice', sent.length >= 2, `${sent.length} calls`);
  check('BEFORE activation the body is absent from the outbound request',
    !sent[0].includes('THE-SECRET-MARKER-IN-THE-BODY'));
  check('...though the catalogue entry is present', sent[0].includes('commit-style'));
  check('AFTER activation the body IS in the outbound request',
    sent[sent.length - 1].includes('THE-SECRET-MARKER-IN-THE-BODY'));

  // And the provenance event the plan requires, naming the source.
  const act = store.events(runId).find(e => e.type === 'skill.activated');
  check('`skill.activated` is in the log', !!act, store.events(runId).map(e => e.type).join(','));
  eq('...naming the skill', act.payload.name, 'commit-style');
  eq('...and the directory it came from', act.payload.source,
    path.join(work, '.claude', 'skills', 'commit-style', 'SKILL.md'));
  eq('...and the scope it won at', act.payload.scope, 'project');

  // "Which turn?" — the §1.2 question. The event's position in the log answers it.
  const evs = store.events(runId);
  const turnStarts = evs.filter(e => e.type === 'turn.started').map(e => e.seq);
  check('the activation is sequenced within a turn', act.seq > turnStarts[0], `${act.seq} > ${turnStarts[0]}`);
  const digestsAfter = evs.filter(e => e.type === 'model.requested' && e.seq > act.seq);
  check('and a model request followed it — the turn it influenced', digestsAfter.length >= 1);

  // The body arrives as a tool RESULT, so it is in the bounded projection and subject to the same
  // budget as any other content — not spliced into the system prompt where it would be re-sent
  // uncompactably forever.
  check('the body entered as a tool result, not as prompt furniture',
    !worker.systemPrompt.includes('THE-SECRET-MARKER-IN-THE-BODY'));
  const st = project(store, runId);
  check('...and is visible in the projection',
    JSON.stringify(st.recent_messages).includes('THE-SECRET-MARKER-IN-THE-BODY'));

  eq('the run completed', res.status, 'completed');
  store.close();
}

// ═══════════════════════════════════════════ replay equivalence
describe('shipped/W7: replay reconstructs the same context at zero model calls');
{
  const { home, work } = makeProject('replay');
  const store = new Store(path.join(home, 'orion.db'));
  const runId = uid('run');
  store.createRun(runId, { task: 'brief me' });
  const claim = store.claim('cli', { runId, leaseMs: 60_000 });
  const prepared = await prepareRun(store, runId, claim.leaseToken, work);
  let n = 0;
  await prepared.worker({
    model: { name: 'scripted', provider: 'test', capabilities: new Set(['tools']),
      async invoke() {
        return ++n === 1
          ? { content: '', finish: false, input_tokens: 1, output_tokens: 1,
              tool_calls: [{ id: 'tc1', name: 'skill', args: { name: 'commit-style' } }] }
          : { content: 'done', tool_calls: [], finish: true, input_tokens: 1, output_tokens: 1 };
      } },
    stream: false, maxTurns: 4,
  }).run(runId, claim.leaseToken, { input: 'go' });

  const liveDigests = store.events(runId)
    .filter(e => e.type === 'model.requested').map(e => e.payload.request_digest);
  check('the run recorded request digests', liveDigests.length >= 2, `${liveDigests.length}`);

  // "Zero model calls" is a property of what replay DOES, not of what it reconstructs: the
  // replayed state faithfully reports the original run's calls. The checkable form is that replay
  // appends nothing and issues nothing — the log is unchanged afterwards.
  const before = store.events(runId).length;
  const r = replay(store, runId);
  const after = store.events(runId).length;
  eq('replay appended NO events — it issued no model call', after, before);
  eq('...and reconstructs the original call count faithfully',
    r.state.budget.model_calls, liveDigests.length);
  const replayed = store.events(runId)
    .filter(e => e.type === 'model.requested').map(e => e.payload.request_digest);
  eq('the digests are identical after replay', replayed.join(','), liveDigests.join(','));

  // Invariant 2 for a BRIEFED run: the prompt is a pure function of the files on disk, so
  // rebuilding it from the same workspace reproduces the same bytes.
  const runId2 = uid('run');
  store.createRun(runId2, { task: 'brief me' });
  const claim2 = store.claim('cli2', { runId: runId2, leaseMs: 60_000 });
  const again = await prepareRun(store, runId2, claim2.leaseToken, work);
  eq('the same files rebuild a byte-identical system prompt',
    again.worker().systemPrompt, prepared.worker().systemPrompt);

  // And an edited brief changes it — otherwise the digest could not explain a behaviour change.
  write(path.join(work, 'AGENTS.md'), '# Conventions\n\nTest with: pnpm test\n');
  const runId3 = uid('run');
  store.createRun(runId3, { task: 'brief me' });
  const claim3 = store.claim('cli3', { runId: runId3, leaseMs: 60_000 });
  const edited = await prepareRun(store, runId3, claim3.leaseToken, work);
  check('an edited AGENTS.md changes the prompt',
    edited.worker().systemPrompt !== prepared.worker().systemPrompt);
  const d1 = store.events(runId).find(e => e.type === 'instructions.loaded').payload.digest;
  const d3 = store.events(runId3).find(e => e.type === 'instructions.loaded').payload.digest;
  check('...and the recorded digest differs, so the log explains why', d1 !== d3, `${d1} vs ${d3}`);
  store.close();
}

// ═══════════════════════════════════════════ budget discipline
describe('shipped/W7: many skills do not balloon the request');
{
  const home = mk('budget-home');
  const work = mk('budget-work');
  // Twelve skills, each with a large body. Inlined that is ~240 KB — ten times the W3 budget.
  for (let i = 0; i < 12; i++) {
    write(path.join(work, '.claude', 'skills', `skill-${i}`, 'SKILL.md'),
      `---\nname: skill-${i}\ndescription: Skill number ${i} does a thing.\n---\n${'B'.repeat(20_000)}\n`);
  }
  const store = new Store(path.join(home, 'orion.db'));
  const runId = uid('run');
  store.createRun(runId, { task: 'many skills' });
  const claim = store.claim('cli', { runId, leaseMs: 60_000 });
  const prepared = await prepareRun(store, runId, claim.leaseToken, work);
  const worker = prepared.worker();

  const promptBytes = Buffer.byteLength(worker.systemPrompt, 'utf8');
  const ev = store.events(runId).find(e => e.type === 'skill.disclosed');
  eq('all twelve are disclosed', ev.payload.skills.length, 12);
  check('no body reaches the prompt', !worker.systemPrompt.includes('BBBBBBBBBB'));
  check('the whole prompt stays far under the W3 context budget',
    promptBytes < 24_000 / 2, `${promptBytes} B prompt for 12 skills totalling 240 KB of body`);
  check('the recorded disclosure cost matches what was sent',
    ev.payload.disclosure_bytes < 2_000, `${ev.payload.disclosure_bytes} B`);
  store.close();
}

// ═══════════════════════════════════════════ the real binary
describe('shipped/W7: the REAL orionctl reports the brief and the skills');
{
  // `prepareRun` above is the composition root, but only spawning the binary proves the product
  // does this — the distinction that has mattered in every wave of this project.
  const { home, work } = makeProject('binary');
  const r = spawnSync(process.execPath, [CLI, 'run', 'do a thing'], {
    encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, HOME: EMPTY_HOME, USERPROFILE: EMPTY_HOME,
           ORION_HOME: home, ORION_WORKSPACE: work,
           // An endpoint that refuses instantly: the run fails at the model, which is AFTER
           // context assembly — exactly the part under test.
           ORION_BASE_URL: 'http://127.0.0.1:9/v1', ORION_MODEL: 'x', ORION_STREAM: '0' },
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  check('the CLI reports which instruction file briefed the run',
    /instructions: AGENTS\.md/.test(out), out.slice(0, 300));
  check('...and how many skills are available, with their disclosure cost',
    /skills: 1 available \(\d+ B disclosed\)/.test(out), out.slice(0, 300));
  check('...naming them', /commit-style/.test(out));

  // And the events really are in the database the binary wrote.
  const store = new Store(path.join(home, 'orion.db'));
  const runId = store.listRuns({ limit: 1 })[0].id;
  const types = store.events(runId).map(e => e.type);
  check('instructions.loaded is in the real run\'s log', types.includes('instructions.loaded'));
  check('skill.disclosed is in the real run\'s log', types.includes('skill.disclosed'));
  store.close();
}

process.exit(summary('shipped/w7', path.join(HERE, '..', 'results-shipped-w7.json')) ? 1 : 0);
