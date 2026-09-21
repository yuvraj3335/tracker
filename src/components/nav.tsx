'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarDays, ChartNoAxesColumn, ListChecks } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Today', icon: LayoutDashboard },
  { href: '/areas/dsa', label: 'DSA', icon: ListChecks },
  { href: '/daily', label: 'Daily', icon: CalendarDays },
  { href: '/analytics', label: 'Stats', icon: ChartNoAxesColumn },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

/** Top bar on laptop, thumb-reachable bottom bar on phone. */
export function Nav() {
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-hairline bg-plane/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-4">
          <Link href="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-6 place-items-center rounded-md bg-accent text-[11px] text-accent-ink">
              JS
            </span>
            <span className="text-sm">Job Switch</span>
          </Link>

          <nav className="ml-auto hidden items-center gap-0.5 sm:flex">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive(pathname, l.href)
                    ? 'bg-surface-2 text-ink'
                    : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto sm:ml-1">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-plane/95 backdrop-blur-md sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-4">
          {LINKS.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
                  active ? 'text-accent' : 'text-ink-muted',
                )}
              >
                <l.icon className="size-[18px]" />
                {l.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
