import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Check, TriangleAlert } from 'lucide-react';
import { tenantStatus } from '@/lib/tenant';
import { setupStage } from '@/lib/setup';
import { TOTAL_QUESTIONS } from '@/lib/provision';
import { hasEncryptionKey } from '@/lib/crypto';
import { SetupFlow } from '@/components/setup-flow';
import { AuthShell, FormError } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up · Job Switch Tracker' };

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ disconnect?: string }>;
}) {
  const status = await tenantStatus();
  const { disconnect } = await searchParams;

  if (status.kind === 'anonymous') redirect('/login');

  // Resume exactly where they left off, even after closing the tab.
  const stage = setupStage(status.kind, Boolean('connection' in status && status.connection.areasDs));

  // An already-connected user used to be redirected straight back to the
  // dashboard from here, which made this route unreachable for everyone who
  // had finished setup — including from the nav's own account link and the
  // command palette's "Notion connection". It shows the connection instead.
  if (stage === 'connected') {
    return (
      <Connected username={status.user.username} confirmingDisconnect={disconnect === '1'} />
    );
  }

  const cursor = 'connection' in status ? status.connection.provisionCursor : 0;
  const error = 'connection' in status ? status.connection.provisionError : null;

  return (
    <AuthShell title="Set up your tracker" subtitle={`Signed in as ${status.user.username}`}>
      {!hasEncryptionKey() ? (
        <div className="mb-4">
          <FormError message="Setup is unavailable right now. Please try again shortly." />
        </div>
      ) : null}
      <SetupFlow
        initialStep={stage as 'token' | 'page' | 'seeding'}
        initialCursor={cursor}
        initialTotal={TOTAL_QUESTIONS}
        initialError={error}
      />
      <form action="/api/auth/signout" method="post" className="mt-6">
        <button type="submit" className="text-xs text-ink-muted underline-offset-2 hover:underline">
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}

/**
 * What an already-connected account sees here.
 *
 * Disconnecting is a real decision, not a button: reconnecting builds a fresh
 * set of databases rather than adopting the old ones (see the disconnect
 * route), so the tracker would come back empty while the real progress sits in
 * Notion under databases the app no longer knows about. It therefore takes two
 * steps, and the second one says what will actually happen.
 */
function Connected({
  username,
  confirmingDisconnect,
}: {
  username: string;
  confirmingDisconnect: boolean;
}) {
  return (
    <AuthShell title="Your tracker" subtitle={`Signed in as ${username}`}>
      <div className="skin-card flex items-start gap-2.5 border border-hairline bg-surface-2 px-3 py-2.5">
        <Check className="mt-px size-4 shrink-0 text-good-text" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Notion is connected.</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Your areas, topics, tasks and daily tracker are all wired up. Everything you tick
            is written straight into your own workspace.
          </p>
        </div>
      </div>

      <Button asChild className="mt-4 min-h-11 w-full">
        <Link href="/">
          Open the tracker
          <ArrowRight className="size-4" />
        </Link>
      </Button>

      <div className="mt-6 border-t border-hairline pt-4">
        {confirmingDisconnect ? (
          <>
            <div className="skin-card flex items-start gap-2.5 border border-hairline bg-surface-2 px-3 py-2.5">
              <TriangleAlert className="mt-px size-4 shrink-0 text-critical" aria-hidden />
              <p className="text-xs text-ink-2">
                Nothing in your Notion is deleted — your questions and everything you have
                ticked stay exactly where they are. But connecting again builds a fresh set of
                databases rather than adopting the old ones, so the tracker would open empty
                and your existing pages would be left behind.
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <form action="/api/notion/disconnect" method="post">
                <Button type="submit" variant="outline" className="min-h-11">
                  Yes, disconnect Notion
                </Button>
              </form>
              <Button asChild variant="ghost" className="min-h-11">
                <Link href="/setup">Keep it connected</Link>
              </Button>
            </div>
          </>
        ) : (
          <Link
            href="/setup?disconnect=1"
            className="inline-flex min-h-11 items-center text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Disconnect Notion
          </Link>
        )}
      </div>

      <form action="/api/auth/signout" method="post" className="mt-5">
        <button type="submit" className="text-xs text-ink-muted underline-offset-2 hover:underline">
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
