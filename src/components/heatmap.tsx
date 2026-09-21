'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatKey, heatmapGrid, todayKey, type DayKey } from '@/lib/date';

/**
 * GitHub-style contribution grid, fed entirely by Notion activity.
 *
 * Encoding is sequential: one hue, light -> dark, five steps from a validated
 * ramp. The lightest step means "nothing that day" and is allowed to recede
 * toward the surface. Every cell carries a hover tooltip, and each links to
 * that day's list — which is the table view for this chart.
 */

const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;

/** Thresholds tuned for question-a-day volumes rather than commit volumes. */
function bucket(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  if (n <= 7) return 3;
  return 4;
}

const FILL = ['var(--seq-0)', 'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)'];

type Hover = { day: DayKey; count: number; x: number; y: number } | null;

export function Heatmap({
  counts,
  weeks = 53,
  href = '/daily',
}: {
  counts: Record<DayKey, number>;
  weeks?: number;
  href?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>(null);
  const today = todayKey();

  const grid = useMemo(() => heatmapGrid(today, weeks), [today, weeks]);

  // Open on the most recent week — that is the part you actually care about.
  // Deferred to the next frame: on first commit the columns have not been laid
  // out yet, so scrollWidth still reads as the client width.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
    return () => cancelAnimationFrame(id);
    // Mount only: `counts` is a fresh object each render, and re-running would
    // yank the grid back to the right edge every time a checkbox is ticked.
  }, []);

  const total = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts],
  );

  // Month labels sit above the first column whose week introduces a new month.
  const monthLabels = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    let last = '';
    grid.forEach((col, i) => {
      const firstOfMonth = col.find((d) => d.slice(8, 10) <= '07');
      if (!firstOfMonth) return;
      const m = firstOfMonth.slice(0, 7);
      if (m !== last) {
        out.push({ x: i * STEP, label: formatKey(firstOfMonth, 'MMM') });
        last = m;
      }
    });
    return out;
  }, [grid]);

  const width = grid.length * STEP;

  return (
    <div className="relative">
      <div
        ref={scroller}
        className="overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'thin' }}
        onMouseLeave={() => setHover(null)}
      >
        <div className="flex gap-2" style={{ minWidth: width + 28 }}>
          {/* Weekday rail — Mon/Wed/Fri only, matching GitHub's density */}
          <div
            className="shrink-0 pt-4 text-micro leading-none text-ink-muted"
            style={{ width: 20 }}
            aria-hidden
          >
            {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, i) => (
              <div key={i} style={{ height: CELL, marginBottom: GAP }} className="flex items-center">
                {d}
              </div>
            ))}
          </div>

          <div>
            <div className="relative h-4" aria-hidden>
              {monthLabels.map((m) => (
                <span
                  key={m.x + m.label}
                  className="absolute top-0 text-micro leading-none text-ink-muted"
                  style={{ left: m.x }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            <div className="flex" style={{ gap: GAP }}>
              {grid.map((col, ci) => (
                <div key={ci} className="flex flex-col" style={{ gap: GAP }}>
                  {col.map((day) => {
                    const count = counts[day] ?? 0;
                    const future = day > today;
                    const b = bucket(count);
                    return (
                      <Link
                        key={day}
                        href={`${href}?d=${day}`}
                        aria-label={`${count} on ${formatKey(day)}`}
                        className="block rounded-[3px] outline-offset-1 focus-visible:outline-2 focus-visible:outline-accent"
                        style={{
                          width: CELL,
                          height: CELL,
                          background: future ? 'transparent' : FILL[b],
                          border: future
                            ? '1px dashed var(--grid)'
                            : b === 0
                              ? '1px solid var(--grid)'
                              : '1px solid transparent',
                          opacity: future ? 0.4 : 1,
                          // A 2px surface ring keeps today legible against neighbours.
                          boxShadow: day === today ? '0 0 0 1.5px var(--ink)' : undefined,
                        }}
                        onMouseEnter={(e) => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const host = scroller.current?.getBoundingClientRect();
                          setHover({
                            day,
                            count,
                            x: r.left - (host?.left ?? 0) + r.width / 2,
                            y: r.top - (host?.top ?? 0),
                          });
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {hover ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-hairline bg-surface px-2 py-1 text-meta whitespace-nowrap shadow-lift-2"
          style={{ left: hover.x, top: hover.y - 6 }}
          role="tooltip"
        >
          <span className="font-semibold tnum">
            {hover.count === 0 ? 'Nothing' : `${hover.count} question${hover.count === 1 ? '' : 's'}`}
          </span>
          <span className="text-ink-muted"> · {formatKey(hover.day, 'd MMM yyyy')}</span>
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-3 text-micro text-ink-muted">
        <span className="tnum">{total} completed in the last {Math.round(weeks / 4.345)} months</span>
        <span className="flex items-center gap-1">
          Less
          {FILL.map((f, i) => (
            <span
              key={i}
              className="inline-block rounded-[3px]"
              style={{
                width: 10,
                height: 10,
                background: f,
                border: i === 0 ? '1px solid var(--grid)' : '1px solid transparent',
              }}
            />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
