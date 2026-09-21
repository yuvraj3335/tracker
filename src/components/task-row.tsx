'use client';

import { memo, useOptimistic, useTransition } from 'react';
import { Bookmark, RotateCcw, ExternalLink } from 'lucide-react';
import { toggleTaskAction, toggleFlagAction, setDifficultyAction } from '@/app/actions';
import type { Task } from '@/lib/notion';
import { celebrate, type CelebrationKind } from '@/lib/celebrate';
import { offerUndo } from '@/lib/undo';
import { feedbackForTick } from '@/lib/effects';
import { DIFFICULTY, type Difficulty } from '@/lib/schema';
import { formatKey } from '@/lib/date';
import { Check } from './ui/check';
import { cn } from '@/lib/utils';

/**
 * The difficulty chip is a filled mark carrying a label, so the label has to
 * clear contrast against its own fill — not against the page. The light end of
 * each skin's ordinal ramp therefore takes dark ink in both modes.
 */
const CHIP: Record<string, { bg: string; fg: string }> = {
  Easy: { bg: 'var(--diff-easy)', fg: '#0b0b0b' },
  Medium: { bg: 'var(--diff-medium)', fg: '#ffffff' },
  Hard: { bg: 'var(--diff-hard)', fg: '#ffffff' },
};

const LINK_LABEL = { tuf: 'Article', leetcode: 'LeetCode', gfg: 'GFG', youtube: 'Video' } as const;

/**
 * One question. The tick box is the single input for the whole system — it
 * writes `Done` plus `Completed On`, and everything else is derived.
 *
 * Optimistic so a tap feels instant even though Notion takes a moment.
 */
