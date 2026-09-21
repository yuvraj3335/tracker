import { NextResponse } from 'next/server';
import { ensureSchema, findUserByUsername, hasDatabase } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * A throwaway hash verified when the username does not exist, so a missing
 * account costs the same time as a wrong password. Without it, response timing
 * would reveal which usernames are registered.
 */
let decoyHash: string | null = null;
async function decoy(password: string) {
  decoyHash ??= await hashPassword('decoy-password-never-used');
  await verifyPassword(password, decoyHash);
}

function back(req: Request, next: string, username = '') {
  const url = new URL('/login', req.url);
  url.searchParams.set('error', '1');
  if (next) url.searchParams.set('next', next);
  if (username) url.searchParams.set('u', username);
  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const nextPath = String(form.get('next') ?? '/') || '/';
  // Only allow same-site destinations, so `next` cannot be used as an open redirect.
  const next = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/';

  if (!hasDatabase()) return back(req, next, username);

  try {
    await ensureSchema();
    const user = await findUserByUsername(username);
    if (!user) {
      await decoy(password);
      return back(req, next, username);
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      return back(req, next, username);
    }

    const res = NextResponse.redirect(new URL(next, req.url));
    res.cookies.set(SESSION_COOKIE, await createSessionCookie(user.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch (e) {
    console.error('[signin]', e);
    return back(req, next, username);
  }
}
