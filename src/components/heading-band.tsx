import { cn } from '@/lib/utils';

/**
 * The band that labels a group of questions.
 *
 * Extracted because this markup had been copied into the sheet view, the daily
 * view and the dev harness, and they had already drifted apart — one still
 * shouted its label in uppercase after the others stopped.
 *
 * No text transform: heading names are preserved verbatim from the source
 * sheet, and uppercasing them both altered that text visually and made the
 * longer ones ("Things to know in C++ /Java /Python or any language") hard to
 * read.
 */
export function HeadingBand({
  label,
  count,
  sticky = false,
  className,
}: {
  label: string;
  /** Usually `3/9`, or a bare number where there is no total. */
  count?: string;
  /** Sticks below the page's sticky chrome (see --sheet-chrome). */
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-2 border-y border-hairline bg-surface-2/85 px-4 py-2 sm:px-5',
        // Below the sheet's sticky search bar, not underneath it: both used
        // to stick at top-14, so a band parked behind 90px of chrome and was
        // never actually visible while stuck.
        sticky && 'sticky z-10 backdrop-blur-sm top-[var(--sheet-chrome,3.5rem)]',
        className,
      )}
    >
      <h3 className="truncate text-xs font-semibold text-ink-2">{label}</h3>
      {count ? <span className="shrink-0 text-meta text-ink-muted tnum">{count}</span> : null}
    </div>
  );
}
