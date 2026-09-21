import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, isValidSession } from '@/lib/auth';

/** Paths that must stay reachable without a session. */
const PUBLIC = ['/login', '/api/auth', '/_next', '/favicon', '/icon', '/apple-icon', '/manifest'];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const ok = await isValidSession(req.cookies.get(SESSION_COOKIE)?.value, password);
  if (ok) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  // Remember where they were headed so login can bounce them back.
  url.searchParams.set('next', pathname === '/' ? '/' : pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
