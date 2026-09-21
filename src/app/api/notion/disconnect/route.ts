import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/tenant';
import { deleteConnection } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Forgets the stored Notion token AND the database ids. Nothing is deleted
 * inside the user's Notion — their databases and progress stay exactly where
 * they are — but the app no longer knows about them, so reconnecting builds a
 * fresh set rather than adopting the old one. That is the safe direction:
 * pointing a new connection at databases we can no longer verify is how rows
 * get written twice.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  await deleteConnection(user.id);
  return NextResponse.redirect(new URL('/setup', req.url), 303);
}
