/**
 * Stateless signed-cookie sessions.
 *
 * The cookie carries `userId.expiry.signature`, HMAC-SHA256'd with SESSION_SECRET.
 * Nothing secret is inside it — just an id — so the worst a reader learns is
 * their own user id. The signature is what stops anyone forging a different id.
 *
 * Stateless on purpose: the proxy runs on the edge, where a Postgres round trip
 * per request would be slow and awkward. It verifies the signature with Web
 * Crypto (available on both edge and Node) and lets the request through; pages
 * then load the actual user from the database.
 *
 * Trade-off worth knowing: because there is no session table, a signed cookie
 * stays valid until it expires — changing a password does not retroactively kill
 * other devices' sessions. For that, bump SESSION_SECRET (logs everyone out).
 */
export const SESSION_COOKIE = 'jst_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.trim().length < 16) {
    throw new Error('SESSION_SECRET is not set (needs at least 16 characters)');
  }
  return s.trim();
}

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(sig);
}

/** Constant-time string compare — avoids leaking the signature byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(userId: string): Promise<string> {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expires}`;
  return `${payload}.${await sign(payload)}`;
}

/** Returns the user id, or null if the cookie is missing, forged or expired. */
export async function readSessionCookie(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const idx = value.lastIndexOf('.');
  if (idx < 0) return null;

  const payload = value.slice(0, idx);
  const signature = value.slice(idx + 1);

  let expected: string;
  try {
    expected = await sign(payload);
  } catch {
    return null; // SESSION_SECRET missing — fail closed, never open
  }
  if (!safeEqual(signature, expected)) return null;

  const [userId, expiresRaw] = payload.split('.');
  const expires = Number(expiresRaw);
  if (!userId || !Number.isFinite(expires) || Date.now() > expires) return null;

  return userId;
}
