import { notFound } from 'next/navigation';
import { fixtures } from '@/lib/fixtures';
import { activityByDay, countsByDay, groupByHeading, rollingAverage, summarize, topicProgress, velocity, areaProgress, difficultyBreakdown } from '@/lib/derive';
import { pct } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatTile } from '@/components/stat-tile';
import { HeroProgress } from '@/components/hero-progress';
import { MoodBanner } from '@/components/mood-banner';
import { FocusTimer } from '@/components/focus-timer';
import { PageHeader } from '@/components/page-header';
import { HeadingBand } from '@/components/heading-band';
import { ProgressBar } from '@/components/progress-bar';
import { Heatmap } from '@/components/heatmap';
import { VelocityChart } from '@/components/velocity-chart';
import { TaskRow } from '@/components/task-row';
import { CharacterBadge, CharacterFigure } from '@/components/character-figure';
import { POSES } from '@/lib/characters';
import { DashboardSkeleton, SheetSkeleton } from '@/components/skeletons';
import { Sheet } from '@/components/sheet';

/**
 * Dev-only design harness. Renders the real components with sample data so the
 * UI can be reviewed in every skin and mode without a live Notion workspace.
 * 404s outside development, so it is never part of the shipped product.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Preview · dev only' };

export default function PreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const { areas, topics, tasks } = fixtures();
  const stats = summarize(areas, tasks);
  const counts = Object.fromEntries(countsByDay(tasks));
  const byDay = activityByDay(tasks);
  const today = [...byDay.values()][0] ?? [];
  const tp = topicProgress(topics, tasks);
  const ap = areaProgress(areas, tasks);
  const series = velocity(tasks, 30);
  const diff = difficultyBreakdown(tasks);
  const firstTopic = tp[0];
  const headings = groupByHeading(
    tasks.filter((t) => t.topicIds.includes(firstTopic.topic.id)),
  );

  return (
    <div className="space-y-6">
      <div className="skin-card border border-hairline bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
        <strong>Component preview.</strong> Sample data. Development only.
      </div>

      <Section title="Header and hero">
        <div className="space-y-4">
          <PageHeader title="Today" sub="Monday, 21 September 2026" />
          <HeroProgress
            done={stats.overall.done}
            total={stats.overall.total}
            streak={stats.streak.current}
            todayCount={stats.todayCount}
            greeting="Good evening"
          />
        </div>
      </Section>

      <Section title="Mood banner">
        <div className="space-y-3">
          <MoodBanner
            mood={{ key: 'slipping', cause: 'streak-broken', daysSinceActive: 5 }}
            next={{ name: 'Longest Subarray with sum K', href: '/areas/dsa' }}
          />
          <MoodBanner
            mood={{ key: 'slipping', cause: 'slowing', daysSinceActive: 1 }}
            next={{ name: 'Sort an array of 0s, 1s and 2s', href: '/areas/dsa' }}
          />
          <p className="px-1 text-xs text-ink-muted">
            Nothing renders for the strong and steady moods — those change the hero&rsquo;s
            own figure instead, and nothing renders once the sheet is finished either.
          </p>
        </div>
      </Section>

      <Section title="Stat tiles">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          <StatTile label="Done today" value={stats.todayCount} sub="questions" accent="var(--good-text)" />
          <StatTile label="Streak" value={stats.streak.current} sub={`longest ${stats.streak.longest}`} accent="var(--series-2)" />
          <StatTile label="Overall" value={`${pct(stats.overall.done, stats.overall.total)}%`} sub={`${stats.overall.done} / ${stats.overall.total}`} />
          <StatTile label="Last 7 days" value={stats.last7Total} sub="questions" />
        </div>
      </Section>

      <Section title="Area progress">
        <Card>
          <CardHeader>
            <CardTitle>Job Switch progress</CardTitle>
            <CardDescription>Weighted across every prep area.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {ap.map(({ area, total, done }) => (
              <div key={area.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-ink-2">{area.emoji} {area.name}</span>
                  <span className="text-xs text-ink-muted tnum">{done} / {total} · {pct(done, total)}%</span>
                </div>
                <ProgressBar
                  value={total ? (done / total) * 100 : 0}
                  color={total && done === total ? 'var(--good)' : 'var(--accent)'}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title="Heatmap">
        <Card>
          <CardContent className="pt-4">
            <Heatmap counts={counts} />
          </CardContent>
        </Card>
      </Section>

      <Section title="Velocity chart">
        <Card>
          <CardContent className="pt-4">
            <VelocityChart series={series} average={rollingAverage(series, 7)} />
          </CardContent>
        </Card>
      </Section>

      <Section title="Task rows">
        <Card className="overflow-hidden">
          <ul>
            {today.slice(0, 3).map((t, i) => (
              <TaskRow key={t.id} task={t} index={i + 1} />
            ))}
            {tasks.filter((t) => !t.done).slice(0, 3).map((t, i) => (
              <TaskRow key={t.id} task={t} index={i + 4} />
            ))}
            {tasks.filter((t) => t.bookmarked).slice(0, 2).map((t, i) => (
              <TaskRow key={t.id} task={t} index={i + 7} />
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="Heading bands">
        <Card className="overflow-hidden">
          {headings.slice(0, 2).map((h) => (
            <section key={h.heading}>
              <HeadingBand label={h.heading} count={`${h.done}/${h.total}`} />
              <ul>
                {h.items.slice(0, 3).map((t) => (
                  <TaskRow key={t.id} task={t} index={t.order + 1} remainingHeading={h.total - h.done} />
                ))}
              </ul>
            </section>
          ))}
        </Card>
      </Section>

      <Section title="Difficulty breakdown">
        <Card>
          <CardContent className="space-y-3 pt-4">
            {diff.rows.map((r) => (
              <div key={r.difficulty}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-xs font-medium text-ink-2">{r.difficulty}</span>
                  <span className="text-xs text-ink-muted tnum">{r.done} / {r.total}</span>
                </div>
                <ProgressBar
                  value={r.total ? (r.done / r.total) * 100 : 0}
                  color={`var(--diff-${r.difficulty.toLowerCase()})`}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title="Sheet">
        <Sheet topics={topics} tasks={tasks} areaName="DSA" />
      </Section>

      <Section title="Loading states">
        <div className="space-y-5">
          <DashboardSkeleton />
          <SheetSkeleton />
        </div>
      </Section>

      <Section title="Focus timer">
        <FocusTimer />
      </Section>

      {/* Every figure on this page is a live WebGL canvas, and browsers cap
          those at about sixteen per document — this harness renders roughly
          nineteen, so the last few come up blank with "Too many active WebGL
          contexts" in the console. That is this page showing everything at
          once, not a bug in the figures: the real routes peak at four (the
          hero, a mood figure, the celebration overlay and the companion). */}
      <Section title="Character poses">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-6 pt-4">
            {POSES.map((pose) => (
              <div key={pose} className="flex flex-col items-center gap-1.5">
                <CharacterFigure pose={pose} size={64} />
                <span className="text-micro tracking-wide text-ink-muted uppercase">{pose}</span>
              </div>
            ))}

          </CardContent>
        </Card>
      </Section>

      <Section title="Buttons">
        <Card>
          <CardContent className="space-y-4 pt-4">
            <div className="flex items-center gap-3">
              <CharacterBadge size={48} />
              <p className="text-sm text-ink-muted">Nothing yet today. Pick one up below.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button size="sm">Small</Button>
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-meta font-semibold tracking-widest text-ink-muted uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
