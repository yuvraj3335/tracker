'use client';

import { useOptimistic, useTransition } from 'react';
import { Bookmark, RotateCcw, ExternalLink } from 'lucide-react';
import { toggleTaskAction, toggleFlagAction } from '@/app/actions';
import type { Task } from '@/lib/notion';
import { cn } from '@/lib/utils';

/**
 * The difficulty chip is a filled mark carrying a label, so the label has to
 * clear contrast against its own fill — not against the page. The light end of
 * the ordinal ramp therefore takes dark ink in both modes.
 */
const DIFF_CHIP: Record<string, { bg: string; fg: string }> = {
  Easy: { bg: 'var(--diff-easy)', fg: '#0b0b0b' },
  Medium: { bg: 'var(--diff-medium)', fg: '#ffffff' },
  Hard: { bg: 'var(--diff-hard)', fg: '#ffffff' },
};

/**
 * One question. The checkbox is the single input for the whole system — it
 * writes `Done` plus `Completed On`, and everything else is derived.
 *
 * Optimistic so a tap feels instant even though Notion takes a moment.
 */
export function TaskRow({ task, index }: { task: Task; index: number }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useOptimistic(task.done);
  const [marks, setMarks] = useOptimistic({
    bookmarked: task.bookmarked,
    revisit: task.revisit,
  });

  const links = [
    task.links.tuf && { label: 'Article', href: task.links.tuf },
    task.links.leetcode && { label: 'LeetCode', href: task.links.leetcode },
    task.links.gfg && { label: 'GFG', href: task.links.gfg },
    task.links.youtube && { label: 'Video', href: task.links.youtube },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <li
      className={cn(
        'group flex items-start gap-3 border-b border-hairline px-3 py-2.5 last:border-0 sm:px-4',
        'transition-opacity',
        pending && 'opacity-60',
      )}
    >
      <label className="flex shrink-0 cursor-pointer items-center pt-0.5">
        <input
          type="checkbox"
          checked={done}
          aria-label={`Mark "${task.name}" as ${done ? 'not done' : 'done'}`}
          className="size-[18px] cursor-pointer accent-[var(--accent)]"
          onChange={(e) => {
            const next = e.target.checked;
            start(async () => {
              setDone(next);
              await toggleTaskAction(task.id, next);
            });
          }}
        />
      </label>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="shrink-0 text-[11px] text-ink-muted tnum">{index}</span>
          <span
            className={cn(
              'text-sm leading-snug',
              done ? 'text-ink-muted line-through' : 'text-ink',
            )}
          >
            {task.name}
          </span>
          {task.difficulty ? (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: DIFF_CHIP[task.difficulty].bg,
                color: DIFF_CHIP[task.difficulty].fg,
              }}
            >
              {task.difficulty}
            </span>
          ) : null}
        </div>

        {links.length ? (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-0.5 text-[11px] text-ink-muted underline-offset-2 hover:text-accent hover:underline"
              >
                {l.label}
                <ExternalLink className="size-2.5" />
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-ink-muted italic">no link on the source sheet</div>
        )}

        {task.completedOn && done ? (
          <div className="mt-1 text-[10px] text-ink-muted tnum">
            done {task.completedOn.slice(0, 10)}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label={marks.bookmarked ? 'Remove bookmark' : 'Bookmark'}
          aria-pressed={marks.bookmarked}
          className={cn(
            'rounded p-1.5 transition-colors hover:bg-surface-2',
            marks.bookmarked ? 'text-series-4' : 'text-ink-muted opacity-0 group-hover:opacity-100 focus:opacity-100',
          )}
          onClick={() =>
            start(async () => {
              const next = !marks.bookmarked;
              setMarks({ ...marks, bookmarked: next });
              await toggleFlagAction(task.id, 'bookmarked', next);
            })
          }
        >
          <Bookmark className="size-3.5" fill={marks.bookmarked ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          aria-label={marks.revisit ? 'Clear revisit flag' : 'Flag for revisit'}
          aria-pressed={marks.revisit}
          className={cn(
            'rounded p-1.5 transition-colors hover:bg-surface-2',
            marks.revisit ? 'text-series-2' : 'text-ink-muted opacity-0 group-hover:opacity-100 focus:opacity-100',
          )}
          onClick={() =>
            start(async () => {
              const next = !marks.revisit;
              setMarks({ ...marks, revisit: next });
              await toggleFlagAction(task.id, 'revisit', next);
            })
          }
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>
    </li>
  );
}
