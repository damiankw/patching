#!/usr/bin/env node
/**
 * MCP server exposing the Rackdocs tools over stdio, so Claude Code, Claude Desktop or any
 * MCP client can read and edit the documentation. It signs in to a running Rackdocs server.
 *
 *   RACKDOCS_URL=http://localhost:3000 RACKDOCS_EMAIL=you@example.com RACKDOCS_PASSWORD=... node dist/server/mcp.js
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { defineTools } from './ai/tools.js';

const url = (process.env.RACKDOCS_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const email = process.env.RACKDOCS_EMAIL; const password = process.env.RACKDOCS_PASSWORD;
if (!email || !password) { console.error('Set RACKDOCS_EMAIL and RACKDOCS_PASSWORD (a Rackdocs user with the editor role).'); process.exit(1); }

async function login(): Promise<string> {
  const r = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`Rackdocs login failed (${r.status}): ${await r.text()}`);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie) throw new Error('Rackdocs login returned no session cookie');
  return cookie;
}

const cookie = await login();
const server = new McpServer({ name: 'rackdocs', version: '2.0.0' });
for (const t of defineTools({ cookie, baseUrl: url, emit: () => {} })) {
  server.registerTool(t.name, { description: t.description, inputSchema: t.schema.shape }, async (args: unknown) => {
    const text = await t.run(args ?? {});
    return { content: [{ type: 'text', text }], isError: text.startsWith('ERROR:') };
  });
}
await server.connect(new StdioServerTransport());
console.error(`rackdocs MCP server connected to ${url} as ${email} with ${defineTools({ cookie, baseUrl: url, emit: () => {} }).length} tools`);
