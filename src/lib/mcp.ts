/**
 * A small Model Context Protocol server: JSON-RPC in, JSON-RPC out.
 *
 * This is what lets any AI tool use the tracker — Claude Code, Claude Desktop,
 * Codex, Gemini CLI, Cursor — because they all speak MCP. It implements the
 * Streamable HTTP transport in its simplest legal form: stateless, every POST
 * answered with a plain JSON body, no server-sent events and no session id.
 * Nothing here needs a stream (no progress, no server-initiated messages), and
 * statelessness is what a serverless function wants anyway.
 *
 * Pure on purpose: the route handler owns HTTP and auth, and this owns the
 * protocol, so the protocol can be tested without a server.
 */

/** Newest first. The first one is what a client that asks for something else gets. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

export type TextContent = { type: 'text'; text: string };
export type ToolResult = { content: TextContent[]; isError?: boolean };

export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolDef<C> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  run: (args: Record<string, unknown>, ctx: C) => Promise<ToolResult>;
};

export type PromptDef = {
  name: string;
  title: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  render: (args: Record<string, string>) => string;
};

export type ServerDef<C> = {
  name: string;
  title: string;
  version: string;
  instructions: string;
  tools: readonly ToolDef<C>[];
  prompts: readonly PromptDef[];
};

/** An error whose message is written for the person, safe to show as-is. */
export class ToolError extends Error {}

type Id = string | number | null;
type RpcError = { code: number; message: string; data?: unknown };
type RpcResponse = { jsonrpc: '2.0'; id: Id; result?: unknown; error?: RpcError };

export const RPC = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

export const rpcError = (id: Id, code: number, message: string): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

/** A tool's answer: data as pretty JSON, which every client can show and every model can read. */
export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

/** A tool-level failure. Returned as a result, not a protocol error, so the model sees it and can react. */
export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** The version to answer with: the client's own if we speak it, otherwise our newest. */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' && (PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : PROTOCOL_VERSIONS[0];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const validId = (v: unknown): v is string | number =>
  typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

/**
 * Handles one JSON-RPC message. Returns null for notifications and for
 * responses from the client, which get no reply.
 */
export async function handleMessage<C>(server: ServerDef<C>, msg: unknown, ctx: C): Promise<RpcResponse | null> {
  if (!isObject(msg) || msg.jsonrpc !== '2.0') {
    return rpcError(isObject(msg) && validId(msg.id) ? msg.id : null, RPC.INVALID_REQUEST, 'Invalid request');
  }
  // A response to something we never asked — we send no requests — or a
  // notification such as notifications/initialized. Neither gets a reply.
  if (!('method' in msg)) return null;
  if (typeof msg.method !== 'string') {
    return rpcError(validId(msg.id) ? msg.id : null, RPC.INVALID_REQUEST, 'Invalid request');
  }
  if (!('id' in msg)) return null;
  if (!validId(msg.id)) return rpcError(null, RPC.INVALID_REQUEST, 'Invalid request id');

  const id = msg.id;
  const params = isObject(msg.params) ? msg.params : {};
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result });

  switch (msg.method) {
    case 'initialize':
      return ok({
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: server.name, title: server.title, version: server.version },
        instructions: server.instructions,
      });

    case 'ping':
      return ok({});

    case 'tools/list':
      return ok({
        tools: server.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.annotations ? { annotations: { title: t.title, ...t.annotations } } : {}),
        })),
      });

    case 'tools/call': {
      const tool = server.tools.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, RPC.INVALID_PARAMS, `Unknown tool: ${String(params.name)}`);
      const args = params.arguments === undefined ? {} : params.arguments;
      if (!isObject(args)) return rpcError(id, RPC.INVALID_PARAMS, 'Tool arguments must be an object');
      try {
        return ok(await tool.run(args, ctx));
      } catch (e) {
        // Only messages written for people reach the model. Anything else is
        // ours to diagnose, and is logged where it is useful.
        if (e instanceof ToolError) return ok(errorResult(e.message));
        console.error(`[mcp] ${tool.name} failed:`, (e as Error)?.message ?? e);
        return ok(errorResult('That did not work. Try again in a moment.'));
      }
    }

    case 'prompts/list':
      return ok({
        prompts: server.prompts.map((p) => ({
          name: p.name,
          title: p.title,
          description: p.description,
          ...(p.arguments ? { arguments: p.arguments } : {}),
        })),
      });

    case 'prompts/get': {
      const prompt = server.prompts.find((p) => p.name === params.name);
      if (!prompt) return rpcError(id, RPC.INVALID_PARAMS, `Unknown prompt: ${String(params.name)}`);
      const raw = isObject(params.arguments) ? params.arguments : {};
      const args = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? '')]));
      return ok({
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.render(args) } }],
      });
    }

    // Not offered, but answered with empty lists rather than errors: some
    // clients ask regardless of the capabilities, and an error there reads as
    // the whole server being broken.
    case 'resources/list':
      return ok({ resources: [] });
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] });
    case 'logging/setLevel':
      return ok({});

    default:
      return rpcError(id, RPC.METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

/**
 * Handles a whole POST body: one message, or a batch (allowed by the
 * 2025-03-26 revision and still sent by some clients). An empty reply means
 * the body held only notifications, which HTTP answers with 202.
 */
export async function handleBody<C>(
  server: ServerDef<C>,
  body: unknown,
  ctx: C,
): Promise<{ status: 200; json: unknown } | { status: 202 } | { status: 400; json: unknown }> {
  if (Array.isArray(body)) {
    if (!body.length) return { status: 400, json: rpcError(null, RPC.INVALID_REQUEST, 'Empty batch') };
    const out: RpcResponse[] = [];
    for (const m of body) {
      const r = await handleMessage(server, m, ctx);
      if (r) out.push(r);
    }
    return out.length ? { status: 200, json: out } : { status: 202 };
  }
  const r = await handleMessage(server, body, ctx);
  return r ? { status: 200, json: r } : { status: 202 };
}
