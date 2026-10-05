'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProgressBar } from './progress-bar';
import { Button } from './ui/button';

/** The browser drives short, resumable Notion writes; closing this tab never
 * rewinds progress or deletes an old question. */
export function SheetMigrationFlow({ initialCursor, initialError }: {
  initialCursor: number;
  initialError: string | null;
}) {
  const router = useRouter();
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState(initialError);
  const [done, setDone] = useState(false);
  const running = useRef(false);
  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (true) {
        const res = await fetch('/api/notion/migrate', { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (typeof json.cursor === 'number') setCursor(json.cursor);
        if (!res.ok) throw new Error(json.error ?? 'Migration paused. Please try again.');
        if (json.done) {
          setDone(true);
          router.refresh();
          router.push('/');
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Migration paused.');
    } finally {
      running.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (error || done) return;
    const id = setTimeout(() => void run(), 0);
    return () => clearTimeout(id);
  }, [run, error, done]);

  const questions = Math.min(cursor, 455);
  return (
    <div className="space-y-4">
      <div className="skin-card border border-hairline bg-surface-2 p-4">
        <p className="text-sm font-medium text-ink">Moving to Codolio’s Striver A2Z sheet</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Your completed dates, bookmarks, revisit flags, notes and chosen difficulty stay in Notion.
          Duplicate and unmatched old questions are kept as Legacy records, not deleted.
        </p>
      </div>
      <ProgressBar value={(cursor / 475) * 100} height={8} label="Codolio migration progress" />
      <p className="text-xs text-ink-muted">
        {cursor <= 455 ? `${questions} of 455 questions updated` : 'Finishing sections and checking your progress…'}
      </p>
      {error ? (
        <div role="alert" className="space-y-3 rounded-lg border border-critical/40 p-3 text-sm">
          <p>{error}</p>
          <Button onClick={() => { setError(null); void run(); }}>Retry from {questions}</Button>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">Keep this tab open. You can come back later if you need to.</p>
      )}
    </div>
  );
}
