/**
 * The HTTP side of the MCP endpoint: authentication, limits and framing.
 *
 * Two ways in, one handler:
 *   POST /api/mcp          with  Authorization: Bearer jt_…
 *   POST /api/mcp/jt_…     for clients that only take a URL (claude.ai and
 *                          Claude Desktop custom connectors, ChatGPT)
 *
 * The second puts the key in the URL, which means it can appear in request
 * logs. It exists because those clients offer no way to send a header; the
 * connect page says so and recommends a separate key for them.
 */
import { bearerKey, looksLikeApiKey } from './api-keys';
import { tenantForApiKey } from './tenant';
import { createRateLimiter, retryAfterSeconds } from './rate-limit';
import { RPC, errorResult, handleBody, rpcError, type ServerDef } from './mcp';
import { JOB_TRACKER_SERVER, type ToolContext } from './job-tools';

/** A message that big is not a tool call; it is a mistake or an attack. */
const MAX_BODY = 1_000_000;

/** Requests per key. A busy agent makes a few a second at most. */
const perKey = createRateLimiter(300, 5 * 60_000);

const BASE_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  // Browser-based MCP inspectors need CORS. Safe to open: every request
  // carries its key explicitly, and no cookie is ever read here.
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'mcp-protocol-version, www-authenticate',
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });

export function mcpOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...BASE_HEADERS,
      'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
      'access-control-max-age': '86400',
    },
  });
}

/**
 * GET would open a server-to-client event stream, which this server never
 * sends; DELETE would end a session, and it keeps none. The transport spec
 * allows answering both with 405.
 */
export function mcpNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { ...BASE_HEADERS, allow: 'POST, OPTIONS' } });
}

/**
 * The same tools, each answering with one message. Used when the key is good
 * but the account cannot be served yet — Notion not connected, say — so the
 * AI tool still connects and can tell the person exactly what to do, rather
 * than failing to connect with nothing to show.
 */
function unavailable(message: string): ServerDef<ToolContext> {
  return {
    ...JOB_TRACKER_SERVER,
    tools: JOB_TRACKER_SERVER.tools.map((t) => ({ ...t, run: async () => errorResult(message) })),
  };
}

export async function serveMcp(req: Request, keyFromPath?: string): Promise<Response> {
  const key = keyFromPath !== undefined ? (looksLikeApiKey(keyFromPath) ? keyFromPath : null) : bearerKey(req.headers.get('authorization'));
  if (!key) {
    return json(
      401,
      rpcError(null, RPC.INVALID_REQUEST, 'Missing or malformed key. Create one in the tracker under Jobs → Connect AI and send it as "Authorization: Bearer jt_…".'),
      { 'www-authenticate': 'Bearer realm="job-tracker"' },
    );
  }

  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, rpcError(null, RPC.INVALID_REQUEST, 'Request too large'));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, rpcError(null, RPC.PARSE, 'Parse error'));
  }

  const who = await tenantForApiKey(key);
  if (!who.ok && who.status === 401) {
    return json(401, rpcError(null, RPC.INVALID_REQUEST, who.message), {
      'www-authenticate': 'Bearer realm="job-tracker", error="invalid_token"',
    });
  }
  if (!who.ok && who.status === 503) return json(503, rpcError(null, RPC.INTERNAL, who.message), { 'retry-after': '30' });

  const limitKey = who.ok ? who.keyId : key.slice(0, 16);
  const rate = perKey(limitKey);
  if (!rate.allowed) {
    return json(429, rpcError(null, RPC.INTERNAL, 'Too many requests. Slow down and try again shortly.'), {
      'retry-after': String(retryAfterSeconds(rate.retryAfterMs)),
    });
  }

  const server = who.ok ? JOB_TRACKER_SERVER : unavailable(who.message);
  const ctx: ToolContext = who.ok
    ? { tenant: who.tenant, actor: { kind: 'AI', name: who.keyName }, keyId: who.keyId }
    : // Never read: every tool in the unavailable server answers before touching it.
      ({} as ToolContext);

  const result = await handleBody(server, body, ctx);
  if (result.status === 202) return new Response(null, { status: 202, headers: BASE_HEADERS });
  return json(result.status, result.json);
}
