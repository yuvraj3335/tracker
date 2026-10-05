import { NextResponse } from 'next/server';
import { currentUser, tokenOf } from '@/lib/tenant';
import {
  claimSheetMigrationLease, finishSheetMigration, getConnection,
  releaseSheetMigrationLease, saveSheetMigrationProgress,
} from '@/lib/db';
import { MIGRATION_TOTAL, migrateSheetChunk } from '@/lib/sheet-migration';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const c = await getConnection(user.id);
  if (!c) return NextResponse.json({ error: 'Connect Notion first.' }, { status: 409 });
  return NextResponse.json({
    cursor: c.sheetVersion >= 2 ? MIGRATION_TOTAL : c.sheetMigrationCursor,
    total: MIGRATION_TOTAL,
    done: c.sheetVersion >= 2,
    error: c.sheetMigrationError,
  });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const c = await getConnection(user.id);
  if (!c || c.provisionState !== 'ready' || !c.tasksDs || !c.topicPageIds) {
    return NextResponse.json({ error: 'Finish connecting Notion first.' }, { status: 409 });
  }
  if (c.sheetVersion >= 2) {
    return NextResponse.json({ cursor: MIGRATION_TOTAL, total: MIGRATION_TOTAL, done: true });
  }
  const cursor = await claimSheetMigrationLease(user.id);
  if (cursor === null) return NextResponse.json({ error: 'Migration is already running in another tab.' }, { status: 409 });
  try {
    const token = tokenOf(c);
    const result = await migrateSheetChunk(c, token, cursor);
    if (result.error) {
      await saveSheetMigrationProgress(user.id, result.cursor, result.error);
      return NextResponse.json({ error: result.error, cursor: result.cursor }, { status: 400 });
    }
    await saveSheetMigrationProgress(user.id, result.cursor, null);
    if (result.done) await finishSheetMigration(user.id);
    return NextResponse.json({ cursor: result.cursor, total: MIGRATION_TOTAL, done: result.done });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Migration could not continue.';
    await saveSheetMigrationProgress(user.id, cursor, message);
    return NextResponse.json({ error: message, cursor }, { status: 400 });
  } finally {
    await releaseSheetMigrationLease(user.id);
  }
}
