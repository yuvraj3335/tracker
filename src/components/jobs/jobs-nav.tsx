'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/jobs', label: 'Pipeline' },
  { href: '/jobs/new', label: 'Add a job' },
  { href: '/jobs/profile', label: 'Profile' },
  { href: '/jobs/connect', label: 'Connect AI' },
];

/** The job section's own sub-navigation, under the page title. */
export function JobsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Jobs" className="-mx-1 flex gap-1 overflow-x-auto px-1">
      {TABS.map((t) => {
        const active = t.href === '/jobs' ? pathname === '/jobs' : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'skin-pill shrink-0 border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
              active ? 'border-transparent bg-surface-2 text-ink' : 'border-hairline text-ink-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
