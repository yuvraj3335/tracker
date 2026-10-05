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
  className,
}: {
  label: string;
  /** Usually `3/9`, or a bare number where there is no total. */
  count?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-2 border-y border-hairline bg-surface-2 px-4 py-2 sm:px-5',
        className,
      )}
    >
      <h3 className="truncate text-xs font-semibold text-ink-2">{label}</h3>
      {count ? <span className="shrink-0 text-meta text-ink-muted tnum">{count}</span> : null}
    </div>
  );
}
