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
import { after } from 'next/server';
import { SESSION_COOKIE, readSessionCookie } from './session';
import {
  ensureSchema,
  findApiKeyByHash,
  findUserById,
  getConnection,
  hasDatabase,
  touchApiKey,
  type Connection,
  type User,
} from './db';
import { openToken } from './crypto';
import { hashApiKey } from './api-keys';

export type Tenant = {
  userId: string;
  username: string;
  token: string;
  areasDs: string;
  topicsDs: string;
  tasksDs: string;
  dailyDs: string | null;
  /** Null until job tracking is set up — it is added to accounts, not built with them. */
  jobsDs: string | null;
  jobsProfileDs: string | null;
  jobsProfilePageId: string | null;
  /** The job databases' schema version. Raised in place once a migration runs. */
  jobsSchema: number;
  /** Where Notion builds new databases for this account. */
  parentPageId: string | null;
};

function tenantOf(user: Pick<User, 'id' | 'username'>, connection: Connection, token: string): Tenant {
  return {
    userId: user.id,
    username: user.username,
    token,
    areasDs: connection.areasDs!,
    topicsDs: connection.topicsDs!,
    tasksDs: connection.tasksDs!,
    dailyDs: connection.dailyDs,
    jobsDs: connection.jobsDs,
    jobsProfileDs: connection.jobsProfileDs,
    jobsProfilePageId: connection.jobsProfilePageId,
    jobsSchema: connection.jobsSchema,
    parentPageId: connection.parentPageId,
  };
}

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

  return { kind: 'ready', user, tenant: tenantOf(user, connection, token) };
}

export type KeyTenant =
  | { ok: true; tenant: Tenant; keyId: string; keyName: string }
  | { ok: false; status: 401 | 409 | 503; message: string };

/**
 * Resolves a personal key into a tenant, for AI tools calling the API.
 *
 * The key stands in for the session cookie and nothing else: it resolves to the
 * same Tenant a signed-in page gets, so every Notion read and write below it is
 * scoped exactly as it would be for that person in the browser. The messages
 * are written for whoever reads them in a chat with an AI tool.
 */
export async function tenantForApiKey(key: string): Promise<KeyTenant> {
  if (!hasDatabase()) {
    return { ok: false, status: 503, message: 'The tracker is not available right now. Try again shortly.' };
  }
  await ensureSchema();
  const found = await findApiKeyByHash(hashApiKey(key));
  if (!found) {
    return {
      ok: false,
      status: 401,
      message: 'That key is not valid, or it was revoked. Create a new one in the tracker under Jobs → Connect AI.',
    };
  }
  const connection = await getConnection(found.userId);
  const wired = connection?.areasDs && connection.topicsDs && connection.tasksDs;
  if (!connection || !wired || connection.provisionState !== 'ready') {
    return {
      ok: false,
      status: 409,
      message: 'This account has not finished connecting Notion. Finish setup in the tracker first.',
    };
  }
  let token: string;
  try {
    token = tokenOf(connection);
  } catch {
    return {
      ok: false,
      status: 409,
      message: 'The tracker can no longer read this account’s Notion connection. Reconnect Notion in the tracker.',
    };
  }
  // After the response, so it neither slows the call nor gets dropped when a
  // serverless function freezes the moment it has answered. "Last used" is how
  // a person spots a leaked key, so it has to be written reliably.
  const touch = () => touchApiKey(found.id).catch(() => undefined);
  try {
    after(touch);
  } catch {
    void touch(); // outside a request (scripts, tests)
  }
  return {
    ok: true,
    tenant: tenantOf({ id: found.userId, username: found.username }, connection, token),
    keyId: found.id,
    keyName: found.name,
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
