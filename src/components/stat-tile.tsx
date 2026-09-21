import { cn } from '@/lib/utils';

/**
 * A single headline number. No plot, so no hover layer — the one form the
 * interaction rule exempts.
 */
export function StatTile({
  label,
  value,
  sub,
  accent,
  className,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-hairline bg-surface p-3 sm:p-4', className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div
        className="mt-1 text-2xl leading-none font-semibold sm:text-3xl"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-ink-muted">{sub}</div> : null}
    </div>
  );
}
