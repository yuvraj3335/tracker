import { cn } from '@/lib/utils';

/** One consistent page title treatment, so every route opens the same way. */
export function PageHeader({
  title,
  sub,
  right,
  className,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-1', className)}>
      <div className="min-w-0">
        <h1 className="text-display font-semibold">
          {title}
        </h1>
        {sub ? <p className="mt-1 text-xs text-ink-muted sm:text-sm">{sub}</p> : null}
      </div>
      {right ? <div className="shrink-0 pt-1">{right}</div> : null}
    </div>
  );
}
