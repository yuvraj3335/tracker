import { mcpNotAllowed, mcpOptions, serveMcp } from '@/lib/mcp/http';

export const runtime = 'nodejs';
/** A tool call can search eleven boards or write twenty Notion pages. */
export const maxDuration = 60;

/**
 * The tracker as an MCP server, for any AI tool: Claude Code, Codex, Gemini
 * CLI, Cursor. Authenticated by a personal key in the Authorization header —
 * never by the session cookie, which the proxy lets this route skip.
 */
export async function POST(req: Request) {
  return serveMcp(req);
}

export async function GET() {
  return mcpNotAllowed();
}

export async function DELETE() {
  return mcpNotAllowed();
}

export async function OPTIONS() {
  return mcpOptions();
}
