'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Route-level error boundary.
 *
 * Reading a tracker means several Notion calls, and Notion rate-limits and
 * occasionally times out. Without this, any of that showed the browser's raw
 * "server error" page. The message stays generic on purpose — the underlying
 * text can contain workspace details that are not useful to show.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);

  return (
    <div className="mx-auto mt-10 max-w-md sm:mt-20">
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
              <TriangleAlert className="size-4 text-critical" />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold">That did not load</h1>
              <p className="mt-1 text-xs text-ink-muted">
                This usually clears up on its own. Try again in a moment.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={reset} size="sm">
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Back to today</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/setup">Check your connection</Link>
            </Button>
          </div>

          {error.digest ? (
            <p className="text-micro text-ink-muted">Reference: {error.digest}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
