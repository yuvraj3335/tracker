import { FocusTimer } from '@/components/focus-timer';
import { env } from '@/lib/env';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Focus · Job Switch Tracker' };

/**
 * The focus timer's own route.
 *
 * No data, no Notion call, no skeleton — everything on it is client state that
 * lives for one sitting. The signed-in gate is the proxy's, like every other
 * route that is not explicitly public.
 */
export default function FocusPage() {
  return (
    <div className="js-content-in space-y-4">
      <PageHeader
        title="Focus"
        sub="A countdown for one sitting. Nothing here is logged — ticking a question is still the only input."
      />
      {/* The same zone that decides when a day rolls over for streaks and
          the heatmap, so the clock here and the date on the dashboard cannot
          disagree about what day it is. */}
      <FocusTimer timeZone={env.timezone} />
    </div>
  );
}
