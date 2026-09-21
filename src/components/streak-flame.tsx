'use client';

import { cn } from '@/lib/utils';

/**
 * A flame that gets more insistent the longer the streak runs.
 *
 * The intensity is an *ordinal* encoding — longer streak, more flame — so it
 * follows the same rule as the heatmap: one visual dimension, moving one way.
 * Colour comes from existing validated tokens (--axis for cold, then the
 * sequential ramp, then --warning at the top); no new values are introduced,
 * and because the ramp is per-skin the flame restyles itself like everything
 * else.
 *
 * The number beside it always states the streak in text, so the flame only ever
 * reinforces — it never carries the value alone.
 */
type Tier = { min: number; fill: string; glow: number; label: string };

const TIERS: Tier[] = [
  { min: 0, fill: 'var(--axis)', glow: 0, label: 'no streak' },
  { min: 1, fill: 'var(--seq-2)', glow: 0, label: 'streak started' },
  { min: 3, fill: 'var(--seq-3)', glow: 0.18, label: 'streak building' },
  { min: 7, fill: 'var(--seq-4)', glow: 0.3, label: 'week-long streak' },
  { min: 14, fill: 'var(--warning)', glow: 0.42, label: 'long streak' },
];

export function tierFor(days: number): Tier {
  let out = TIERS[0];
  for (const t of TIERS) if (days >= t.min) out = t;
  return out;
}

export function StreakFlame({ days, size = 16 }: { days: number; size?: number }) {
  const tier = tierFor(days);
  // Only a live streak flickers, and only past the first few days — a flame
  // animating next to "0" would be noise.
  const alive = days >= 3;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {tier.glow > 0 ? (
        <span
          className="absolute inset-0 rounded-full blur-[6px]"
          style={{ background: tier.fill, opacity: tier.glow }}
        />
      ) : null}
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cn('relative', alive && 'js-flicker')}
        style={{ transformOrigin: '50% 85%' }}
      >
        <path
          d="M12 2.5c.5 3-1.6 4.2-2.8 5.6A6.4 6.4 0 0 0 7.5 12c0 3 2 5.5 4.5 5.5S16.5 15 16.5 12c0-2.2-1-3.6-2.2-5.1-1-1.2-2-2.4-2.3-4.4Z"
          fill={tier.fill}
        />
        {/* Inner core on the hotter tiers — reads as heat, not just a bigger icon. */}
        {days >= 7 ? (
          <path
            d="M12 10c.3 1.5-.8 2.1-1.4 2.8a2.9 2.9 0 0 0-.6 1.7c0 1.4.9 2.5 2 2.5s2-1.1 2-2.5c0-1-.5-1.6-1-2.3-.5-.6-1-1.1-1-2.2Z"
            fill="var(--surface)"
            opacity={0.55}
          />
        ) : null}
      </svg>
      <span className="sr-only">{tier.label}</span>
    </span>
  );
}
