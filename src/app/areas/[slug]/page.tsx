import { notFound } from 'next/navigation';
import { getEverything } from '@/lib/notion';
import { requireReady } from '@/lib/tenant';
import { pct } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { ProgressBar } from '@/components/progress-bar';
import { Sheet } from '@/components/sheet';

export const dynamic = 'force-dynamic';

/**
 * One prep area's full sheet.
 *
 * The server fetches and scopes the data; the list itself is a client component
 * so search, filtering and keyboard navigation are instant over rows that are
 * already loaded. Filtering used to be a `?f=` link, which meant a full round
 * trip — and five paginated Notion calls — to hide rows already on screen.
 */
export default async function AreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { slug } = await params;
  const { f } = await searchParams;

  const tenant = await requireReady();
  const { areas, topics, tasks } = await getEverything(tenant);
  const area = areas.find((a) => a.slug === slug || a.id === slug);
  if (!area) notFound();

  const areaTopics = topics.filter((t) => t.areaIds.includes(area.id));
  const areaTasks = tasks.filter((t) => t.areaIds.includes(area.id));
  const done = areaTasks.filter((t) => t.done).length;
  const total = areaTasks.length;

  return (
    <div className="js-content-in space-y-4">
      <div className="space-y-2.5">
        <PageHeader
          title={`${area.emoji ? area.emoji + ' ' : ''}${area.name}`}
          sub={`${done} of ${total} done · ${pct(done, total)}% · ${areaTopics.length} sections`}
        />
        <div className="px-1">
          <ProgressBar value={total ? (done / total) * 100 : 0} height={8} label="Area progress" />
        </div>
      </div>

      <Sheet
        topics={areaTopics}
        tasks={areaTasks}
        areaName={area.name}
        initialFilter={f}
      />
    </div>
  );
}
