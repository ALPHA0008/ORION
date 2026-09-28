#!/usr/bin/env node
// ORION team — SessionStart hook. Injects the program position so every new session (and every
// session after a context compaction) starts from STATE.md rather than from memory. This project
// spans many chats and two machines; the repository is the only continuity it has.

import fs from 'node:fs';
import path from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const statePath = path.join(root, '.claude', 'orion', 'STATE.md');

let state;
try {
  state = fs.readFileSync(statePath, 'utf8');
} catch {
  process.stdout.write('ORION team: .claude/orion/STATE.md not found — run /orion-handoff to create it.\n');
  process.exit(0);
}

const MAX_CHARS = 4000;
const body = state.length > MAX_CHARS ? state.slice(0, MAX_CHARS) + '\n…(truncated — read the full file)\n' : state;
process.stdout.write(
  'ORION team is active. You are the orchestrator (CLAUDE.md). Current program state:\n\n' +
  body +
  '\nRead .claude/orion/PIPELINE.md before routing work. Entry point: /orion\n',
);
