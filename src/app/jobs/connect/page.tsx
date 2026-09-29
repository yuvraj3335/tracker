import { headers } from 'next/headers';
import { requireReady } from '@/lib/tenant';
import { ensureSchema, listApiKeys } from '@/lib/db';
import { PageHeader } from '@/components/page-header';
import { JobsNav } from '@/components/jobs/jobs-nav';
import { ConnectAI } from '@/components/jobs/connect-ai';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect AI · Job Switch Tracker' };

/** This deployment's own address, as the browser reached it — preview deploys included. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim();
  const proto = (h.get('x-forwarded-proto') ?? 'https').split(',')[0].trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `${proto === 'http' ? 'http' : 'https'}://${host}` : 'https://tracker-one-xi-95.vercel.app';
}

export default async function ConnectPage() {
  const tenant = await requireReady();
  await ensureSchema();
  const [keys, base] = await Promise.all([listApiKeys(tenant.userId), origin()]);
  return (
    <div className="js-content-in space-y-4">
      <PageHeader
        title="Connect AI"
        sub="Use the tracker from Claude Code, Codex, Gemini CLI, Cursor, Claude Desktop, claude.ai or your phone."
      />
      <JobsNav />
      <ConnectAI origin={base} keys={keys} />
    </div>
  );
}
