/**
 * Single-password gate.
 *
 * The public Vercel URL can write to your Notion, so it must not be open. The
 * cookie holds a SHA-256 derivation of APP_PASSWORD rather than the password
 * itself, so the secret is never sent back to the browser in readable form.
 *
 * Uses Web Crypto so the same code runs in middleware (edge) and in route
 * handlers (node).
 */
export const SESSION_COOKIE = 'jst_session';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The value a valid session cookie must hold. */
export async function expectedToken(password: string): Promise<string> {
  return sha256Hex(`jst:v1:${password}`);
}

/** Constant-time-ish comparison — avoids leaking prefix length via timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(
  cookieValue: string | undefined,
  password: string | undefined,
): Promise<boolean> {
  // No password configured => the gate is disabled (useful for local dev).
  if (!password) return true;
  if (!cookieValue) return false;
  return safeEqual(cookieValue, await expectedToken(password));
}
