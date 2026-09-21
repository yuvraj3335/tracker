import { cn } from '@/lib/utils';

export function Card({
  lift = 1,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  /** Elevation step. 0 keeps a card flat where it sits inside another surface. */
  lift?: 0 | 1 | 2;
}) {
  return (
    <div
      className={cn(
        // skin-card takes its radius from --radius-card, which each skin sets:
        // 4px for Rampart, 18px for Blossom.
        'skin-card border border-hairline bg-surface',
        // Elevation comes from the skin too: Rampart's step is hard and tight,
        // Blossom's is wide and violet-tinted. See the scale in globals.css.
        lift === 1 && 'shadow-lift-1',
        lift === 2 && 'shadow-lift-2',
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
