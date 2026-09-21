/**
 * Neon Postgres access.
 *
 * Postgres holds only what Notion cannot: user accounts, and each user's
 * encrypted Notion credentials. All tracker content still lives in the user's
 * own Notion — this database never stores a question, a completion or a date.
 *
 * Uses Neon's HTTP driver, which issues one request per query and keeps no
 * connection pool. That is the right fit for serverless, where long-lived
 * pooled connections get exhausted by concurrent function instances.
 */
import { neon } from '@neondatabase/serverless';
import { Pool } from 'pg';
import { env } from './env';

// Database rows are untyped by nature; each mapper below narrows them into a
// real domain type immediately.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type ProvisionState =
  | 'needs_token'
  | 'needs_page'
  | 'creating_databases'
  | 'seeding'
  | 'ready'
  | 'error';

export type User = { id: string; username: string; createdAt: string };

export type Connection = {
  userId: string;
  tokenCiphertext: string;
  tokenIv: string;
  tokenTag: string;
  parentPageId: string | null;
  areasDs: string | null;
  topicsDs: string | null;
  tasksDs: string | null;
  dailyDs: string | null;
  areaPageId: string | null;
  topicPageIds: Record<string, string> | null;
  headingIsSelect: boolean;
  provisionState: ProvisionState;
  provisionCursor: number;
  provisionError: string | null;
};

export function hasDatabase(): boolean {
  return Boolean(env.databaseUrl);
}

/**
 * A tagged-template query function, backed by whichever driver suits the URL.
 *
 * Neon hosts get Neon's HTTP driver: one request per query and no connection
 * pool, which is what serverless wants — pooled TCP connections get exhausted
 * when many function instances run at once.
 *
 * Anything else (local Postgres, self-hosted, RDS) gets the standard `pg` pool
 * over TCP. Both are exposed through the same interface so nothing downstream
 * needs to care, and the app is not locked to one host.
 */
type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

let _sql: SqlFn | null = null;
let _pool: Pool | null = null;

