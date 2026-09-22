import Link from 'next/link';
import { Flame, CalendarCheck, Target, TrendingUp, ArrowRight } from 'lucide-react';
import { getEverything } from '@/lib/notion';
import { requireReady } from '@/lib/tenant';
import { env } from '@/lib/env';
import { activityByDay, areaProgress, countsByDay, performanceMood, summarize, topicProgress } from '@/lib/derive';
import { moodPose } from '@/lib/characters';
import { formatKey, greeting, todayKey } from '@/lib/date';
import { pct } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CharacterFigure } from '@/components/character-figure';
import { PageHeader } from '@/components/page-header';
import { HeroProgress } from '@/components/hero-progress';
import { MoodBanner } from '@/components/mood-banner';
import { ProgressBar } from '@/components/progress-bar';
import { Heatmap } from '@/components/heatmap';
import { TaskRow } from '@/components/task-row';

// Per-user data: must never be prerendered at build time or cached across
// users. The Notion layer's own 60s cache is what keeps this fast.
export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const tenant = await requireReady();
  const { areas, topics, tasks } = await getEverything(tenant);
  const today = todayKey();
  const stats = summarize(areas, tasks);
  const byDay = activityByDay(tasks);
  const todayTasks = byDay.get(today) ?? [];
  const counts = Object.fromEntries(countsByDay(tasks));
  // Built from the same `stats` the hero renders, so the banner under it can
  // never report a different version of the same week.
  const mood = performanceMood(tasks, stats);

  // Next up: the first unsolved questions in original sheet order.
  const nextUp = tasks.filter((t) => !t.done).slice(0, 5);
  const tp = topicProgress(topics, tasks);
  const ap = areaProgress(areas, tasks);
  // The banner's one action points at the area the next question actually
  // lives in, rather than assuming DSA.
  const nextArea = nextUp[0] ? areas.find((a) => nextUp[0].areaIds.includes(a.id)) : undefined;
  const nextAction = nextUp[0]
    ? { name: nextUp[0].name, href: `/areas/${nextArea?.slug || nextArea?.id || 'dsa'}` }
    : null;
  const currentTopic = tp.find((r) => r.done > 0 && r.done < r.total) ?? tp.find((r) => r.done === 0);

  return (
    <div className="js-content-in space-y-4 sm:space-y-5">
      <PageHeader title="Today" sub={formatKey(today, 'EEEE, d MMMM yyyy')} />

      <HeroProgress
        done={stats.overall.done}
        total={stats.overall.total}
        streak={stats.streak.current}
        todayCount={stats.todayCount}
        greeting={greeting()}
        day={today}
        pose={moodPose(mood)}
      />

      <MoodBanner mood={mood} next={nextAction} />

      {/* ---- Job Switch progress, with DSA folded in automatically ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Target className="size-3.5 text-ink-muted" />
            Job Switch progress
          </CardTitle>
          <CardDescription>
            Your progress across every area.
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
            {ap.map(({ area: a, total, done }) => {
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
                        <span className="ml-1.5 text-micro text-ink-muted">({a.status})</span>
                      ) : null}
                    </Link>
                    {/* Direct label — also discharges the sub-3:1 contrast relief rule */}
                    <span className="shrink-0 text-xs text-ink-muted tnum">
                      {done} / {total} · {pct(done, total)}%
                    </span>
                  </div>
                  <ProgressBar
                    value={total ? (done / total) * 100 : 0}
                    color={
                      total && done === total ? 'var(--good)' : 'var(--accent)'
                    }
                    label={`${a.name} progress`}
                  />
                </div>
              );
            })}
            {ap.length === 0 ? (
              <p className="text-xs text-ink-muted">Nothing here yet.</p>
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
            Your last year at a glance. Select any day to see what you did.
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
            Everything you have completed today.
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
            // The figure carries the mood; the words do not repeat it. Naming
            // the lapse and offering the next question is the banner's job at
            // the top of the page, and saying it twice on one screen is how a
            // gentle nudge turns into nagging.
            <div className="flex items-center gap-3 px-4 pb-4 sm:px-5 sm:pb-5">
              <CharacterFigure pose={moodPose(mood)} size={60} />
              <p className="min-w-0 text-sm text-ink-muted">Nothing yet today.</p>
            </div>
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
              ? `Pick up where you left off — you're in ${currentTopic.topic.name}.`
              : 'Your next questions, in order.'}
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
            <div className="flex items-center gap-3 px-4 pb-4 sm:px-5 sm:pb-5">
              <CharacterFigure pose="celebrate" size={48} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Every question is done.</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  That is the whole sheet.{' '}
                  <Link href="/analytics" className="font-medium text-accent hover:underline">
                    See how you got here
                  </Link>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="px-1 pb-2 text-center text-micro text-ink-muted">
        Days roll over at midnight {env.timezone.replace('_', ' ')}
      </p>
    </div>
  );
}
