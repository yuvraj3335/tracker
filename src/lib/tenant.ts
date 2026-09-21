/**
 * Resolves "who is asking" into a tenant: a user plus their decrypted Notion
 * credentials.
 *
 * Every Notion read and write in the app takes a Tenant explicitly. That is the
 * central multi-tenancy guard — there is no ambient "current token" anywhere, so
 * it is not possible to accidentally serve one user's Notion data using
 * another's credentials. The previous single-user build kept a module-level
 * Notion client; under multi-tenancy that would have been a cross-tenant leak.
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSessionCookie } from './session';
import { findUserById, getConnection, hasDatabase, type Connection, type User } from './db';
import { openToken } from './crypto';

export type Tenant = {
  userId: string;
  username: string;
  token: string;
  areasDs: string;
  topicsDs: string;
  tasksDs: string;
  dailyDs: string | null;
};

/**
 * The signed-in user, or null. Does not touch Notion.
 *
 * Memoised per request: the layout and the page both need it, and without this
 * every page load would cost two identical database queries.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  if (!hasDatabase()) return null;
  const jar = await cookies();
  const userId = await readSessionCookie(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  try {
    return await findUserById(userId);
  } catch (e) {
    // The root layout calls this on every request. An unguarded throw here
    // would 500 the entire app — including /login — the moment the database
    // hiccuped. Degrading to "signed out" keeps the app reachable; pages that
    // genuinely need data raise their own error through error.tsx.
    console.error('[currentUser] database unreachable:', (e as Error).message);
    return null;
  }
});

export type TenantStatus =
  | { kind: 'anonymous' }
  | { kind: 'needs_token'; user: User }
  | { kind: 'needs_page'; user: User }
  | { kind: 'provisioning'; user: User; connection: Connection }
  | { kind: 'error'; user: User; connection: Connection }
  | { kind: 'ready'; user: User; tenant: Tenant };

/**
 * One call that answers both "are they signed in" and "is their Notion usable",
 * so pages can route to sign-in, setup, a progress screen or the real UI
 * without each re-deriving the rules.
 */
export async function tenantStatus(): Promise<TenantStatus> {
  const user = await currentUser();
  if (!user) return { kind: 'anonymous' };

  const connection = await getConnection(user.id);
  if (!connection) return { kind: 'needs_token', user };

  if (connection.provisionState === 'error') return { kind: 'error', user, connection };

  const wired = connection.areasDs && connection.topicsDs && connection.tasksDs;
  if (!wired || connection.provisionState === 'needs_page') {
    return { kind: 'needs_page', user };
  }
  if (connection.provisionState !== 'ready') {
    return { kind: 'provisioning', user, connection };
  }

  let token: string;
  try {
    token = openToken({
      ciphertext: connection.tokenCiphertext,
      iv: connection.tokenIv,
      tag: connection.tokenTag,
    });
  } catch {
    // ENCRYPTION_KEY changed or the row was tampered with. Send them back to
    // reconnect rather than surfacing a decryption error.
    return { kind: 'needs_token', user };
  }

  return {
    kind: 'ready',
    user,
    tenant: {
      userId: user.id,
      username: user.username,
      token,
      areasDs: connection.areasDs!,
      topicsDs: connection.topicsDs!,
      tasksDs: connection.tasksDs!,
      dailyDs: connection.dailyDs,
    },
  };
}

/** For API routes that must have a working tenant; throws otherwise. */
export async function requireTenant(): Promise<Tenant> {
  const status = await tenantStatus();
  if (status.kind !== 'ready') throw new Error(`tenant not ready: ${status.kind}`);
  return status.tenant;
}

/** Decrypts a stored connection's token. Used during provisioning, before ready. */
export function tokenOf(connection: Connection): string {
  return openToken({
    ciphertext: connection.tokenCiphertext,
    iv: connection.tokenIv,
    tag: connection.tokenTag,
  });
}

/**
 * Page guard. Sends anyone without a working Notion connection to the right
 * place instead of rendering a broken dashboard.
 *
 * Pages using this must also set `export const dynamic = 'force-dynamic'`.
 * Without it Next would prerender them at build time, and a per-user page baked
 * at build time would serve whoever built it to everyone.
 */
export async function requireReady(): Promise<Tenant> {
  const status = await tenantStatus();
  if (status.kind === 'anonymous') redirect('/login');
  if (status.kind !== 'ready') redirect('/setup');
  return status.tenant;
}
