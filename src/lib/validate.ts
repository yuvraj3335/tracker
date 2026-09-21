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
