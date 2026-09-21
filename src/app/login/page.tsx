import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Sign in · Job Switch Tracker' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next = '/' } = await searchParams;

  return (
    <div className="mx-auto mt-12 max-w-sm sm:mt-24">
      <Card>
        <CardHeader>
          <CardTitle>Job Switch Tracker</CardTitle>
        </CardHeader>
        <CardContent>
          <form action="/api/auth" method="post" className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-ink-2">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </div>
            {error ? (
              <p className="text-xs text-critical" role="alert">
                Wrong password.
              </p>
            ) : null}
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
