'use client';

import { cn } from '@/lib/utils';

/**
 * The tick box.
 *
 * A real <input type="checkbox"> stays in the markup (visually hidden) so
 * keyboard, screen readers and form semantics all keep working; the visible box
 * is a sibling styled off `peer-checked`. The mark scales up through an
 * overshoot curve, which reads as a small pop without needing an animation that
 * has to be re-triggered on every change.
 *
 * The box is 20px with 12px of padding on every side, so the tappable area is
 * 44x44 — the WCAG 2.5.8 enhanced target — without making the row any taller,
 * because the padding is cancelled by an equal negative margin.
 *
 * The border uses --control, not --axis: an unchecked box is a control whose
 * state is carried entirely by that outline, so it has to clear 3:1 against the
 * surface. --axis is a chart hairline and measured 1.48:1 in dark mode.
 */
export function Check({
  checked,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <label className={cn('group/check -m-3 inline-flex cursor-pointer p-3', className)}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-[6px] border-2 border-control bg-surface',
          'transition-colors duration-150',
          'group-hover/check:border-accent',
          'peer-checked:border-accent peer-checked:bg-accent',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
          'peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100',
        )}
      >
        <svg
          viewBox="0 0 12 12"
          className="size-3 scale-50 opacity-0"
          style={{
            color: 'var(--accent-ink)',
            transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 120ms linear',
          }}
          aria-hidden
        >
          <path
            d="M2.5 6.4l2.4 2.3 4.6-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </label>
  );
}
