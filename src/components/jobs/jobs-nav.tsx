'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Columns3, Plus, Sparkles, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/jobs', label: 'Pipeline', icon: Columns3 },
  { href: '/jobs/new', label: 'Add a job', icon: Plus },
  { href: '/jobs/profile', label: 'Profile', icon: UserRound },
  { href: '/jobs/connect', label: 'Connect AI', icon: Sparkles },
];

/** The job section's own navigation: a segmented control under the page title. */
export function JobsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Jobs" className="-mx-1 overflow-x-auto px-1">
      <div className="skin-pill inline-flex gap-0.5 border border-hairline bg-surface-2 p-0.5">
        {TABS.map((t) => {
          const active = t.href === '/jobs' ? pathname === '/jobs' || /^\/jobs\/[0-9a-f-]{32,36}$/i.test(pathname) : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'skin-pill inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                active ? 'bg-surface text-ink shadow-lift-1' : 'text-ink-muted hover:text-ink',
              )}
            >
              <t.icon className="size-3.5" aria-hidden />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
