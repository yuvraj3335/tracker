import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, readSessionCookie } from '@/lib/session';

/**
 * Front door. Runs before any page or route handler.
 *
 * Only verifies the session cookie's signature — no database call, because this
 * runs on the edge where a Postgres round trip per request would be slow. Pages
 * load the actual user themselves.
 *
 * Fails closed: if SESSION_SECRET is missing, readSessionCookie returns null and
 * everything redirects to sign-in rather than silently letting requests through.
 */
const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/api/auth/',
  '/_next',
  '/favicon',
  '/icon',
  '/apple-icon',
  '/manifest',
  '/robots',
  '/sitemap',
  // Character artwork. Static files under public/, and they render on the
  // signed-out setup and auth screens — gating them would 307 the image
  // requests to /login and leave broken figures there.
  '/characters/',
  // Dev-only component preview, and only in development — see below.
  '/preview',
];

/**
 * The component preview is a development tool and must not be reachable by
 * anyone using the product.
 *
 * The page itself calls notFound(), but that renders the not-found *page* and
 * still answers 200, which is not the same as the route being absent. Refusing
 * it here returns a real 404 and never runs the harness at all.
 */
const DEV_ONLY_PREFIXES = ['/preview'];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    process.env.NODE_ENV === 'production' &&
    DEV_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return new NextResponse(null, { status: 404 });
  }

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const userId = await readSessionCookie(req.cookies.get(SESSION_COOKIE)?.value);
  if (userId) return NextResponse.next();

  // API callers get JSON, not an HTML redirect. A fetch() whose session expired
  // mid-flight would otherwise receive the login page and fail on res.json()
  // with a parse error instead of a readable message.
  if (pathname.startsWith('/api/')) {
    const res = NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    if (req.cookies.has(SESSION_COOKIE)) {
      res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    }
    return res;
  }

  // An expired or forged cookie should not linger and keep failing.
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (pathname !== '/') url.searchParams.set('next', pathname);

  const res = NextResponse.redirect(url);
  if (req.cookies.has(SESSION_COOKIE)) {
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
