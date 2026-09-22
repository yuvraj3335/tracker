'use client';

import { useSyncExternalStore } from 'react';
import { CharacterFigure } from './character-figure';
import { CountUp } from './count-up';
import { StreakFlame } from './streak-flame';
import { useActiveCharacter } from './character-provider';
import { dailyLine } from '@/lib/character-voice';
import { getSkin, serverSkin, subscribe } from '@/lib/appearance';
import type { Pose } from '@/lib/characters';
import { THEMES } from '@/lib/themes';
import { pct } from '@/lib/utils';

/**
 * The dashboard's focal point.
 *
 * Overall progress is the single most important number on the page, and it used
 * to sit in a row of four identical tiles with nothing marking it out. The ring
 * is reinforcement, not the encoding — the percentage is stated in text at the
 * centre, so the value never depends on reading an arc.
 */
/* Geometry lives in viewBox units so CSS can size the ring responsively
   without recomputing the dash maths. */
const BOX = 104;
const STROKE = 9;
const R = (BOX - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function HeroProgress({
  done,
  total,
  streak,
  todayCount,
  greeting,
  day,
  pose = 'idle',
}: {
  done: number;
  total: number;
  streak: number;
  todayCount: number;
  greeting: string;
  /** Today's key, so the character's line is stable for the whole day. */
  day?: string;
  /**
   * How the figure is doing. This is the whole of the "things are going well"
   * treatment: a cheerful pose and nothing else. There is no banner for it,
   * because the numbers to its left already say so.
   */
  pose?: Pose;
}) {
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const character = useActiveCharacter();
  const theme = THEMES[skin];
  // An installed character with its own idle lines speaks here; otherwise the
  // skin's tagline stands, exactly as before.
  const line = (day ? dailyLine(character, day) : null) ?? theme.tagline;
  const value = total ? done / total : 0;

  return (
    <section className="skin-card relative overflow-hidden border border-hairline bg-surface p-4 sm:p-5">
      {/* A very faint wash so the hero reads as a distinct surface without
          introducing a second card colour. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          background: `radial-gradient(120% 100% at 100% 0%, var(--accent) 0%, transparent 60%)`,
        }}
      />

      <div className="relative flex items-center gap-4 sm:gap-6">
        <div className="relative size-[88px] shrink-0 sm:size-[104px]">
          <svg viewBox={`0 0 ${BOX} ${BOX}`} className="size-full -rotate-90">
            <circle
              cx={BOX / 2}
              cy={BOX / 2}
              r={R}
              fill="none"
              stroke="var(--grid)"
              strokeWidth={STROKE}
            />
            <circle
              cx={BOX / 2}
              cy={BOX / 2}
              r={R}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - value)}
              style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.16, 1, 0.3, 1)' }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="text-display font-semibold">
                {/* Tweens only when the number actually changes — see CountUp. */}
                <CountUp value={pct(done, total)} format={(n) => `${Math.round(n * 10) / 10}%`} />
              </div>
              <div className="mt-0.5 text-micro text-ink-muted tnum">
                {done}/{total}
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold sm:text-base">{greeting}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{line}</p>

          <dl className="mt-3 grid grid-cols-3 gap-x-2">
            <Stat label="today" value={todayCount} />
            <Stat label="streak" value={streak} flame />
            <Stat label="to go" value={total - done} />
          </dl>
        </div>

        {/* Shown at both sizes — there is room beside the stats even on a
            phone, and hiding it there was the one place the theme vanished.
            Renders the installed character when there is one, the skin's SVG
            mascot otherwise, and nothing at all for Studio. This is the app's
            resting figure, so it is the only one that preloads. */}
        <span className="sm:hidden">
          <CharacterFigure pose={pose} size={64} />
        </span>
        <span className="hidden sm:block">
          <CharacterFigure pose={pose} size={88} priority />
        </span>
      </div>
    </section>
  );
}

function Stat({ label, value, flame = false }: { label: string; value: number; flame?: boolean }) {
  return (
    <div>
      <dd className="flex items-center gap-1 text-base leading-none font-semibold tnum sm:text-lg">
        {flame ? <StreakFlame days={value} size={15} /> : null}
        <CountUp value={value} />
      </dd>
      <dt className="mt-0.5 truncate text-micro tracking-wide text-ink-muted uppercase">
        {label}
      </dt>
    </div>
  );
}
