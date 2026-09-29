#!/usr/bin/env node
/**
 * Prints the Job Hunt connector's config for each AI tool, with this
 * computer's real paths filled in.
 *
 *   npm run connect
 *
 * It only prints — it never edits another tool's settings. Copy what you need,
 * or paste this output to the AI tool itself and ask it to add the entry.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const connector = join(root, 'connector', 'job-hunt.mjs');
const node = (() => {
  try {
    return execFileSync('which', ['node'], { encoding: 'utf8' }).trim() || process.execPath;
  } catch {
    return process.execPath;
  }
})();
const cfg = join(homedir(), '.config', 'job-tracker');
const has = (f) => existsSync(join(cfg, f)) && readFileSync(join(cfg, f), 'utf8').trim().length > 0;

const line = (s = '') => console.log(s);
const block = (title, body) => {
  line(`── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
  line(body.trim());
  line();
};

line();
line(`Connector: ${connector}`);
line(`Key saved:        ${has('key') ? 'yes' : 'NO — create one under Jobs → Connect AI, copy it, then: pbpaste > ~/.config/job-tracker/key && chmod 600 ~/.config/job-tracker/key'}`);
line(`Crawler token:    ${has('crawl4ai-token') ? 'yes' : 'NO — run: npm run crawler:setup'}`);
line();

block('Claude Code (any folder)', `claude mcp add --scope user job-hunt -- ${node} ${connector}`);
block('Codex — ~/.codex/config.toml', `[mcp_servers.job-hunt]\ncommand = "${node}"\nargs = ["${connector}"]\ntool_timeout_sec = 180`);
block('Gemini CLI', `gemini mcp add --scope user job-hunt ${node} ${connector}`);
block('Cursor — ~/.cursor/mcp.json', JSON.stringify({ mcpServers: { 'job-hunt': { command: node, args: [connector] } } }, null, 2));
block(
  'Claude Desktop — Settings → Developer → Edit Config',
  JSON.stringify({ mcpServers: { 'job-hunt': { command: node, args: [connector] } } }, null, 2),
);
line('Then ask any of them: "Find SDE-1 jobs in Bengaluru posted this week."');
line();
