/**
 * Personal keys: how an AI tool proves it is acting for one account.
 *
 * A key is `jt_` plus 43 characters of base64url — 256 random bits. It is
 * shown once, when it is made, and only its SHA-256 is stored. A slow hash
 * would add nothing here: the thing slow hashes protect is a guessable
 * password, and 256 random bits are not guessable. The fast hash is what lets
 * every request look the key up by value.
 *
 * Node-only (node:crypto), like crypto.ts.
 */
import { createHash, randomBytes } from 'node:crypto';

export const KEY_PREFIX = 'jt_';
/** How much of a key is shown afterwards, so a person can tell theirs apart. */
const SHOWN = 10;
export const MAX_ACTIVE_KEYS = 20;

const KEY_RE = /^jt_[A-Za-z0-9_-]{43}$/;

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, prefix: key.slice(0, SHOWN), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** True for something shaped like a key. Checked before any database lookup. */
export function looksLikeApiKey(v: unknown): v is string {
  return typeof v === 'string' && KEY_RE.test(v);
}

/**
 * The key from an `Authorization: Bearer …` header, or null.
 *
 * The scheme is matched case-insensitively (RFC 7235), and anything that is not
 * exactly one well-formed key is refused rather than trimmed into one.
 */
export function bearerKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^\s*bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) return null;
  return looksLikeApiKey(m[1]) ? m[1] : null;
}

/** A key's name, as typed into the form. */
export function cleanKeyName(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return s || 'AI tools';
}
