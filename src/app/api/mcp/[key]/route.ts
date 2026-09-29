import { mcpNotAllowed, mcpOptions, serveMcp } from '@/lib/mcp-http';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The same MCP server with the key in the path, for clients that accept only
 * a URL and cannot send a header — claude.ai and Claude Desktop custom
 * connectors, ChatGPT. See mcp-http.ts for the trade-off.
 */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return serveMcp(req, key);
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
