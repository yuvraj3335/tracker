import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { getAreas, getTasks, getTopics, type Task } from '@/lib/notion';
import { isConfigured, missingEnv } from '@/lib/env';
import { groupByHeading, topicProgress } from '@/lib/derive';
import { pct } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/progress-bar';
import { TaskRow } from '@/components/task-row';
import { SetupNotice } from '@/components/setup-notice';
import { cn } from '@/lib/utils';

export const revalidate = 60;

type Filter = 'all' | 'todo' | 'done' | 'bookmarked' | 'revisit';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'todo', label: 'To do' },
  { key: 'done', label: 'Done' },
  { key: 'bookmarked', label: 'Saved' },
  { key: 'revisit', label: 'Revisit' },
];

function applyFilter(tasks: Task[], f: Filter) {
  switch (f) {
    case 'todo': return tasks.filter((t) => !t.done);
    case 'done': return tasks.filter((t) => t.done);
    case 'bookmarked': return tasks.filter((t) => t.bookmarked);
    case 'revisit': return tasks.filter((t) => t.revisit);
    default: return tasks;
  }
}

export default async function AreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ f?: string; open?: string }>;
}) {
  const { slug } = await params;
  const { f = 'all', open } = await searchParams;
  const filter = (FILTERS.some((x) => x.key === f) ? f : 'all') as Filter;

  if (!isConfigured()) {
    return <SetupNotice missing={missingEnv()} />;
  }

  const [areas, topics, tasks] = await Promise.all([getAreas(), getTopics(), getTasks()]);
  const area = areas.find((a) => a.slug === slug || a.id === slug);
  if (!area) notFound();

  const areaTopics = topics.filter((t) => t.areaIds.includes(area.id));
  const areaTasks = tasks.filter((t) => t.areaIds.includes(area.id));
  const rows = topicProgress(areaTopics, areaTasks);

  const done = areaTasks.filter((t) => t.done).length;
  const total = areaTasks.length;

  // Default to the topic in progress so the page opens where you left off.
  const inProgress = rows.find((r) => r.done > 0 && r.done < r.total);
  const openId = open ?? inProgress?.topic.id ?? rows[0]?.topic.id;

  return (
    <div className="space-y-4">
      <div className="px-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {area.emoji ? `${area.emoji} ` : ''}
          {area.name}
        </h1>
        <p className="mt-0.5 text-xs text-ink-muted sm:text-sm">
          {done} of {total} done · {pct(done, total)}% · {areaTopics.length} sections
        </p>
        <div className="mt-2.5">
          <ProgressBar value={total ? (done / total) * 100 : 0} height={8} label="Area progress" />
        </div>
      </div>

      {/* Filters sit in one row above the content */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {FILTERS.map((x) => {
          const count = applyFilter(areaTasks, x.key).length;
          return (
            <Link
              key={x.key}
              href={`?f=${x.key}${open ? `&open=${open}` : ''}`}
              scroll={false}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filter === x.key
                  ? 'border-transparent bg-accent text-accent-ink'
                  : 'border-hairline text-ink-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {x.label}
              <span className="ml-1 opacity-70 tnum">{count}</span>
            </Link>
          );
        })}
      </div>

      <div className="space-y-2.5">
        {rows.map((row) => {
          const topicTasks = applyFilter(
            areaTasks.filter((t) => t.topicIds.includes(row.topic.id)),
            filter,
          );
          const headings = groupByHeading(topicTasks);
          const isOpen = row.topic.id === openId;

          return (
            <Card key={row.topic.id} className="overflow-hidden">
              <details open={isOpen} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-2 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-90" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{row.topic.name}</span>
                      <span className="shrink-0 text-xs text-ink-muted tnum">
                        {row.done}/{row.total}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <ProgressBar
                        value={row.pct}
                        height={4}
                        color={
                          row.pct === 100
                            ? 'var(--good)'
                            : row.pct > 0
                              ? 'var(--series-1)'
                              : 'var(--axis)'
                        }
                        label={`${row.topic.name} progress`}
                      />
                    </div>
                  </div>
                </summary>

                <div className="border-t border-hairline">
                  {headings.length ? (
                    headings.map((h) => (
                      <section key={h.heading}>
                        {/* Heading rows are categories, not questions — they are
                            never counted toward any total. */}
                        <div className="flex items-baseline justify-between gap-2 bg-surface-2/60 px-4 py-1.5 sm:px-5">
                          <h3 className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                            {h.heading}
                          </h3>
                          <span className="shrink-0 text-[10px] text-ink-muted tnum">
                            {h.done}/{h.total}
                          </span>
                        </div>
                        <ul>
                          {h.items.map((t) => (
                            <TaskRow key={t.id} task={t} index={t.order + 1} />
                          ))}
                        </ul>
                      </section>
                    ))
                  ) : (
                    <p className="px-4 py-3 text-xs text-ink-muted sm:px-5">
                      Nothing here with this filter.
                    </p>
                  )}
                </div>
              </details>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
