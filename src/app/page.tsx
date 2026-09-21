import Link from 'next/link';
import { Flame, CalendarCheck, Target, TrendingUp, ArrowRight } from 'lucide-react';
import { getEverything } from '@/lib/notion';
import { requireReady } from '@/lib/tenant';
import { env } from '@/lib/env';
import { activityByDay, areaProgress, countsByDay, summarize, topicProgress } from '@/lib/derive';
import { formatKey, todayKey } from '@/lib/date';
import { pct } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatTile } from '@/components/stat-tile';
import { ProgressBar } from '@/components/progress-bar';
import { Heatmap } from '@/components/heatmap';
import { TaskRow } from '@/components/task-row';

// Per-user data: must never be prerendered at build time or cached across
// users. The Notion layer's own 60s cache is what keeps this fast.
export const dynamic = 'force-dynamic';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

export default async function Dashboard() {
  const tenant = await requireReady();
  const { areas, topics, tasks } = await getEverything(tenant);
  const today = todayKey();
  const stats = summarize(areas, tasks);
  const byDay = activityByDay(tasks);
  const todayTasks = byDay.get(today) ?? [];
  const counts = Object.fromEntries(countsByDay(tasks));

  // Next up: the first unsolved questions in original sheet order.
  const nextUp = tasks.filter((t) => !t.done).slice(0, 5);
  const tp = topicProgress(topics, tasks);
  const ap = areaProgress(areas, tasks);
  const currentTopic = tp.find((r) => r.done > 0 && r.done < r.total) ?? tp.find((r) => r.done === 0);

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTitle title="Today" sub={formatKey(today, 'EEEE, d MMMM yyyy')} />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        <StatTile
          label="Done today"
          value={stats.todayCount}
          sub={stats.todayCount === 0 ? 'nothing yet' : 'questions'}
          accent={stats.todayCount > 0 ? 'var(--good-text)' : undefined}
        />
        <StatTile
          label="Streak"
          value={stats.streak.current}
          sub={`longest ${stats.streak.longest}`}
          accent={stats.streak.current > 0 ? 'var(--series-2)' : undefined}
        />
        <StatTile
          label="Overall"
          value={`${pct(stats.overall.done, stats.overall.total)}%`}
          sub={`${stats.overall.done} / ${stats.overall.total}`}
        />
        <StatTile label="Last 7 days" value={stats.last7Total} sub="questions" />
      </div>

      {/* ---- Job Switch progress, with DSA folded in automatically ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Target className="size-3.5 text-ink-muted" />
            Job Switch progress
          </CardTitle>
          <CardDescription>
            Weighted across every prep area. Add an area in Notion and it appears here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3.5">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-medium text-ink-2">All areas</span>
              <span className="text-sm font-semibold tnum">
                {pct(stats.overall.done, stats.overall.total)}%
              </span>
            </div>
            <ProgressBar
              value={stats.overall.pct}
              height={8}
              label="Overall Job Switch progress"
            />
          </div>

          <div className="space-y-2.5 border-t border-hairline pt-3">
            {ap.map(({ area: a, total, done }, i) => {
              return (
                <div key={a.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <Link
                      href={`/areas/${a.slug || a.id}`}
                      className="truncate text-xs font-medium text-ink-2 hover:text-accent"
                    >
                      {a.emoji ? `${a.emoji} ` : ''}
                      {a.name}
                      {a.status !== 'Active' ? (
                        <span className="ml-1.5 text-[10px] text-ink-muted">({a.status})</span>
                      ) : null}
                    </Link>
                    {/* Direct label — also discharges the sub-3:1 contrast relief rule */}
                    <span className="shrink-0 text-xs text-ink-muted tnum">
                      {done} / {total} · {pct(done, total)}%
                    </span>
                  </div>
                  <ProgressBar
                    value={total ? (done / total) * 100 : 0}
                    color={SERIES[i % SERIES.length]}
                    label={`${a.name} progress`}
                  />
                </div>
              );
            })}
            {ap.length === 0 ? (
              <p className="text-xs text-ink-muted">No areas yet — run the seed script.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ---- Activity heatmap, from Notion activity ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Flame className="size-3.5 text-ink-muted" />
            Activity
          </CardTitle>
          <CardDescription>
            Built from <code className="text-[11px]">Completed On</code> in Notion. Tap any day to
            see what you did.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Heatmap counts={counts} />
        </CardContent>
      </Card>

      {/* ---- Today's log: derived, never typed in twice ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <CalendarCheck className="size-3.5 text-ink-muted" />
            What you did today
          </CardTitle>
          <CardDescription>
            Appears automatically when you tick a question. Nothing to log separately.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0 sm:px-0 sm:pb-0">
          {todayTasks.length ? (
            <ul>
              {todayTasks.map((t, i) => (
                <TaskRow key={t.id} task={t} index={i + 1} />
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5 sm:pb-5">
              Nothing yet today. Pick one up below.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Next up ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <TrendingUp className="size-3.5 text-ink-muted" />
            Next up
          </CardTitle>
          <CardDescription>
            {currentTopic
              ? `Next in sheet order — you're in ${currentTopic.topic.name}.`
              : 'Next in sheet order.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0 sm:px-0 sm:pb-0">
          {nextUp.length ? (
            <>
              <ul>
                {nextUp.map((t, i) => (
                  <TaskRow key={t.id} task={t} index={i + 1} />
                ))}
              </ul>
              <div className="px-4 py-3 sm:px-5">
                <Link
                  href="/areas/dsa"
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  Open the full sheet
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            </>
          ) : (
            <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5 sm:pb-5">
              Every question is done. That is the whole sheet. 🎉
            </p>
          )}
        </CardContent>
      </Card>

      <p className="px-1 pb-2 text-center text-[10px] text-ink-muted">
        Days roll over at midnight {env.timezone.replace('_', ' ')}
      </p>
    </div>
  );
}

function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-1">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      {sub ? <p className="mt-0.5 text-xs text-ink-muted sm:text-sm">{sub}</p> : null}
    </div>
  );
}
