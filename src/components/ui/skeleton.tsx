import { cn } from '@/lib/utils';

/**
 * A placeholder block.
 *
 * Notion needs five paginated calls for a full task table, so a first load can
 * take a second or two. Skeletons make that feel like loading rather than like
 * nothing happening. The pulse is opacity-only, and the global
 * prefers-reduced-motion rule flattens it for anyone who asks.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-2', className)}
      aria-hidden
      {...props}
    />
  );
}

/** Wraps a loading region so assistive tech announces it once, not per block. */
export function LoadingRegion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
