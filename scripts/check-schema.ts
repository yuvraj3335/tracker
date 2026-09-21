/**
 * Upgrade check: proves `ensureSchema` brings an OLD database forward and that
 * writes still work afterwards.
 *
 * The schema creates itself on first signup and there is no migration step, so
 * the only thing standing between a long-running deployment and "column does
 * not exist" on every write is the ADD COLUMN IF NOT EXISTS block in
 * `ensureSchema`. That block is untestable from the app — by the time the app
 * runs, the table is already current — so this builds the original schema in a
 * scratch database and upgrades it.
 *
 *   npm run check:schema
 *
 * Needs DATABASE_URL to point at a Postgres the script may create databases on.
 * It creates and drops its own scratch database and never touches yours.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { Client } from 'pg';

/** The schema as it shipped before `heading_is_select` and `provision_lock`. */
const ORIGINAL_SCHEMA = `
  create table users (
    id            uuid primary key default gen_random_uuid(),
    username      text not null,
    password_hash text not null,
    created_at    timestamptz not null default now()
  );
  create unique index users_username_lower_idx on users (lower(username));
  create table notion_connections (
    user_id          uuid primary key references users(id) on delete cascade,
    token_ciphertext text not null,
    token_iv         text not null,
    token_tag        text not null,
    parent_page_id   text,
    areas_ds         text,
    topics_ds        text,
    tasks_ds         text,
    daily_ds         text,
    area_page_id     text,
    topic_page_ids   jsonb,
    provision_state  text not null default 'needs_page',
    provision_cursor integer not null default 0,
    provision_error  text,
    updated_at       timestamptz not null default now()
  );
`;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const SCRATCH = 'jst_schema_check';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set — nothing to check against.');
    process.exit(1);
  }
  if (/\.neon\.tech$/i.test(new URL(url).hostname)) {
    console.log('Neon URL detected; this check needs a plain Postgres it can create a database on.');
    process.exit(0);
  }

  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH}`);
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();

  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${SCRATCH}`;

  const legacy = new Client({ connectionString: scratchUrl.toString() });
  await legacy.connect();
  await legacy.query(ORIGINAL_SCHEMA);
  const before = await legacy.query(
    `select column_name from information_schema.columns where table_name = 'notion_connections'`,
  );
  const beforeCols = before.rows.map((r) => r.column_name);
  await legacy.end();

  console.log('\nOld database, before ensureSchema');
  check('heading_is_select is absent', !beforeCols.includes('heading_is_select'));
  check('provision_lock is absent', !beforeCols.includes('provision_lock'));

  // Point the app's own db module at the scratch database and upgrade it.
  process.env.DATABASE_URL = scratchUrl.toString();
  const db = await import('../src/lib/db');
  const { hashPassword, sealToken } = await import('../src/lib/crypto');

  await db.ensureSchema();
  console.log('\nAfter ensureSchema');

  const after = new Client({ connectionString: scratchUrl.toString() });
  await after.connect();
  const cols = (
    await after.query(
      `select column_name from information_schema.columns where table_name = 'notion_connections'`,
    )
  ).rows.map((r) => r.column_name);
  check('heading_is_select was added', cols.includes('heading_is_select'));
  check('provision_lock was added', cols.includes('provision_lock'));

  // A column that exists is not the same as a database that still works.
  const user = await db.createUser('upgradecheck', await hashPassword('correct-horse-9'));
  check('users still accepts a write', Boolean(user));
  await db.saveToken(user!.id, sealToken('ntn_upgrade_check'));
  const conn = await db.getConnection(user!.id);
  check('notion_connections still accepts a write', Boolean(conn));
  check('heading_is_select defaults to true on an upgraded row', conn?.headingIsSelect === true);

  console.log('\nSeeding lease (the new column, doing its job)');
  const first = await db.claimSeedingLease(user!.id);
  const second = await db.claimSeedingLease(user!.id);
  check('one caller gets the lease', first === 0, `got ${first}`);
  check('a concurrent caller is refused', second === null, `got ${second}`);
  await db.releaseSeedingLease(user!.id);
  check('the lease is reusable once released', (await db.claimSeedingLease(user!.id)) === 0);
  await db.releaseSeedingLease(user!.id);
  const stale = await db.claimSeedingLease(user!.id, 0); // everything is stale at 0s
  check('an abandoned lease expires', stale === 0, `got ${stale}`);
  await db.releaseSeedingLease(user!.id);

  console.log('\nCursor handling on save');
  await db.setProvision(user!.id, 'seeding', 42, null);
  const shells = {
    parentPageId: 'p', areasDs: 'a', topicsDs: 't', tasksDs: 'k', dailyDs: 'd',
    areaPageId: 'ap', topicPageIds: { x: 'y' }, headingIsSelect: true,
  };
  await db.saveDatabases(user!.id, shells, false);
  check(
    'reusing an existing Tasks database resumes the cursor',
    (await db.getConnection(user!.id))?.provisionCursor === 42,
  );
  await db.saveDatabases(user!.id, shells, true);
  check(
    'a brand-new Tasks database starts from zero',
    (await db.getConnection(user!.id))?.provisionCursor === 0,
  );

  await after.end();
  // db.ts holds a pool open against the scratch database; the drop is refused
  // while any session is still connected.
  await db.closePool();

  const cleanup = new Client({ connectionString: url });
  await cleanup.connect();
  await cleanup.query(`drop database if exists ${SCRATCH}`);
  await cleanup.end();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
