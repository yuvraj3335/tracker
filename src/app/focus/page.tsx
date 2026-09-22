import { FocusTimer } from '@/components/focus-timer';
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
      <FocusTimer />
    </div>
  );
}
