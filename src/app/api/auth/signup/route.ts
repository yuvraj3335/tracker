import { NextResponse } from 'next/server';
import { createUser, ensureSchema, hasDatabase } from '@/lib/db';
import { hashPassword } from '@/lib/crypto';
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionCookie } from '@/lib/session';
import { checkPassword, checkUsername } from '@/lib/validate';

// scrypt is Node-only, so this handler must not run on the edge.
export const runtime = 'nodejs';

function back(req: Request, error: string, username = '') {
  const url = new URL('/signup', req.url);
  url.searchParams.set('error', error);
  if (username) url.searchParams.set('u', username);
  // 303 so the browser GETs the destination instead of replaying this POST.
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  if (!hasDatabase()) return back(req, 'The server has no database configured yet.');

  const form = await req.formData();
  const u = checkUsername(form.get('username'));
  if (!u.ok) return back(req, u.error);
  const p = checkPassword(form.get('password'));
  if (!p.ok) return back(req, p.error, u.value);

  if (String(form.get('confirm') ?? '') !== p.value) {
    return back(req, 'Those two passwords do not match.', u.value);
  }

  try {
    await ensureSchema();
    const user = await createUser(u.value, await hashPassword(p.value));
    if (!user) return back(req, 'That username is taken.', u.value);

    // Straight into setup — a new account has no Notion connection yet.
    const res = NextResponse.redirect(new URL('/setup', req.url), 303);
    res.cookies.set(SESSION_COOKIE, await createSessionCookie(user.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch (e) {
    console.error('[signup]', e);
    return back(req, 'Could not create the account. Try again.', u.value);
  }
}
