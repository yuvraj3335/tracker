import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function NotFound() {
  return (
    <div className="mx-auto mt-10 max-w-md sm:mt-20">
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div>
            <h1 className="text-sm font-semibold">Nothing here</h1>
            <p className="mt-1 text-xs text-ink-muted">
              That page does not exist, or the prep area was renamed in Notion.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href="/">Back to today</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/areas/dsa">Open the sheet</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
