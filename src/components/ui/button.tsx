import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'outline';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  outline: 'border border-hairline text-ink-2 hover:bg-surface-2 hover:text-ink',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-10 px-4 text-sm',
};

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: React.ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        'skin-pill inline-flex items-center justify-center gap-1.5 font-medium',
        'transition-colors disabled:pointer-events-none disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
