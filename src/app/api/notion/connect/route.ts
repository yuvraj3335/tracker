import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/tenant';
import { ensureSchema, saveToken } from '@/lib/db';
import { hasEncryptionKey, sealToken } from '@/lib/crypto';
import { friendlyNotionError, validateToken } from '@/lib/provision';

export const runtime = 'nodejs';

/**
 * Stores the user's Notion integration secret.
 *
 * The token is checked against Notion before being saved, so a typo is caught
 * here rather than surfacing as a mysterious failure later. It is encrypted at
 * rest with AES-256-GCM: this server holds other people's workspace access, and
 * that must not sit in the database as plaintext.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  if (!hasEncryptionKey()) {
    return NextResponse.json(
      { error: 'Connecting Notion is unavailable right now. Please try again shortly.' },
      { status: 500 },
    );
  }

  let token = '';
  try {
    const body = await req.json();
    token = String(body?.token ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }

  if (!token) return NextResponse.json({ error: 'Paste your Notion secret.' }, { status: 400 });
  if (!/^(ntn_|secret_)/.test(token)) {
    return NextResponse.json(
      { error: 'Notion secrets start with "ntn_" (or "secret_" on older integrations).' },
      { status: 400 },
    );
  }

  try {
    const who = await validateToken(token);
    await ensureSchema();
    await saveToken(user.id, sealToken(token));
    return NextResponse.json({ ok: true, workspace: who.name });
  } catch (e) {
    return NextResponse.json({ error: friendlyNotionError(e) }, { status: 400 });
  }
}