function isNeonUrl(url: string): boolean {
  try {
    return /\.neon\.tech$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function sql(): SqlFn {
  if (_sql) return _sql;

  const url = env.databaseUrl;
  if (!url) throw new Error('DATABASE_URL is not set');

  if (isNeonUrl(url)) {
    const q = neon(url);
    _sql = ((strings, ...values) =>
      (q as unknown as SqlFn)(strings, ...values)) as SqlFn;
    return _sql;
  }

  // Standard Postgres: rebuild the template as a $1/$2 parameterised query.
  // Values are always bound, never interpolated, so this is injection-safe.
  _pool ??= new Pool({
    connectionString: url,
    max: 5,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  const pool = _pool;

  _sql = async (strings, ...values) => {
    let text = '';
    strings.forEach((part, i) => {
      text += part;
      if (i < values.length) text += `$${i + 1}`;
    });
    const res = await pool.query(text, values as unknown[]);
    return res.rows;
  };
  return _sql;
}

/**
 * Creates the schema if it is missing. Safe to call repeatedly — every
 * statement is IF NOT EXISTS. Called from the auth routes so a fresh Neon
 * database needs no separate migration step.
 */
let migrated = false;
export async function ensureSchema(): Promise<void> {
  if (migrated) return;
  const q = sql();

  await q`
    create table if not exists users (
      id            uuid primary key default gen_random_uuid(),
      username      text not null,
      password_hash text not null,
      created_at    timestamptz not null default now()
    )
  `;
  // Case-insensitive uniqueness: "Yuvraj" and "yuvraj" must not both exist.
  await q`
    create unique index if not exists users_username_lower_idx
      on users (lower(username))
  `;
  await q`
    create table if not exists notion_connections (
      user_id           uuid primary key references users(id) on delete cascade,
      token_ciphertext  text not null,
      token_iv          text not null,
      token_tag         text not null,
      parent_page_id    text,
      areas_ds          text,
      topics_ds         text,
      tasks_ds          text,
      daily_ds          text,
      area_page_id      text,
      topic_page_ids    jsonb,
      heading_is_select boolean not null default true,
      provision_state   text not null default 'needs_page',
      provision_cursor  integer not null default 0,
      provision_error   text,
      updated_at        timestamptz not null default now()
    )
  `;

  // CREATE TABLE IF NOT EXISTS is a no-op when the table already exists, so it
  // cannot introduce a column added in a later release. Deployments created
  // before `heading_is_select` existed would otherwise fail every write to
  // this table with "column does not exist". ADD COLUMN IF NOT EXISTS is
  // idempotent, so this is safe to run on every cold start.
  await q`
    alter table notion_connections
      add column if not exists heading_is_select boolean not null default true
  `;

  // Held while one request is writing a chunk of questions. Without it two
  // browser tabs both read the same cursor and both write the same rows — see
  // claimSeedingLease.
  await q`
    alter table notion_connections
      add column if not exists provision_lock timestamptz
  `;

  migrated = true;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Inserts a user, or returns null if the username is taken.
 *
 * Relies on the unique index rather than a check-then-insert, which would race:
 * two simultaneous signups for the same name could both pass the check. The
 * try/catch is a fallback for Postgres builds that refuse ON CONFLICT against
 * an expression index.
 */
export async function createUser(
  username: string,
  passwordHash: string,
): Promise<User | null> {
  const q = sql();
  try {
    const rows = (await q`
      insert into users (username, password_hash)
      values (${username}, ${passwordHash})
      on conflict (lower(username)) do nothing
      returning id, username, created_at
    `) as any[];
    if (!rows.length) return null;
    return { id: rows[0].id, username: rows[0].username, createdAt: rows[0].created_at };
  } catch (e) {
    // 23505 = unique_violation
    if ((e as { code?: string })?.code === '23505') return null;
    if (/duplicate key|unique constraint/i.test((e as Error).message)) return null;
    throw e;
  }
}

/**
 * Username lookup is case-insensitive, and returns the hash so the caller can
 * verify. Always call verifyPassword even when this returns null (with a dummy
 * hash) if you care about not leaking which usernames exist via timing.
 */
export async function findUserByUsername(
  username: string,
): Promise<(User & { passwordHash: string }) | null> {
  const q = sql();
  const rows = (await q`
    select id, username, password_hash, created_at
    from users
    where lower(username) = lower(${username})
    limit 1
  `) as any[];
  if (!rows.length) return null;
  return {
    id: rows[0].id,
    username: rows[0].username,
    passwordHash: rows[0].password_hash,
    createdAt: rows[0].created_at,
  };
}

export async function findUserById(id: string): Promise<User | null> {
  // A forged/garbage cookie can carry a non-uuid, which Postgres rejects at
  // cast time — treat that as "no such user" rather than a 500.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const q = sql();
  const rows = (await q`
    select id, username, created_at from users where id = ${id}::uuid limit 1
  `) as any[];
  if (!rows.length) return null;
  return { id: rows[0].id, username: rows[0].username, createdAt: rows[0].created_at };
}

// ---------------------------------------------------------------------------
// Notion connections
// ---------------------------------------------------------------------------
function toConnection(row: any): Connection {
  return {
    userId: row.user_id,
    tokenCiphertext: row.token_ciphertext,
    tokenIv: row.token_iv,
    tokenTag: row.token_tag,
    parentPageId: row.parent_page_id,
    areasDs: row.areas_ds,
    topicsDs: row.topics_ds,
    tasksDs: row.tasks_ds,
    dailyDs: row.daily_ds,
    areaPageId: row.area_page_id,
    topicPageIds: row.topic_page_ids,
    headingIsSelect: row.heading_is_select !== false,
    provisionState: row.provision_state,
    provisionCursor: row.provision_cursor,
    provisionError: row.provision_error,
  };
}

export async function getConnection(userId: string): Promise<Connection | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const q = sql();
  const rows = (await q`
    select * from notion_connections where user_id = ${userId}::uuid limit 1
  `) as any[];
  return rows.length ? toConnection(rows[0]) : null;
}

/** Stores (or replaces) the encrypted token and resets provisioning. */
export async function saveToken(
  userId: string,
  sealed: { ciphertext: string; iv: string; tag: string },
): Promise<void> {
  const q = sql();
  await q`
    insert into notion_connections
      (user_id, token_ciphertext, token_iv, token_tag, provision_state, provision_cursor)
    values
      (${userId}::uuid, ${sealed.ciphertext}, ${sealed.iv}, ${sealed.tag}, 'needs_page', 0)
    on conflict (user_id) do update set
      token_ciphertext = excluded.token_ciphertext,
      token_iv         = excluded.token_iv,
      token_tag        = excluded.token_tag,
      provision_state  = 'needs_page',
      provision_error  = null,
      updated_at       = now()
  `;
}

/**
 * Records the four databases the moment they exist.
 *
 * Creating everything takes ~25 sequential Notion calls, which is long enough
 * to hit a serverless timeout. Without an early save, a failure after the
 * databases were created left them orphaned in the user's Notion and a retry
 * built a second full set. Saving here lets `createDatabases` skip what is
 * already there.
 */
export async function saveDatabaseShells(
  userId: string,
  d: {
    parentPageId: string;
    areasDs: string;
    topicsDs: string;
    tasksDs: string;
    dailyDs: string;
    headingIsSelect: boolean;
  },
): Promise<void> {
  const q = sql();
  await q`
    update notion_connections set
      parent_page_id    = ${d.parentPageId},
      areas_ds          = ${d.areasDs},
      topics_ds         = ${d.topicsDs},
      tasks_ds          = ${d.tasksDs},
      daily_ds          = ${d.dailyDs},
      heading_is_select = ${d.headingIsSelect},
      updated_at        = now()
    where user_id = ${userId}::uuid
  `;
}

/**
 * `resetCursor` must be false whenever the Tasks database already existed.
 *
 * Rewinding the cursor to 0 against a Tasks database that already holds rows
 * writes every one of those questions a second time. That is reachable without
 * anything going wrong: rotating ENCRYPTION_KEY (which the README documents as
 * a supported operation) or a revoked Notion token both send a user back
 * through "paste your secret", and saveToken keeps the database ids while
 * moving the state to needs_page. Pasting the page link then rebuilt nothing —
 * correctly — but re-seeded from zero. Measured: 456 rows became 471 after a
 * single chunk, and would have reached 912.
 */
export async function saveDatabases(
  userId: string,
  d: {
    parentPageId: string;
    areasDs: string;
    topicsDs: string;
    tasksDs: string;
    dailyDs: string;
    areaPageId: string;
    topicPageIds: Record<string, string>;
    headingIsSelect: boolean;
  },
  resetCursor: boolean,
): Promise<void> {
  const q = sql();
  await q`
    update notion_connections set
      parent_page_id   = ${d.parentPageId},
      areas_ds         = ${d.areasDs},
      topics_ds        = ${d.topicsDs},
      tasks_ds         = ${d.tasksDs},
      daily_ds         = ${d.dailyDs},
      area_page_id     = ${d.areaPageId},
      topic_page_ids   = ${JSON.stringify(d.topicPageIds)}::jsonb,
      heading_is_select = ${d.headingIsSelect},
      provision_state  = 'seeding',
      provision_cursor = case when ${resetCursor}::boolean then 0 else provision_cursor end,
      provision_error  = null,
      updated_at       = now()
    where user_id = ${userId}::uuid
  `;
}

/**
 * Claims the exclusive right to write the next chunk, and returns the cursor to
 * start from. Returns null when another request already holds it.
 *
 * The cursor alone cannot make seeding safe: `read cursor -> write rows -> save
 * cursor` is a read-modify-write, and two requests that read the same value
 * both write the same questions. The browser drives this loop, and the setup
 * screen tells people they can close the tab and come back — so two tabs
 * running at once is ordinary use, not an edge case. Measured before this
 * existed: two simultaneous steps produced 30 rows for 15 questions.
 *
 * A single conditional UPDATE is the whole mechanism. Postgres serialises the
 * row update, so exactly one caller sees the lock as free and gets a row back.
 *
 * The lease expires so a request that died mid-chunk cannot wedge setup
 * forever. `staleAfterSeconds` is comfortably longer than the route's
 * maxDuration, so it can only expire on a request that is genuinely gone.
 */
export async function claimSeedingLease(
  userId: string,
  staleAfterSeconds = 90,
): Promise<number | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const q = sql();
  const rows = (await q`
    update notion_connections
       set provision_lock = now()
     where user_id = ${userId}::uuid
       and (
         provision_lock is null
         or provision_lock < now() - (${staleAfterSeconds}::int * interval '1 second')
       )
    returning provision_cursor
  `) as any[];
  return rows.length ? Number(rows[0].provision_cursor) : null;
}

/** Hands the lease back as soon as the chunk is done, successfully or not. */
export async function releaseSeedingLease(userId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return;
  const q = sql();
  await q`
    update notion_connections set provision_lock = null where user_id = ${userId}::uuid
  `;
}

export async function setProvision(
  userId: string,
  state: ProvisionState,
  cursor?: number,
  error?: string | null,
): Promise<void> {
  const q = sql();
  await q`
    update notion_connections set
      provision_state  = ${state},
      provision_cursor = coalesce(${cursor ?? null}::integer, provision_cursor),
      provision_error  = ${error ?? null},
      updated_at       = now()
    where user_id = ${userId}::uuid
  `;
}

/**
 * Closes the `pg` pool, so a script that touched the database can exit instead
 * of hanging on an idle connection. A no-op on Neon's HTTP driver, which holds
 * nothing open, and unused by the app itself — the server wants its pool.
 */
export async function closePool(): Promise<void> {
  if (!_pool) return;
  const pool = _pool;
  _pool = null;
  _sql = null;
  migrated = false;
  await pool.end();
}

/** Wipes the Notion link but keeps the account, so the user can reconnect. */
export async function deleteConnection(userId: string): Promise<void> {
  const q = sql();
  await q`delete from notion_connections where user_id = ${userId}::uuid`;
}
