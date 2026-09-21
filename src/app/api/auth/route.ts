import { NextResponse } from 'next/server';
import { SESSION_COOKIE, expectedToken, safeEqual } from '@/lib/auth';

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  const form = await req.formData();
  const submitted = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/') || '/';

  if (!password) {
    return NextResponse.redirect(new URL(next, req.url));
  }

  // Compare derivations, never the raw strings.
  const expected = await expectedToken(password);
  const got = await expectedToken(submitted);
  if (!safeEqual(expected, got)) {
    const url = new URL('/login', req.url);
    url.searchParams.set('error', '1');
    url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  }

  const res = NextResponse.redirect(new URL(next, req.url));
  res.cookies.set(SESSION_COOKIE, expected, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export async function DELETE(req: Request) {
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
