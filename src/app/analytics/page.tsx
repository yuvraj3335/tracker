import { getEverything } from '@/lib/notion';
import { requireReady } from '@/lib/tenant';
import {
  difficultyBreakdown,
  rollingAverage,
  streaks,
  summarize,
  topicProgress,
  velocity,
  countsByDay,
} from '@/lib/derive';
import { pct } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatTile } from '@/components/stat-tile';
import { PageHeader } from '@/components/page-header';
import { ProgressBar } from '@/components/progress-bar';
import { VelocityChart } from '@/components/velocity-chart';

export const dynamic = 'force-dynamic';

const DIFF_COLOR: Record<string, string> = {
  Easy: 'var(--diff-easy)',
  Medium: 'var(--diff-medium)',
  Hard: 'var(--diff-hard)',
};

export default async function AnalyticsPage() {
  const tenant = await requireReady();
  const { areas, topics, tasks } = await getEverything(tenant);

  const stats = summarize(areas, tasks);
  const s = streaks(tasks);
  const series = velocity(tasks, 30);
  const avg = rollingAverage(series, 7);
  const rows = topicProgress(topics, tasks);
  const diff = difficultyBreakdown(tasks);
  const counts = countsByDay(tasks);

  const remaining = stats.overall.total - stats.overall.done;
  const perDay = stats.perActiveDay;
  const etaDays = perDay > 0 ? Math.ceil(remaining / perDay) : null;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="js-content-in space-y-4">
      <PageHeader title="Analytics" sub="All derived from your Notion databases." />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        <StatTile
          label="Completed"
          value={stats.overall.done}
          sub={`of ${stats.overall.total} · ${pct(stats.overall.done, stats.overall.total)}%`}
        />
        <StatTile label="Remaining" value={remaining} sub="questions" />
        <StatTile
          label="Per active day"
          value={perDay ? perDay.toFixed(1) : '—'}
          sub={`${stats.activeDays} active day${stats.activeDays === 1 ? '' : 's'}`}
        />
        <StatTile
          label="At this pace"
          value={etaDays ? `${etaDays}d` : '—'}
          sub={etaDays ? 'to finish' : 'need more data'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last 30 days</CardTitle>
          <CardDescription>Questions completed per day, and the 7-day average.</CardDescription>
        </CardHeader>
        <CardContent>
          <VelocityChart series={series} average={avg} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Streaks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Current streak" value={`${s.current} day${s.current === 1 ? '' : 's'}`} />
            <Row label="Longest streak" value={`${s.longest} day${s.longest === 1 ? '' : 's'}`} />
            <Row label="Active days" value={String(stats.activeDays)} />
            <Row
              label="Best day"
              value={best ? `${best[1]} on ${best[0]}` : '—'}
            />
            <Row label="Last active" value={s.lastActive ?? '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By difficulty</CardTitle>
            <CardDescription>
              {diff.unset.total > 0
                ? `${diff.unset.total} questions have no difficulty set — the source sheet does not carry it.`
                : 'Every question has a difficulty.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {diff.rows.map((r) => (
              <div key={r.difficulty}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-ink-2">{r.difficulty}</span>
                  <span className="text-xs text-ink-muted tnum">
                    {r.done} / {r.total}
                    {r.total ? ` · ${pct(r.done, r.total)}%` : ''}
                  </span>
                </div>
                <ProgressBar
                  value={r.total ? (r.done / r.total) * 100 : 0}
                  color={DIFF_COLOR[r.difficulty]}
                  label={`${r.difficulty} progress`}
                />
              </div>
            ))}
            {diff.unset.total > 0 ? (
              <div className="border-t border-hairline pt-2.5">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-ink-muted">Not set</span>
                  <span className="text-xs text-ink-muted tnum">
                    {diff.unset.done} / {diff.unset.total}
                  </span>
                </div>
                <ProgressBar
                  value={(diff.unset.done / diff.unset.total) * 100}
                  color="var(--axis)"
                  label="Unset difficulty progress"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By section</CardTitle>
          <CardDescription>
            All {rows.length} sections, in the sheet&apos;s original order.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.topic.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-ink-2">{r.topic.name}</span>
                {/* Direct label on every bar — no number is ever color-only */}
                <span className="shrink-0 text-xs text-ink-muted tnum">
                  {r.done} / {r.total} · {pct(r.done, r.total)}%
                </span>
              </div>
              <ProgressBar
                value={r.pct}
                color={r.pct === 100 ? 'var(--good)' : 'var(--accent)'}
                label={`${r.topic.name} progress`}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-sm font-medium tnum">{value}</span>
    </div>
  );
}
