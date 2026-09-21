'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarDays, ChartNoAxesColumn, ListChecks, LogOut } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { SkinPicker } from './skin-picker';
import { CharacterPicker } from './character-picker';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Today', icon: LayoutDashboard },
  { href: '/areas/dsa', label: 'DSA', icon: ListChecks },
  { href: '/daily', label: 'Daily', icon: CalendarDays },
  { href: '/analytics', label: 'Stats', icon: ChartNoAxesColumn },
];

/** Screens that own the whole viewport and should not show app chrome. */
const BARE = ['/login', '/signup', '/setup'];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

/** Top bar on laptop, thumb-reachable bottom bar on phone. */
export function Nav({ username }: { username: string | null }) {
  const pathname = usePathname();

  // Signed out, or on a full-screen auth page: no chrome at all.
  if (!username || BARE.some((p) => pathname.startsWith(p))) return null;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-hairline bg-plane/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-4">
          <Link href="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-6 place-items-center rounded-md bg-accent text-meta text-accent-ink">
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

          <div className="ml-auto flex items-center gap-0.5 sm:ml-2">
            <Link
              href="/setup"
              className="skin-pill hidden max-w-[8rem] truncate px-2.5 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:block"
              title="Your account"
            >
              {username}
            </Link>
            <CharacterPicker />
            <SkinPicker />
            <ThemeToggle />
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                aria-label="Sign out"
                className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <LogOut className="size-4" />
              </button>
            </form>
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
                  'flex flex-col items-center gap-0.5 py-2.5 text-micro font-medium transition-colors',
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
