/**
 * Adding job tracking to an account that already has a tracker (server only).
 *
 * Resumable the same way the original setup is: each id is saved the moment it
 * exists, anything already recorded is skipped, and a database made by an
 * attempt that died before saving is adopted rather than duplicated.
 */
import type { Client } from '@notionhq/client';
import { P, jobProfileProperties, jobsProperties } from '../schema';
import { callerFor, createDb, propertyIds, type Caller } from '../provision';
import { claimJobsLease, ensureSchema, getConnection, releaseJobsLease, saveJobsShells } from '../db';
import { JobsError, clientFor, ensureJobsSchema, invalidateJobs } from './notion';
import type { Tenant } from '../tenant';

/* eslint-disable @typescript-eslint/no-explicit-any */

const runs = (s: string) => [{ type: 'text' as const, text: { content: s } }];

export const JOBS_DB_NAME = 'Job Applications';
export const PROFILE_DB_NAME = 'Job Profile';

/**
 * Finds a database the app made on an earlier attempt, so a retry adopts it
 * instead of building a second one. Matched on title AND on a property only
 * this schema has, so a database the user happened to name the same is left
 * alone.
 */
async function adoptDatabase(
  run: Caller,
  client: Client,
  parentPageId: string,
  title: string,
  mustHave: string,
): Promise<string | null> {
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const res: any = await run('list tracker page', () =>
      client.blocks.children.list({ block_id: parentPageId, page_size: 100, start_cursor: cursor }),
    );
    for (const b of res.results ?? []) {
      if (b?.type !== 'child_database' || b.child_database?.title !== title) continue;
      const db: any = await run('read database', () => client.databases.retrieve({ database_id: b.id }));
      const ds = db?.data_sources?.[0]?.id;
      if (!ds) continue;
      const props = await propertyIds(run, client, ds).catch(() => ({}) as Record<string, string>);
      if (props[mustHave]) return ds;
    }
    if (!res.has_more) break;
    cursor = res.next_cursor ?? undefined;
  }
  return null;
}

/** Views are a nicety in Notion itself; a failure here never blocks setup. */
async function buildJobViews(run: Caller, client: Client, jobsDs: string) {
  const ids = await propertyIds(run, client, jobsDs).catch(() => ({}) as Record<string, string>);
  const safe = async (body: Record<string, any>) => {
    try {
      await run(`view ${body.name}`, () => (client as any).views.create(body));
    } catch {
      /* cosmetic */
    }
  };
  if (ids[P.job.status]) {
    await safe({
      data_source_id: jobsDs,
      name: 'Pipeline',
      type: 'board',
      configuration: {
        type: 'board',
        group_by: { type: 'select', property_id: ids[P.job.status], sort: { type: 'manual' } },
      },
    });
  }
  await safe({
    data_source_id: jobsDs,
    name: 'Applied',
    type: 'table',
    filter: { property: P.job.appliedOn, date: { is_not_empty: true } },
    sorts: [{ property: P.job.appliedOn, direction: 'descending' }],
  });
  await safe({
    data_source_id: jobsDs,
    name: 'Follow-ups',
    type: 'table',
    filter: { property: P.job.followUpOn, date: { is_not_empty: true } },
    sorts: [{ property: P.job.followUpOn, direction: 'ascending' }],
  });
}

export type JobsSetup = { jobsDs: string; jobsProfileDs: string; jobsProfilePageId: string };

/**
 * Adds job tracking to a connected account: a Job Applications database, a
 * Job Profile database with its one row, and a few Notion views — all under
 * the same page the tracker was built in.
 *
 * Resumable the same way the original setup is: each id is saved the moment it
 * exists, anything already recorded is skipped, and a database made by an
 * attempt that died before saving is adopted rather than duplicated.
 */
export async function setupJobs(t: Tenant): Promise<JobsSetup> {
  await ensureSchema();
  if (!(await claimJobsLease(t.userId))) {
    throw new JobsError('Setup is already running. Give it a few seconds.', 'busy');
  }
  try {
    const connection = await getConnection(t.userId);
    const parent = connection?.parentPageId;
    if (!connection || !parent) {
      throw new JobsError('The tracker does not know which Notion page it was built in. Reconnect Notion.', 'no_parent');
    }
    const client = clientFor(t.token);
    const run = callerFor(t.token);

    let jobsDs = connection.jobsDs;
    let fresh = false;
    if (!jobsDs) {
      jobsDs = await adoptDatabase(run, client, parent, JOBS_DB_NAME, P.job.key);
      if (!jobsDs) {
        jobsDs = await createDb(run, client, parent, JOBS_DB_NAME, '💼', jobsProperties());
        fresh = true;
      }
      await saveJobsShells(t.userId, { jobsDs });
    }

    let profileDs = connection.jobsProfileDs;
    if (!profileDs) {
      profileDs =
        (await adoptDatabase(run, client, parent, PROFILE_DB_NAME, P.profile.resume)) ??
        (await createDb(run, client, parent, PROFILE_DB_NAME, '🧭', jobProfileProperties()));
      await saveJobsShells(t.userId, { jobsProfileDs: profileDs });
    }

    let profilePage = connection.jobsProfilePageId;
    if (!profilePage) {
      const existing: any = await run('read profile', () =>
        client.dataSources.query({ data_source_id: profileDs!, page_size: 1 } as any),
      );
      profilePage = existing?.results?.[0]?.id ?? null;
      if (!profilePage) {
        const page: any = await run('create profile', () =>
          client.pages.create({
            parent: { type: 'data_source_id', data_source_id: profileDs! },
            icon: { type: 'emoji', emoji: '🧭' },
            properties: { [P.profile.name]: { title: runs('My job search profile') } },
          } as any),
        );
        profilePage = page.id as string;
      }
      await saveJobsShells(t.userId, { jobsProfilePageId: profilePage! });
    }

    if (fresh) await buildJobViews(run, client, jobsDs);
    // A database adopted from an earlier attempt, or set up before a column
    // existed, gets whatever the current schema adds.
    await ensureJobsSchema({ ...t, jobsDs, jobsProfileDs: profileDs }, { force: true });
    invalidateJobs(t.userId);
    return { jobsDs, jobsProfileDs: profileDs, jobsProfilePageId: profilePage! };
  } finally {
    await releaseJobsLease(t.userId);
  }
}
