import Link from 'next/link';
import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';
import { getDailyNotes, getTasks, getTopics } from '@/lib/notion';
import { isConfigured, missingEnv } from '@/lib/env';
import { activityByDay, noteFor } from '@/lib/derive';
import { formatKey, isToday, shiftKey, todayKey, type DayKey } from '@/lib/date';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TaskRow } from '@/components/task-row';
import { SetupNotice } from '@/components/setup-notice';
import { cn } from '@/lib/utils';

export const revalidate = 60;

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  if (!isConfigured()) return <SetupNotice missing={missingEnv()} />;

  const { d } = await searchParams;
  const day: DayKey = d && KEY_RE.test(d) ? d : todayKey();

  const [tasks, topics, notes] = await Promise.all([getTasks(), getTopics(), getDailyNotes()]);
  const byDay = activityByDay(tasks);
  const dayTasks = byDay.get(day) ?? [];
  const note = noteFor(notes, day);

  const topicName = new Map(topics.map((t) => [t.id, t.name]));

  // Group the day's work by section, which is how you actually remember it.
  const bySection = new Map<string, typeof dayTasks>();
  for (const t of dayTasks) {
    const name = t.topicIds.map((id) => topicName.get(id)).find(Boolean) ?? 'Other';
    const list = bySection.get(name);
    if (list) list.push(t);
    else bySection.set(name, [t]);
  }

  // The look-back rail: most recent active days first.
  const activeDays = [...byDay.keys()].sort().reverse().slice(0, 30);
  const prev = shiftKey(day, -1);
  const next = shiftKey(day, 1);
  const isFuture = next > todayKey();

  return (
    <div className="space-y-4">
      <div className="px-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Daily Tracker</h1>
        <p className="mt-0.5 text-xs text-ink-muted sm:text-sm">
          Filled in automatically from when you tick each question.
        </p>
      </div>

      {/* Day switcher */}
      <div className="flex items-center gap-2">
        <Link
          href={`/daily?d=${prev}`}
          aria-label="Previous day"
          className="rounded-lg border border-hairline p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold">
            {isToday(day) ? 'Today' : formatKey(day, 'EEEE')}
          </div>
          <div className="text-[11px] text-ink-muted tnum">{formatKey(day, 'd MMMM yyyy')}</div>
        </div>
        <Link
          href={isFuture ? `/daily?d=${day}` : `/daily?d=${next}`}
          aria-label="Next day"
          aria-disabled={isFuture}
          className={cn(
            'rounded-lg border border-hairline p-2 text-ink-muted',
            isFuture ? 'pointer-events-none opacity-40' : 'hover:bg-surface-2 hover:text-ink',
          )}
        >
          <ChevronRight className="size-4" />
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {dayTasks.length
              ? `${dayTasks.length} question${dayTasks.length === 1 ? '' : 's'}`
              : 'Nothing logged'}
          </CardTitle>
          {bySection.size > 1 ? (
            <CardDescription>
              Across {bySection.size} sections: {[...bySection.keys()].join(', ')}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-0 sm:px-0 sm:pb-0">
          {dayTasks.length ? (
            [...bySection.entries()].map(([section, items]) => (
              <section key={section}>
                <div className="flex items-baseline justify-between bg-surface-2/60 px-4 py-1.5 sm:px-5">
                  <h3 className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                    {section}
                  </h3>
                  <span className="text-[10px] text-ink-muted tnum">{items.length}</span>
                </div>
                <ul>
                  {items.map((t, i) => (
                    <TaskRow key={t.id} task={t} index={i + 1} />
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5 sm:pb-5">
              {isToday(day)
                ? 'Nothing yet today.'
                : 'No questions were marked done on this day.'}
            </p>
          )}
        </CardContent>
      </Card>

      {note ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <NotebookPen className="size-3.5 text-ink-muted" />
              Note
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-ink-2">
            <p className="whitespace-pre-wrap">{note.note}</p>
            <p className="text-xs text-ink-muted">
              {note.hours ? `${note.hours}h` : null}
              {note.hours && note.mood ? ' · ' : null}
              {note.mood}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Look-back */}
      <Card>
        <CardHeader>
          <CardTitle>Recent active days</CardTitle>
          <CardDescription>Every day you got something done.</CardDescription>
        </CardHeader>
        <CardContent>
          {activeDays.length ? (
            <ul className="divide-y divide-[var(--border)]">
              {activeDays.map((k) => {
                const n = byDay.get(k)?.length ?? 0;
                return (
                  <li key={k}>
                    <Link
                      href={`/daily?d=${k}`}
                      className={cn(
                        '-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-2',
                        k === day && 'bg-surface-2',
                      )}
                    >
                      <span className={cn('tnum', k === day ? 'font-semibold' : 'text-ink-2')}>
                        {formatKey(k, 'EEE, d MMM')}
                        {isToday(k) ? (
                          <span className="ml-1.5 text-[10px] text-accent">today</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted tnum">{n}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">
              No activity recorded yet. Tick your first question and it shows up here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
