import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-hairline bg-surface',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-4 pt-4 pb-2 sm:px-5 sm:pt-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3 className={cn('text-sm font-semibold tracking-tight text-ink', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('mt-0.5 text-xs text-ink-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-4 pb-4 sm:px-5 sm:pb-5', className)} {...props} />;
}
