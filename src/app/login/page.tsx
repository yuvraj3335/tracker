import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/tenant';
import { hasDatabase } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { AuthShell, AuthLink, Field, FormError } from '@/components/auth-shell';
import { safeNextPath } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Job Switch Tracker' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; u?: string }>;
}) {
  const { error, next: rawNext, u } = await searchParams;
  // Sanitised once, here, so the value that reaches the redirect and the value
  // carried in the form are the same one. They used to be checked separately
  // and by different rules.
  const next = safeNextPath(rawNext);

  // Already signed in? Nothing to do here.
  if (await currentUser()) redirect(next);

  return (
    <AuthShell
      title="Sign in"
      subtitle="Pick up where you left off."
      footer={
        <>
          No account yet? <AuthLink href="/signup">Create one</AuthLink>
        </>
      }
    >
      {!hasDatabase() ? (
        <FormError message="Signing in is unavailable right now. Please try again shortly." />
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
