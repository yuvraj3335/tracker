'use client';

import type { MascotId } from '@/lib/themes';
import { cn } from '@/lib/utils';

/**
 * Original mascot artwork.
 *
 * Both are drawn from scratch as plain SVG: a hooded scout for the stark theme
 * and a small floating sprite for the soft one. They evoke a genre rather than
 * copying any studio's characters, which is what keeps this shippable.
 *
 * Everything is painted with theme tokens, so a mascot restyles itself when the
 * skin or light/dark mode changes — there is no per-theme artwork to maintain.
 */
export type MascotState = 'idle' | 'jump';

export function Mascot({
  id,
  state = 'idle',
  size = 72,
  className,
}: {
  id: MascotId;
  state?: MascotState;
  size?: number;
  className?: string;
}) {
  if (id === 'none') return null;

  return (
    <span
      className={cn('inline-block shrink-0', className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox="0 0 80 80"
        width={size}
        height={size}
        className={state === 'jump' ? 'js-jump' : 'js-bob'}
        style={{ overflow: 'visible' }}
      >
        {id === 'sprite' ? <Sprite /> : <Scout />}
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ sprite */
/** A small floating companion: big head, big eyes, a drifting star. */
function Sprite() {
  return (
    <g>
      {/* soft shadow so it reads as hovering, not resting */}
      <ellipse cx="40" cy="74" rx="15" ry="3.2" fill="var(--ink)" opacity="0.10" />

      {/* dress / body */}
      <path
        d="M40 44c7 0 12 5.5 13.5 13.5C54.4 62.6 48.6 66 40 66s-14.4-3.4-13.5-8.5C28 49.5 33 44 40 44z"
        fill="var(--accent)"
      />
      {/* collar highlight */}
      <path d="M31.5 48c2.4-2.6 5.3-4 8.5-4s6.1 1.4 8.5 4c-2.5 1.7-5.4 2.5-8.5 2.5s-6-.8-8.5-2.5z"
        fill="var(--surface)" opacity="0.55" />

      {/* sleeves */}
      <circle cx="25" cy="53" r="4.2" fill="var(--accent)" />
      <circle cx="55" cy="53" r="4.2" fill="var(--accent)" />

      {/* head */}
      <circle cx="40" cy="30" r="17.5" fill="#f6e2d2" />

      {/* hair: cap plus two side tufts */}
      <path
        d="M40 11c10 0 17.5 7.3 17.5 16.5 0 2-.3 3.4-.9 4.6-1.2-5.2-3.6-7.4-6.1-8.3-3 1.6-6.4 2.3-10.5 2.3s-7.5-.7-10.5-2.3c-2.5.9-4.9 3.1-6.1 8.3-.6-1.2-.9-2.6-.9-4.6C22.5 18.3 30 11 40 11z"
        fill="var(--seq-4)"
      />
      <path d="M22.8 27c-2.9 1.6-4.6 5-4.3 8.6.2 2.3 1.2 3.9 2.4 4.2-.6-4.6.3-9 1.9-12.8z" fill="var(--seq-4)" />
      <path d="M57.2 27c2.9 1.6 4.6 5 4.3 8.6-.2 2.3-1.2 3.9-2.4 4.2.6-4.6-.3-9-1.9-12.8z" fill="var(--seq-4)" />

      {/* blush */}
      <ellipse cx="29.5" cy="35" rx="3.4" ry="2.1" fill="var(--accent)" opacity="0.28" />
      <ellipse cx="50.5" cy="35" rx="3.4" ry="2.1" fill="var(--accent)" opacity="0.28" />

      {/* eyes — the blink keeps it feeling alive while idle */}
      <g className="js-blink">
        <ellipse cx="33.5" cy="31" rx="3.1" ry="4.1" fill="#2a2030" />
        <ellipse cx="46.5" cy="31" rx="3.1" ry="4.1" fill="#2a2030" />
        <circle cx="34.6" cy="29.4" r="1.15" fill="#ffffff" />
        <circle cx="47.6" cy="29.4" r="1.15" fill="#ffffff" />
      </g>

      {/* mouth */}
      <path d="M38 38.6c.7.9 1.4 1.3 2 1.3s1.3-.4 2-1.3" stroke="#2a2030" strokeWidth="1.3"
        strokeLinecap="round" fill="none" />

      {/* drifting star companion */}
      <g className="js-bob" style={{ animationDelay: '-1.4s' }}>
        <path d="M64 17l1.6 3.6 3.9.4-2.9 2.6.8 3.8-3.4-2-3.4 2 .8-3.8-2.9-2.6 3.9-.4z"
          fill="var(--seq-3)" />
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------- scout */
/** A hooded figure in a flared cloak. Angular, spare, no insignia copied. */
function Scout() {
  return (
    <g>
      <ellipse cx="40" cy="74" rx="17" ry="3.2" fill="var(--ink)" opacity="0.16" />

      {/* cloak, cut with hard angles to match the theme's square corners */}
      <path d="M40 30 L58 44 L63 70 L48 66 L40 70 L32 66 L17 70 L22 44z" fill="var(--accent)" />
      {/* inner fold, one shade down for depth */}
      <path d="M40 34 L52 45 L55 65 L40 62z" fill="var(--seq-4)" opacity="0.55" />

      {/* hood */}
      <path d="M40 10c9 0 15.5 6.6 15.5 15.5 0 5-1.7 9-5 12-3 2.7-6.5 4-10.5 4s-7.5-1.3-10.5-4c-3.3-3-5-7-5-12C24.5 16.6 31 10 40 10z"
        fill="var(--seq-4)" />
      {/* face shadow inside the hood */}
      <path d="M40 17c6 0 10.2 4 10.2 10 0 4.4-1.6 7.6-4.2 9.4-1.9 1.3-3.9 1.9-6 1.9s-4.1-.6-6-1.9c-2.6-1.8-4.2-5-4.2-9.4 0-6 4.2-10 10.2-10z"
        fill="#0b1012" />

      {/* eyes — a steady glow rather than a cartoon face */}
      <g className="js-blink">
        <path d="M33.6 27.4l5 1.2-.5 2.6-5-1.2z" fill="var(--seq-3)" />
        <path d="M46.4 27.4l-5 1.2.5 2.6 5-1.2z" fill="var(--seq-3)" />
      </g>

      {/* collar */}
      <path d="M28 33.5c3.4 3 7.4 4.5 12 4.5s8.6-1.5 12-4.5l2.5 5c-4.2 3.4-9 5-14.5 5s-10.3-1.6-14.5-5z"
        fill="var(--seq-2)" />

      {/* chest mark: plain chevrons, an original device */}
      <path d="M40 46l6 5-6 2-6-2z" fill="var(--surface)" opacity="0.8" />
      <path d="M40 54l6 5-6 2-6-2z" fill="var(--surface)" opacity="0.5" />
    </g>
  );
}
