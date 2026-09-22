import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { CharacterFigure } from './character-figure';
import { Button } from './ui/button';
import type { PerformanceMood } from '@/lib/derive';
import { moodPose } from '@/lib/characters';

/**
 * One sentence about how it has been going, and one thing to do about it.
 *
 * Shown only for `slipping`. A live streak already has the hero saying so, and
 * a second cheerful panel underneath it would just be noise — the brief was a
 * quieter presence when things are going well, not a louder one.
 *
 * The tone is the existing empty state's, deliberately: name the gap once,
 * point at the next action, and never mention it again once something is
 * logged. No counts of missed days beyond the one fact, no streak length, no
 * percentages — everything numeric on this page belongs to the hero above,
 * and the two are rendered from one `stats` object so they cannot disagree.
 */
export function MoodBanner({
  mood,
  next,
}: {
  mood: PerformanceMood;
  /** The first unsolved question, and where to open it. */
  next: { name: string; href: string } | null;
}) {
  // No next question means the sheet is finished. There is no action to offer
  // and nothing to nag about, so the banner has no job here.
  if (mood.key !== 'slipping' || !next) return null;

  const broken = mood.cause === 'streak-broken';
  const headline =
    broken && mood.daysSinceActive
      ? `Nothing logged for ${mood.daysSinceActive} days.`
      : broken
        ? 'The streak stopped.'
        : 'Quieter than your usual pace this week.';
  const line = broken
    ? 'One question is enough to start again.'
    : 'One question today gets it moving again.';

  return (
    // The live region sits on the banner itself rather than on a permanent
    // empty wrapper: whether this applies is decided server-side during render,
    // so the banner is in the first paint whenever it is going to appear at
    // all. The transition it does have to cover is the dashboard re-rendering
    // after a tick, where the banner's text changes or it goes away entirely.
    <section
      aria-live="polite"
      className="skin-card flex flex-wrap items-center gap-3 border border-hairline bg-surface p-3 shadow-lift-1 sm:gap-4 sm:p-4"
    >
      <CharacterFigure pose={moodPose(mood)} size={60} />
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm font-medium text-ink">{headline}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{line}</p>
      </div>
      {/* Full width on a phone, where it wraps onto its own row; inline beside
          the text from sm up. min-h-11 gives it a 44px target as the one
          primary action on the banner. */}
      <Button asChild variant="outline" className="min-h-11 w-full min-w-0 shrink-0 sm:w-auto">
        <Link href={next.href}>
          <span className="truncate">Start with {next.name}</span>
          <ArrowRight className="size-3.5 shrink-0" />
        </Link>
      </Button>
    </section>
  );
}
