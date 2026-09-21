import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/tenant';
import { hasDatabase } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { AuthShell, AuthLink, Field, FormError } from '@/components/auth-shell';
import { MIN_PASSWORD } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create account · Job Switch Tracker' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; u?: string }>;
}) {
  const { error, u } = await searchParams;
  if (await currentUser()) redirect('/');

  return (
    <AuthShell
      title="Create your account"
      subtitle="Takes a minute. You will connect Notion next."
      footer={
        <>
          Already have one? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      {!hasDatabase() ? (
        <FormError message="Creating an account is unavailable right now. Please try again shortly." />
      ) : null}

      <form action="/api/auth/signup" method="post" className="space-y-3">
        <Field
          label="Username"
          name="username"
          defaultValue={u}
          autoComplete="username"
          autoFocus
          hint="3–32 characters. Letters, numbers, dots, dashes, underscores."
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        <Field
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
        />
        <FormError message={error} />
        <Button type="submit" className="w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
