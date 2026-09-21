'use client';

import { useState } from 'react';
import { formatKey } from '@/lib/date';

/**
 * Questions completed per day, with a 7-day rolling average.
 *
 * Both series are the same measure on the same scale, so there is one y-axis.
 * Bars are divs (percentage widths, so rounded ends never distort) and the
 * average is an SVG polyline with a non-scaling stroke over the top.
 *
 * These two keep the validated CATEGORICAL slots and deliberately do not follow
 * the skin, unlike the heatmap. The distinction is what the colour is doing:
 *
 *   heatmap  -> magnitude  -> sequential, one hue -> themed per skin
 *   this     -> identity   -> categorical slots   -> fixed
 *
 * Colour here means "which series", and that should not be repainted when
 * someone changes theme. Substituting a skin's accent was tried and measured:
 * the accents are picked for UI contrast, not as series slots, and both miss
 * the categorical gates — Rampart's teal reads gray (chroma 0.091 against a 0.1
 * floor) and Blossom's violet sits above the dark lightness band (L 0.681 vs
 * 0.67). The validated pair stays.
 */
export function VelocityChart({
  series,
  average,
}: {
  series: { day: string; count: number }[];
  average: { day: string; avg: number }[];
}) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...series.map((s) => s.count), ...average.map((a) => a.avg));
  // A rounded ceiling keeps the gridlines on whole numbers.
  const ceil = Math.max(2, Math.ceil(max / 2) * 2);
  const H = 140;

  const points = average
    .map((a, i) => {
      const x = ((i + 0.5) / series.length) * 100;
      const y = H - (a.avg / ceil) * H;
      return `${x},${y}`;
    })
    .join(' ');

  const active = hover !== null ? series[hover] : null;
  const activeAvg = hover !== null ? average[hover] : null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-micro text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block rounded-sm"
            style={{ width: 9, height: 9, background: 'var(--series-1)' }}
          />
          Per day
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block rounded-full"
            style={{ width: 14, height: 2, background: 'var(--series-2)' }}
          />
          7-day average
        </span>
      </div>

      <div className="relative" style={{ height: H }}>
        {/* recessive gridlines + axis labels */}
        {[0, 0.5, 1].map((f) => (
          <div
            key={f}
            className="absolute inset-x-0 flex items-center"
            style={{ top: H - f * H }}
          >
            <span className="w-5 shrink-0 text-right text-micro text-ink-muted tnum">
              {Math.round(ceil * f)}
            </span>
            <div
              className="ml-1 h-px flex-1"
              style={{ background: f === 0 ? 'var(--axis)' : 'var(--grid)' }}
            />
          </div>
        ))}

        <div className="absolute inset-y-0 right-0" style={{ left: 24 }}>
          {/* bars — 2px surface gap between neighbours, ends anchored to baseline */}
          <div className="absolute inset-0 flex items-end" style={{ gap: 2 }}>
            {series.map((s, i) => (
              <div
                key={s.day}
                className="relative flex-1 cursor-default"
                style={{ height: '100%' }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className="absolute bottom-0 w-full rounded-t-[4px] transition-opacity"
                  style={{
                    height: `${(s.count / ceil) * 100}%`,
                    minHeight: s.count > 0 ? 2 : 0,
                    background: 'var(--series-1)',
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }}
                />
              </div>
            ))}
          </div>

          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox={`0 0 100 ${H}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <polyline
              points={points}
              fill="none"
              stroke="var(--series-2)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      </div>

      <div className="mt-1.5 flex justify-between pl-6 text-micro text-ink-muted tnum">
        <span>{formatKey(series[0]?.day ?? '', 'd MMM')}</span>
        <span>{formatKey(series[series.length - 1]?.day ?? '', 'd MMM')}</span>
      </div>

      <div className="mt-2 h-8 text-xs" role="status" aria-live="polite">
        {active ? (
          <div className="rounded-md border border-hairline bg-surface px-2.5 py-1.5">
            <span className="font-semibold tnum">{active.count}</span>
            <span className="text-ink-muted"> that day · </span>
            <span className="tnum">{(activeAvg?.avg ?? 0).toFixed(1)}</span>
            <span className="text-ink-muted"> avg · {formatKey(active.day, 'EEE d MMM')}</span>
          </div>
        ) : (
          <span className="text-ink-muted">Hover a bar for that day&apos;s numbers.</span>
        )}
      </div>
    </div>
  );
}
