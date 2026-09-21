import { NextResponse } from 'next/server';
import { currentUser, tokenOf } from '@/lib/tenant';
import { getConnection, saveDatabaseShells, saveDatabases, setProvision } from '@/lib/db';
import {
  CHUNK_SIZE,
  TOTAL_QUESTIONS,
  createDatabases,
  friendlyNotionError,
  seedChunk,
} from '@/lib/provision';
import { invalidateTenant } from '@/lib/notion';

export const runtime = 'nodejs';
// Provisioning is chunked precisely so no single call needs long, but give it
// headroom where the plan allows it.
export const maxDuration = 60;

type Progress = {
  state: string;
  cursor: number;
  total: number;
  done: boolean;
  error?: string | null;
};

/**
 * Drives setup in small steps.
 *
 *   { action: 'start', page } — creates the four databases, the area and the
 *                              18 topics, then flips to 'seeding'
 *   { action: 'step' }       — writes the next CHUNK_SIZE questions
 *
 * The browser calls 'step' repeatedly and draws a progress bar. Each step is
 * resumable: `provisionCursor` indexes one flat, deterministically ordered
 * question list, so a dropped request simply replays from where it stopped
 * without creating duplicates.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let action = '';
  let page = '';
  try {
    const body = await req.json();
    action = String(body?.action ?? '');
    page = String(body?.page ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }

  const connection = await getConnection(user.id);
  if (!connection) {
    return NextResponse.json({ error: 'Connect your Notion token first.' }, { status: 400 });
  }

  let token: string;
  try {
    token = tokenOf(connection);
  } catch {
    return NextResponse.json(
      { error: 'Your stored token could not be read. Please reconnect Notion.' },
      { status: 400 },
    );
  }

  // ---- start: build the databases -------------------------------------
  if (action === 'start') {
    if (!page) return NextResponse.json({ error: 'Paste your Notion page link.' }, { status: 400 });
    try {
      await setProvision(user.id, 'creating_databases', 0, null);
      // Hand back whatever a previous attempt managed to create. Building
      // everything is ~25 sequential Notion calls, so a timeout partway
      // through is realistic; without this a retry would build a second full
      // set of databases in the user's Notion.
      const created = await createDatabases(
        token,
        page,
        {
          parentPageId: connection.parentPageId,
          areasDs: connection.areasDs,
          topicsDs: connection.topicsDs,
          tasksDs: connection.tasksDs,
          dailyDs: connection.dailyDs,
          headingIsSelect: connection.headingIsSelect,
          areaPageId: connection.areaPageId,
          topicPageIds: connection.topicPageIds,
        },
        (shells) => saveDatabaseShells(user.id, shells),
      );
      await saveDatabases(user.id, created);
      invalidateTenant(user.id);
      return NextResponse.json({
        state: 'seeding',
        cursor: 0,
        total: TOTAL_QUESTIONS,
        done: false,
      } satisfies Progress);
    } catch (e) {
      const error = friendlyNotionError(e);
      await setProvision(user.id, 'error', 0, error);
      return NextResponse.json({ error }, { status: 400 });
    }
  }

  // ---- step: seed the next chunk --------------------------------------
  if (action === 'step') {
    if (!connection.tasksDs || !connection.areaPageId || !connection.topicPageIds) {
      return NextResponse.json({ error: 'Databases are not created yet.' }, { status: 400 });
    }
    if (connection.provisionState === 'ready') {
      return NextResponse.json({
        state: 'ready',
        cursor: TOTAL_QUESTIONS,
        total: TOTAL_QUESTIONS,
        done: true,
      } satisfies Progress);
    }

    try {
      const result = await seedChunk(
        token,
        {
          tasksDs: connection.tasksDs,
          areaPageId: connection.areaPageId,
          topicPageIds: connection.topicPageIds,
          headingIsSelect: connection.headingIsSelect,
        },
        connection.provisionCursor,
        CHUNK_SIZE,
      );

      // Always persist the cursor the chunk actually reached, including when
      // it stopped early. Saving the cursor we started with would re-create
      // every row the chunk had already written.
      if (result.error) {
        await setProvision(user.id, 'error', result.cursor, result.error);
        return NextResponse.json({ error: result.error, cursor: result.cursor }, { status: 400 });
      }

      await setProvision(user.id, result.done ? 'ready' : 'seeding', result.cursor, null);
      if (result.done) invalidateTenant(user.id);

      return NextResponse.json({
        state: result.done ? 'ready' : 'seeding',
        cursor: result.cursor,
        total: result.total,
        done: result.done,
      } satisfies Progress);
    } catch (e) {
      // seedChunk reports write failures in its return value, so reaching here
      // means something outside the write loop broke and no progress was made.
      const error = friendlyNotionError(e);
      await setProvision(user.id, 'error', connection.provisionCursor, error);
      return NextResponse.json({ error, cursor: connection.provisionCursor }, { status: 400 });
    }
  }

  // ---- retry: clear the error and resume ------------------------------
  if (action === 'retry') {
    const hasDbs = connection.tasksDs && connection.areaPageId && connection.topicPageIds;
    await setProvision(user.id, hasDbs ? 'seeding' : 'needs_page', connection.provisionCursor, null);
    return NextResponse.json({
      state: hasDbs ? 'seeding' : 'needs_page',
      cursor: connection.provisionCursor,
      total: TOTAL_QUESTIONS,
      done: false,
    } satisfies Progress);
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

/** Lets the setup screen read current progress without changing anything. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const connection = await getConnection(user.id);
  if (!connection) {
    return NextResponse.json({ state: 'needs_token', cursor: 0, total: TOTAL_QUESTIONS, done: false });
  }
  return NextResponse.json({
    state: connection.provisionState,
    cursor: connection.provisionCursor,
    total: TOTAL_QUESTIONS,
    done: connection.provisionState === 'ready',
    error: connection.provisionError,
  } satisfies Progress);
}
