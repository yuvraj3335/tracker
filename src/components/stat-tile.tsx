import { cn } from '@/lib/utils';

/**
 * A single headline number. No plot, so no hover layer — the one form the
 * interaction rules exempt.
 *
 * The label sits above the value at a small size and the caption below it in
 * muted ink, so a row of tiles reads as one rhythm rather than three competing
 * text sizes per box.
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
    <div
      className={cn(
        'skin-card border border-hairline bg-surface px-3 py-2.5 sm:px-4 sm:py-3',
        className,
      )}
    >
      <div className="text-[10px] font-medium tracking-wide text-ink-muted uppercase">{label}</div>
      <div
        className="mt-1.5 text-[26px] leading-none font-semibold tracking-tight sm:text-[30px]"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-[11px] text-ink-muted">{sub}</div> : null}
    </div>
  );
}
