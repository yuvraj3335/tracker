import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/tenant';
import { deleteConnection } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Forgets the stored Notion token and database ids. Nothing is deleted inside
 * the user's Notion — their databases and progress stay exactly as they are,
 * so reconnecting picks up where they left off.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  await deleteConnection(user.id);
  return NextResponse.redirect(new URL('/setup', req.url), 303);
}
