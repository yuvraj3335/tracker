'use client';

import { useEffect, useRef } from 'react';

/**
 * A number that tweens when it changes — and only when it changes.
 *
 * Driven imperatively: the tween writes straight to the DOM node through a ref
 * on each frame rather than going through state. Three reasons that matters
 * here:
 *
 *  - No setState in an effect, so no cascading render per frame.
 *  - It does nothing on mount by construction. The first render paints the
 *    real value; only a *change* to the prop starts a tween. That is the
 *    difference between "animates when the number changes" and "animates every
 *    time the page renders".
 *  - The dashboard re-renders on every tick via revalidatePath, and most of
 *    those re-renders carry the same number.
 *
 * Honours prefers-reduced-motion by snapping to the final value. The global CSS
 * rule in globals.css cannot reach a JS tween, so it is checked explicitly.
 */
export function CountUp({
  value,
  format = (n: number) => String(Math.round(n)),
  className,
  durationMs = 650,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  durationMs?: number;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);

  useEffect(() => {
    const el = node.current;
    const from = previous.current;
    previous.current = value;
    if (!el || from === value) return;

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      el.textContent = format(value);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic: fast then settling, so the final value reads as arriving
      // rather than drifting.
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, format, durationMs]);

  // The server and the first client render both paint the true value, so there
  // is no hydration mismatch and no flash of a zero.
  return (
    <span ref={node} className={className}>
      {format(value)}
    </span>
  );
}