function TaskRowImpl({
  task,
  index,
  remainingHeading,
  remainingSection,
  remainingArea,
  compact = false,
  focused = false,
}: {
  task: Task;
  index: number;
  /**
   * Undone questions left at each level, including this one. When a count is 1,
   * ticking this row finishes that level and earns the matching celebration
   * tier. Only the sheet knows these, so elsewhere they are omitted and every
   * tick is a plain cheer.
   *
   * Passed as three numbers rather than one object on purpose: React.memo
   * compares props shallowly, and a fresh object literal per render would miss
   * on every row every time.
   */
  remainingHeading?: number;
  remainingSection?: number;
  remainingArea?: number;
  /** Tighter rows. 456 of them is a lot of scrolling; the choice is the user's. */
  compact?: boolean;
  /** Carries the sheet's j/k cursor. Drawn, not inferred from :focus-visible. */
  focused?: boolean;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useOptimistic(task.done);
  const [marks, setMarks] = useOptimistic({
    bookmarked: task.bookmarked,
    revisit: task.revisit,
  });
  const [difficulty, setDifficultyOptimistic] = useOptimistic(task.difficulty);

  const links = (Object.keys(LINK_LABEL) as (keyof typeof LINK_LABEL)[])
    .map((k) => ({ label: LINK_LABEL[k], href: task.links[k] }))
    .filter((l) => l.href);

  function toggle(next: boolean) {
    // Celebrate optimistically, before Notion replies — the reward has to land
    // with the tap, not a second later. Unticking is silent.
    //
    // The row does not resolve the line: picking copy needs the skin and the
    // active character, and subscribing to those here would mean one store
    // subscription per row across 456 of them. The overlay reads them once.
    // Biggest completed level wins, so finishing the last question of a
    // section reads as a section finish rather than just another heading.
    if (next) {
      const tier = tierFor(remainingHeading, remainingSection, remainingArea);
      celebrate(tier);
      // Reads the preference at call time rather than subscribing — a store
      // subscription here would cost one per row across 456 of them.
      feedbackForTick(tier !== 'cheer');
    }
    // A mis-tap on a 456-row list is easy and, on a filtered view, the row
    // vanishes the moment it is ticked — so the correction has to come to you.
    offerUndo(`${next ? 'Marked' : 'Cleared'} “${task.name}”`, () =>
      toggleTaskAction(task.id, !next),
    );
    start(async () => {
      setDone(next);
      await toggleTaskAction(task.id, next);
    });
  }

  return (
    <li
      data-row-id={task.id}
      className={cn(
        'group relative flex items-start gap-3 border-b border-hairline px-3 last:border-0 sm:px-4',
        compact ? 'py-1.5' : 'py-2.5',
        // Sticky heading bands are 28px; keep a keyboard-scrolled row clear of them.
        'scroll-mt-12',
        'transition-colors hover:bg-surface-2/40',
        pending && 'opacity-60',
        // The j/k cursor. An inset ring rather than an outline so it never
        // widens the row or shifts anything below it.
        focused && 'bg-surface-2/60 ring-2 ring-accent/70 ring-inset',
      )}
    >
      <span className="pt-[3px]">
        <Check
          checked={done}
          onCheckedChange={toggle}
          label={`Mark "${task.name}" as ${done ? 'not done' : 'done'}`}
        />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="w-5 shrink-0 text-right text-meta text-ink-muted tnum">{index}</span>
          <span
            className={cn(
              'text-sm leading-snug font-medium transition-colors',
              done ? 'text-ink-muted line-through decoration-ink-muted/50' : 'text-ink',
            )}
          >
            {task.name}
          </span>
          <DifficultyPicker
            value={difficulty}
            onChange={(next) =>
              start(async () => {
                setDifficultyOptimistic(next);
                await setDifficultyAction(task.id, next);
              })
            }
          />
        </div>

        {/* Links and the completion stamp share one line, which keeps rows
            short enough that a 456-question list stays scrollable. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-7">
          {links.length ? (
            links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-0.5 text-meta text-ink-muted underline-offset-2 transition-colors hover:text-accent hover:underline"
              >
                {l.label}
                <ExternalLink className="size-2.5" />
              </a>
            ))
          ) : (
            <span className="text-meta text-ink-muted/80 italic">no link on the source sheet</span>
          )}

          {done && task.completedOn ? (
            <span className="text-micro text-ink-muted tnum">
              · {formatKey(task.completedOn.slice(0, 10), 'd MMM')}
            </span>
          ) : null}
        </div>
      </div>

      {/* Flags. Visible by default so they are reachable on touch, where there
          is no hover at all; only pointer devices get the reveal-on-hover. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <FlagButton
          flag="bookmarked"
          active={marks.bookmarked}
          label={marks.bookmarked ? 'Remove bookmark' : 'Bookmark'}
          activeColor="var(--series-4)"
          onClick={() =>
            start(async () => {
              const next = !marks.bookmarked;
              setMarks({ ...marks, bookmarked: next });
              await toggleFlagAction(task.id, 'bookmarked', next);
            })
          }
        >
          <Bookmark className="size-3.5" fill={marks.bookmarked ? 'currentColor' : 'none'} />
        </FlagButton>

        <FlagButton
          flag="revisit"
          active={marks.revisit}
          label={marks.revisit ? 'Clear revisit flag' : 'Flag for revisit'}
          activeColor="var(--series-2)"
          onClick={() =>
            start(async () => {
              const next = !marks.revisit;
              setMarks({ ...marks, revisit: next });
              await toggleFlagAction(task.id, 'revisit', next);
            })
          }
        >
          <RotateCcw className="size-3.5" />
        </FlagButton>
      </div>
    </li>
  );
}

/** The largest level this tick completes. */
function tierFor(heading?: number, section?: number, area?: number): CelebrationKind {
  if (area === 1) return 'area';
  if (section === 1) return 'section';
  if (heading === 1) return 'milestone';
  return 'cheer';
}

/**
 * Memoised because the sheet renders up to 456 of these and re-renders the
 * whole list on every keystroke. Props are the task object (stable identity
 * from the server payload) plus primitives, so a row only re-renders when
 * something about that row actually changed.
 */
export const TaskRow = memo(TaskRowImpl);

/**
 * Sets a question's difficulty.
 *
 * The source sheet carries no difficulty, so every row is seeded blank and the
 * analytics page's breakdown stays empty until these are filled in. There was
 * previously no way to do that anywhere in the app — `setDifficultyAction`
 * existed but nothing called it — so the feature was unreachable.
 *
 * A native <select> rather than a custom menu: it is one element, it is
 * keyboard and screen-reader correct for free, and on a phone it opens the
 * platform picker.
 */
function DifficultyPicker({
  value,
  onChange,
}: {
  value: Difficulty | null;
  onChange: (next: Difficulty | null) => void;
}) {
  const chip = value ? CHIP[value] : null;
  return (
    <span className="relative shrink-0">
      <select
        value={value ?? ''}
        aria-label={`Difficulty${value ? `: ${value}` : ' not set'}`}
        onChange={(e) => onChange((e.target.value || null) as Difficulty | null)}
        className={cn(
          'cursor-pointer appearance-none rounded px-1.5 py-0.5 text-micro font-semibold',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
          !chip &&
            // Unset stays quiet until the row is hovered, so a mostly-blank
            // sheet is not a wall of placeholders. Always visible on touch.
            'border border-dashed border-axis text-ink-muted opacity-70 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100',
        )}
        style={chip ? { background: chip.bg, color: chip.fg } : undefined}
      >
        <option value="">Difficulty</option>
        {DIFFICULTY.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </span>
  );
}

function FlagButton({
  flag,
  active,
  label,
  activeColor,
  onClick,
  children,
}: {
  /** Lets the sheet's `b` / `r` keys find and click this exact control. */
  flag: 'bookmarked' | 'revisit';
  active: boolean;
  label: string;
  activeColor: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-flag={flag}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={active ? { color: activeColor } : undefined}
      className={cn(
        'rounded-md p-2 transition-all active:scale-90',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        'hover:bg-surface-2',
        active
          ? 'opacity-100'
          : // Touch devices (hover: none) always show these; only devices that
            // actually support hover fade them until the row is hovered.
            'text-ink-muted opacity-60 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100',
      )}
    >
      {children}
    </button>
  );
}
