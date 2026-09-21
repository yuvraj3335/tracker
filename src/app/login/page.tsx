import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/tenant';
import { hasDatabase } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { AuthShell, AuthLink, Field, FormError } from '@/components/auth-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Job Switch Tracker' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; u?: string }>;
}) {
  const { error, next = '/', u } = await searchParams;

  // Already signed in? Nothing to do here.
  if (await currentUser()) redirect(next.startsWith('/') ? next : '/');

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your questions live in your own Notion. This just reads and writes them."
      footer={
        <>
          No account yet? <AuthLink href="/signup">Create one</AuthLink>
        </>
      }
    >
      {!hasDatabase() ? (
        <FormError message="This server has no DATABASE_URL set, so accounts cannot work yet." />
      ) : null}

      <form action="/api/auth/signin" method="post" className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <Field label="Username" name="username" defaultValue={u} autoComplete="username" autoFocus />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <FormError message={error ? 'Wrong username or password.' : undefined} />
        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
