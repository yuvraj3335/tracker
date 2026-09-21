/** Shared input rules for signup and signin. */
export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
export const MIN_PASSWORD = 8;

export function checkUsername(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: false, error: 'Pick a username.' };
  if (!USERNAME_RE.test(v)) {
    return {
      ok: false,
      error: '3–32 characters, letters and numbers only (dots, dashes and underscores are fine).',
    };
  }
  return { ok: true, value: v };
}

export function checkPassword(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? '');
  if (v.length < MIN_PASSWORD) {
    return { ok: false, error: `Password needs at least ${MIN_PASSWORD} characters.` };
  }
  if (v.length > 512) return { ok: false, error: 'That password is too long.' };
  return { ok: true, value: v };
}

/**
 * The only place `?next=` is turned into a destination.
 *
 * Anything that is not a plain same-site path becomes '/'. Both callers (the
 * sign-in page and the sign-in route) go through this, because the two of them
 * previously disagreed about what was safe and the weaker one decided where the
 * browser actually went.
 *
 * `startsWith('/')` is NOT sufficient on its own:
 *
 *   //evil.com    a protocol-relative URL — resolves to https://evil.com
 *   /\evil.com    browsers normalise a backslash to '/', so this is //evil.com
 *   /\t/evil.com  tab, LF and CR are stripped from URLs before parsing, so
 *                 this also collapses to //evil.com
 *
 * Every one of those begins with '/'. They are rejected by normalising the
 * string the way a browser would first, then requiring a single leading slash.
 */
export function safeNextPath(raw: unknown): string {
  const v = String(raw ?? '');
  if (!v) return '/';
  // Browsers drop these before parsing a URL, so validate what will be parsed.
  const stripped = v.replace(/[\t\n\r]/g, '');
  // A backslash is equivalent to '/' in a URL path, so treat it as one.
  const normalized = stripped.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) return '/';
  // '//host' is protocol-relative and leaves the site.
  if (normalized.startsWith('//')) return '/';
  // Anything that still parses to another origin is not ours.
  if (/^\/[^/]*:/.test(normalized)) return '/';
  return normalized;
}
