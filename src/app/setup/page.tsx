import { redirect } from 'next/navigation';
import { tenantStatus } from '@/lib/tenant';
import { TOTAL_QUESTIONS } from '@/lib/provision';
import { hasEncryptionKey } from '@/lib/crypto';
import { SetupFlow } from '@/components/setup-flow';
import { AuthShell, FormError } from '@/components/auth-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up · Job Switch Tracker' };

export default async function SetupPage() {
  const status = await tenantStatus();

  if (status.kind === 'anonymous') redirect('/login');
  if (status.kind === 'ready') redirect('/');

  // Resume exactly where they left off, even after closing the tab.
  const step =
    status.kind === 'needs_token'
      ? 'token'
      : status.kind === 'needs_page'
        ? 'page'
        : status.kind === 'error'
          ? status.connection.areasDs
            ? 'seeding'
            : 'page'
          : 'seeding';

  const cursor = 'connection' in status ? status.connection.provisionCursor : 0;
  const error = 'connection' in status ? status.connection.provisionError : null;

  return (
    <AuthShell title="Set up your tracker" subtitle={`Signed in as ${status.user.username}`}>
      {!hasEncryptionKey() ? (
        <div className="mb-4">
          <FormError message="This server has no ENCRYPTION_KEY set, so it cannot store Notion tokens safely. Set it and redeploy." />
        </div>
      ) : null}
      <SetupFlow
        initialStep={step}
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
