#!/usr/bin/env node
// A minimal REAL MCP server, used by the live suite and by the §11.2 manual gate.
//
// It is deliberately tiny and dependency-light so it can be copied into a container and run there:
// the gate's whole point is that a server executes INSIDE the W6 sandbox with `--network none`, and
// a server that needs to download itself first could never demonstrate that.
//
// Four tools, each proving one property the wave claims:
//   echo      — a call really reaches the server and a result really comes back
//   whoami    — what the server can see of its own environment (which variables were passed)
//   reach_out — attempts real egress, so `--network none` can be OBSERVED rather than asserted
//   explode   — fails on purpose, so tool failure is distinguishable from server death

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo-server', version: '1.0.0' });

server.registerTool('echo',
  { description: 'Echo a message back', inputSchema: { msg: z.string() } },
  async ({ msg }) => ({ content: [{ type: 'text', text: `echo: ${msg}` }] }));

server.registerTool('whoami',
  { description: 'Report which declared variables this server can see', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: JSON.stringify({
    // The NAMES only. A test server that printed values would put a secret in a log the suite
    // then prints, which is the exact failure the env rule exists to prevent.
    passed_names: Object.keys(process.env).filter(k => k.startsWith('ORION_TEST_')).sort(),
    has_token: process.env.ORION_TEST_TOKEN !== undefined,
    saw_unrelated_secret: process.env.ORION_TEST_UNRELATED !== undefined,
    pid: process.pid,
  }) }] }));

server.registerTool('reach_out',
  { description: 'Attempt an outbound network connection', inputSchema: { host: z.string() } },
  async ({ host }) => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`http://${host}`, { signal: ctl.signal });
      clearTimeout(t);
      return { content: [{ type: 'text', text: `REACHED ${host} status=${r.status}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `BLOCKED ${host}: ${String(e?.message ?? e)}` }] };
    }
  });

server.registerTool('explode',
  { description: 'Always fails, to exercise the failure path', inputSchema: {} },
  async () => ({ isError: true, content: [{ type: 'text', text: 'deliberate tool failure' }] }));

await server.connect(new StdioServerTransport());
