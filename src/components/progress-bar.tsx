import { cn } from '@/lib/utils';

/**
 * A magnitude bar. Data-end is rounded and anchored to the track's start edge,
 * per the mark spec. Values are always directly labeled by the caller, which
 * also discharges the sub-3:1 contrast relief rule on the lighter series hues.
 */
export function ProgressBar({
  value,
  color = 'var(--series-1)',
  className,
  height = 6,
  label,
}: {
  value: number;
  color?: string;
  className?: string;
  height?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-grid', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${clamped}%`, background: color }}
      />
    </div>
  );
}
