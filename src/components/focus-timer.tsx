'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Clock3, Expand, Pause, Play, RotateCcw, Shrink, Volume2, VolumeX } from 'lucide-react';
import { CharacterFigure } from './character-figure';
import { Button } from './ui/button';
import { getEffects, serverEffects, setEffects, subscribe } from '@/lib/appearance';
import { playChime, primeAudio } from '@/lib/effects';
import {
  CRITICAL_MS,
  WARNING_MS,
  crossedBelow,
  describeRemaining,
  elapsedFraction,
  finishesAt,
  formatClock,
  formatRemaining,
  parseDuration,
  phaseFor,
  remainingMs,
} from '@/lib/timer';
import { cn } from '@/lib/utils';
import { nextPomodoroSegment, POMODORO_DEFAULTS, segmentDuration, segmentLabel, type PomodoroLengths, type PomodoroSegment } from '@/lib/pomodoro';
import { AttentionMonitor } from './attention-monitor';

/**
 * A countdown for one sitting.
 *
 * All the arithmetic lives in `@/lib/timer` and is tested there; this component
 * only samples a clock and draws the result. The countdown clock is
 * `performance.now()` rather than `Date.now()` on purpose — it is monotonic, so
 * changing the system clock (or a DST shift, or an NTP correction) cannot move
 * the finish line, and it keeps advancing while the tab is in the background,
 * which `setInterval` does not. The wall clock in the corner is the opposite
 * case and does read `Date.now()`, because there the point is the actual time.
 *
 * It is deliberately scoped to this page. The session ends if you navigate
 * away, because the app has no server-side session state and persisting one
 * across routes would mean inventing the "currently working" signal rather than
 * measuring it.
 */
const PRESETS = [15, 25, 50];

/** Ring geometry, in viewBox units, so CSS can size it responsively. */
const BOX = 120;
const STROKE = 6.5;
const RADIUS = (BOX - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Status = 'idle' | 'running' | 'paused' | 'done';

export function FocusTimer({ timeZone }: { timeZone?: string }) {
  const [mode, setMode] = useState<'pomodoro' | 'custom'>('pomodoro');
  const [segment, setSegment] = useState<PomodoroSegment>('focus');
  const [completedFocus, setCompletedFocus] = useState(0);
  const [lengths, setLengths] = useState<PomodoroLengths>(POMODORO_DEFAULTS);
  const [status, setStatus] = useState<Status>('idle');
  const [total, setTotal] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [input, setInput] = useState('25');
  const [announcement, setAnnouncement] = useState('');

  /** The finish line, in `performance.now()` terms. */
  const deadline = useRef(0);
  /** The previous sample, so a threshold crossing can be detected rather than
   *  a threshold *state* — see `crossedBelow`. */
  const previous = useRef(0);

  const effects = useSyncExternalStore(subscribe, getEffects, serverEffects);
  const reduced = usePrefersReducedMotion();
  const wallClock = useSyncExternalStore(subscribeClock, getClock, serverClock);
  const shell = useRef<HTMLDivElement>(null);
  const { isFullscreen, canFullscreen, toggleFullscreen } = useFullscreen(shell);

  const parsed = mode === 'pomodoro' ? segmentDuration(segment, lengths) : parseDuration(input);
  const phase = mode === 'pomodoro' && segment !== 'focus' && remaining > 0 ? 'running' : phaseFor(remaining);
  const cycleProgress = completedFocus > 0 && completedFocus % 4 === 0 && (segment !== 'focus' || status === 'done')
    ? 4 : completedFocus % 4;
  const round = segment === 'focus' && status !== 'done'
    ? completedFocus % 4 + 1 : (completedFocus - 1 + 4) % 4 + 1;
  const live = status === 'running' || status === 'paused';
  const showing = live || status === 'done' ? remaining : (parsed ?? 0);
  const label = formatRemaining(showing);

  const sample = useCallback(() => {
    const next = remainingMs(deadline.current, performance.now());
    const prev = previous.current;
    previous.current = next;

    // Comparing samples rather than testing the current value is what survives
    // a backgrounded tab: timers there are throttled to once a minute or worse,
    // so the sample after 8:00 can be 2:00 and must still count as crossing 5.
    if ((mode === 'custom' || segment === 'focus') && crossedBelow(prev, next, WARNING_MS)) {
      setAnnouncement('Five minutes left.');
      playChime('warning');
    } else if (crossedBelow(prev, next, CRITICAL_MS)) {
      setAnnouncement('One minute left.');
    }
    if (crossedBelow(prev, next, 0)) {
      setAnnouncement(mode === 'pomodoro' ? `${segmentLabel(segment)} complete.` : 'Time is up.');
      playChime('done');
      if (mode === 'pomodoro' && segment === 'focus') setCompletedFocus((count) => count + 1);
      setStatus('done');
    }
    setRemaining(next);
  }, [mode, segment]);

  // One interval and one listener, and only while a session is actually
  // running. 250ms rather than 1000 so the displayed second is never up to a
  // second stale; it is four renders a second of one small component on one
  // route, not anything that touches the 456-row sheet.
  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(sample, 250);
    // Coming back to a throttled tab should repaint at once rather than
    // showing a stale number until the next tick.
    const onVisibility = () => {
      if (!document.hidden) sample();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, sample]);

  function start(ms: number) {
    // Inside the click, which is the only moment a browser will open an audio
    // context. The warning is twenty minutes away and is not a gesture.
    primeAudio();
    deadline.current = performance.now() + ms;
    previous.current = ms;
    setTotal(ms);
    setRemaining(ms);
    setAnnouncement('');
    setStatus('running');
  }

  function pause() {
    const left = remainingMs(deadline.current, performance.now());
    previous.current = left;
    setRemaining(left);
    setStatus('paused');
  }

  function resume() {
    primeAudio();
    deadline.current = performance.now() + remaining;
    // Resuming must not re-announce a threshold that was already crossed
    // before the pause.
    previous.current = remaining;
    setStatus('running');
  }

  function reset() {
    // "Restart segment" replays the just-finished work round instead of
    // silently counting it twice toward the long break.
    if (status === 'done' && mode === 'pomodoro' && segment === 'focus') {
      setCompletedFocus((count) => Math.max(0, count - 1));
    }
    deadline.current = 0;
    previous.current = 0;
    setStatus('idle');
    setRemaining(0);
    setTotal(0);
    setAnnouncement('');
  }

  function chooseMode(next: 'pomodoro' | 'custom') {
    reset();
    setMode(next);
    setSegment('focus');
    setCompletedFocus(0);
  }

  function startNextSegment() {
    const next = nextPomodoroSegment(segment, completedFocus);
    setSegment(next);
    start(segmentDuration(next, lengths));
  }

  const ringSize = isFullscreen ? 'min(60vmin, 420px)' : 'min(52vw, 228px)';
  const figureSize = isFullscreen ? 190 : 140;
  // Remaining, not elapsed: a countdown ring should empty as the time does.
  const left = live || status === 'done' ? 1 - elapsedFraction(remaining, total) : 1;

  return (
    <div
      ref={shell}
      className={cn(
        // --surface, not --plane, because the digits go to --critical in the
        // last minute and that pairing is what `npm run check:color` measures.
        'skin-card relative flex flex-col overflow-x-hidden overflow-y-auto border border-hairline bg-surface text-ink',
        isFullscreen && 'h-screen w-screen justify-center rounded-none border-0',
      )}
    >
      {/* The same faint wash the dashboard hero uses, so the two read as the
          same family of surface rather than two different cards. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ background: 'radial-gradient(85% 65% at 50% 0%, var(--accent) 0%, transparent 65%)' }}
      />

      <div className="relative flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <p className="inline-flex items-center gap-1.5 text-xs text-ink-muted tnum">
          <Clock3 className="size-3.5" aria-hidden />
          {/* Zero is the pre-hydration snapshot: the server cannot know the
              time, and printing its own would be a different answer from the
              browser's a moment later. */}
          <span>{wallClock ? formatClock(wallClock, timeZone) : '--:--'}</span>
        </p>
        <SoundToggle effects={effects} />
      </div>

      <div className="relative flex flex-wrap items-center justify-center gap-2 px-4 pt-4 sm:px-5">
        <div className="skin-pill inline-flex gap-1 border border-hairline bg-surface-2 p-1" role="group" aria-label="Focus timer mode">
          {(['pomodoro', 'custom'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={mode === choice}
              disabled={status === 'running' || status === 'paused'}
              onClick={() => chooseMode(choice)}
              className={cn('skin-pill min-h-10 px-4 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent', mode === choice ? 'bg-accent text-accent-ink' : 'text-ink-muted hover:text-ink')}
            >
              {choice === 'pomodoro' ? 'Pomodoro' : 'Custom timer'}
            </button>
          ))}
        </div>
        {mode === 'pomodoro' && <span className="text-xs font-medium text-ink-muted">{segmentLabel(segment)} · {segment === 'focus' ? `Round ${round} of 4${status === 'done' ? ' complete' : ''}` : `${cycleProgress} of 4 rounds complete`}</span>}
      </div>

      <div
        className={cn(
          'relative flex flex-col items-center gap-4 px-4 pt-3 pb-5 sm:px-5',
          isFullscreen && 'flex-1 justify-center gap-7',
        )}
      >
        {/* Wraps rather than shrinking: on a narrow screen in fullscreen the
            ring and the figure together are wider than the viewport, and
            wrapping puts the figure underneath instead of clipping the ring. */}
        <div className={cn('flex flex-wrap items-center justify-center gap-3 sm:gap-6', isFullscreen && 'sm:gap-10')}>
          <div
            className="relative shrink-0"
            style={{
              width: ringSize,
              height: ringSize,
              // The digits are sized in `em` off the ring itself, so one CSS
              // length drives both and a long "1:00:00" shrinks to fit instead
              // of spilling out of the circle.
              fontSize: `calc(${ringSize} * ${label.length > 5 ? 0.185 : 0.265})`,
            }}
          >
            <svg viewBox={`0 0 ${BOX} ${BOX}`} className="size-full -rotate-90" aria-hidden>
              <circle cx={BOX / 2} cy={BOX / 2} r={RADIUS} fill="none" stroke="var(--grid)" strokeWidth={STROKE} />
              <circle
                cx={BOX / 2}
                cy={BOX / 2}
                r={RADIUS}
                fill="none"
                // --critical is validated as text against --surface in all six
                // theme/mode combinations, so it clears the mark floor too.
                // --warning is not — 1.79:1 on a light surface — which is why
                // the warning tier escalates with a filled pill and never with
                // a stroke.
                stroke={phase === 'critical' && live ? 'var(--critical)' : 'var(--accent)'}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - left)}
                style={reduced ? undefined : { transition: 'stroke-dashoffset 260ms linear' }}
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center gap-[0.1em]">
              <div
                role="timer"
                aria-atomic="true"
                aria-label={live || status === 'done' ? describeRemaining(remaining) : 'No timer running'}
                className="font-semibold tabular-nums"
                style={{
                  fontSize: '1em',
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                  color: phase === 'critical' && live ? 'var(--critical)' : undefined,
                }}
              >
                {label}
              </div>
              {/* Waits for the wall clock rather than reaching for Date.now()
                  here: reading the time during render is both impure and a
                  different answer from the one the server rendered. */}
              {live && wallClock ? (
                <p className="text-ink-muted tnum" style={{ fontSize: '0.2em' }}>
                  ends {finishesAt(wallClock, remaining, timeZone)}
                </p>
              ) : null}
            </div>
          </div>

          <CharacterFigure
            pose={status === 'running' ? 'focused' : status === 'done' ? 'celebrate' : 'idle'}
            size={figureSize}
          />
        </div>

        {/* The visual half of the warning. Colour never carries it alone — the
            words change at every tier too. */}
        <StatusPill status={status} phase={phase} reduced={reduced} doneLabel={mode === 'pomodoro' ? `${segmentLabel(segment)} complete` : 'Session complete'} />

        <div className="flex flex-wrap items-center justify-center gap-2">
          {status === 'idle' && mode === 'custom' ? (
            <form
              className="flex flex-wrap items-center justify-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (parsed) start(parsed);
              }}
            >
              <label htmlFor="focus-length" className="sr-only">
                How long
              </label>
              <input
                id="focus-length"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-describedby="focus-length-hint"
                aria-invalid={input.trim() !== '' && parsed === null}
                autoComplete="off"
                className={cn(
                  'skin-pill h-11 w-24 border border-control bg-surface-2 px-3 text-center text-sm font-medium',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                )}
              />
              <Button type="submit" className="min-h-11" disabled={!parsed}>
                <Play className="size-4" />
                Start
              </Button>
            </form>
          ) : null}

          {status === 'idle' && mode === 'pomodoro' ? (
            <Button type="button" className="min-h-11 px-6" onClick={() => start(segmentDuration(segment, lengths))}>
              <Play className="size-4" /> Start {segmentLabel(segment).toLowerCase()}
            </Button>
          ) : null}

          {status === 'done' && mode === 'pomodoro' ? (
            <Button type="button" className="min-h-11 px-6" onClick={startNextSegment}>
              <Play className="size-4" /> Start {segmentLabel(nextPomodoroSegment(segment, completedFocus)).toLowerCase()}
            </Button>
          ) : null}

          {status === 'running' ? (
            <Button type="button" variant="outline" className="min-h-11" onClick={pause}>
              <Pause className="size-4" />
              Pause
            </Button>
          ) : null}

          {status === 'paused' ? (
            <Button type="button" className="min-h-11" onClick={resume}>
              <Play className="size-4" />
              Resume
            </Button>
          ) : null}

          {status !== 'idle' ? (
            <Button type="button" variant="outline" className="min-h-11" onClick={reset}>
              <RotateCcw className="size-4" />
              {status === 'done' ? (mode === 'pomodoro' ? 'Restart segment' : 'Again') : 'Reset'}
            </Button>
          ) : null}

          {mode === 'pomodoro' && segment !== 'focus' && status !== 'done' ? (
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => { reset(); setSegment('focus'); }}>
              Skip break
            </Button>
          ) : null}

          {canFullscreen ? (
            // No aria-label: the visible words are the accessible name, so the
            // two cannot drift apart and a voice-control user can say what
            // they can see.
            <Button type="button" variant="ghost" className="min-h-11" onClick={toggleFullscreen}>
              {isFullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />}
              {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </Button>
          ) : null}
        </div>

        {status === 'idle' && mode === 'custom' ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap justify-center gap-2">
              {PRESETS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 px-4"
                  onClick={() => start(m * 60_000)}
                >
                  {m} min
                </Button>
              ))}
            </div>
            <p id="focus-length-hint" className="text-center text-xs text-ink-muted">
              {input.trim() !== '' && parsed === null
                ? 'Try 25, 45m, 1h30m or 25:00.'
                : 'Minutes — or something like 1h30m or 25:00.'}
            </p>
          </div>
        ) : null}

        {mode === 'pomodoro' && (
          <div className="w-full max-w-md space-y-3 text-center">
            <div className="flex items-center justify-center gap-2" aria-label={`${cycleProgress} of 4 focus rounds finished in this cycle`}>
              {[0, 1, 2, 3].map((round) => (
                <span key={round} className={cn('h-1.5 w-12 rounded-full transition-colors', round < cycleProgress ? 'bg-accent' : 'bg-grid')} />
              ))}
            </div>
            <p className="text-xs text-ink-muted">Four focus rounds earn a longer break. Breaks start when you choose.</p>
            {status === 'idle' && (
              <details className="text-left text-xs text-ink-muted">
                <summary className="cursor-pointer text-center text-accent focus-visible:outline-2 focus-visible:outline-accent">Adjust work and break lengths</summary>
                <div className="mt-3 flex flex-wrap justify-center gap-3">
                  {([
                    ['focus', 'Focus', [15, 25, 45, 50]],
                    ['shortBreak', 'Short break', [5, 10]],
                    ['longBreak', 'Long break', [15, 20, 30]],
                  ] as const).map(([key, title, options]) => (
                    <label key={key} className="flex flex-col gap-1 text-ink-2">
                      {title}
                      <select value={lengths[key]} onChange={(e) => setLengths((previous) => ({ ...previous, [key]: Number(e.target.value) }))} className="skin-pill min-h-11 border border-control bg-surface-2 px-3 text-ink focus-visible:outline-2 focus-visible:outline-accent">
                        {options.map((n) => <option key={n} value={n}>{n} min</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="relative mx-4 mb-4 sm:mx-5 sm:mb-5">
        <AttentionMonitor active={status === 'running' && (mode === 'custom' || segment === 'focus')} />
      </div>

      {/* The spoken half. Only the milestones go here — announcing every second
          of a countdown would make the page unusable with a screen reader,
          which is also why the digits above are role="timer" (live off) rather
          than a live region. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/**
 * Sound and haptics, the app-wide preference the tick already uses.
 *
 * Priming the audio context here rather than only on start matters: turning it
 * on is a click, and a click is the only moment a browser will resume one.
 */
function SoundToggle({ effects }: { effects: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={effects}
      onClick={() => {
        const next = !effects;
        setEffects(next);
        if (next) primeAudio();
      }}
      className={cn(
        'skin-pill inline-flex min-h-11 items-center gap-1.5 px-3 text-xs transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        effects ? 'text-ink-2 hover:bg-surface-2' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {effects ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
      Timer sounds: {effects ? 'on' : 'off'}
    </button>
  );
}

function StatusPill({
  status,
  phase,
  reduced,
  doneLabel,
}: {
  status: Status;
  phase: ReturnType<typeof phaseFor>;
  reduced: boolean;
  doneLabel: string;
}) {
  if (status === 'done') {
    // The accent pairing rather than --good: --good has no validated ink token
    // of its own, and accent/accent-ink is already measured in all six
    // theme/mode combinations. It is the same fill the celebration overlay
    // uses for its bigger tiers, so a finished session reads like one.
    return (
      <span className="skin-pill bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">
        {doneLabel}
      </span>
    );
  }
  if (status === 'paused') {
    return (
      <span className="skin-pill border border-hairline bg-surface-2 px-3 py-1 text-xs font-semibold text-ink-2">
        Paused
      </span>
    );
  }
  if (status !== 'running' || (phase !== 'warning' && phase !== 'critical')) return null;

  const critical = phase === 'critical';
  return (
    <span
      // The pulse is decoration and is dropped under reduced motion. The digits
      // changing are not — that is the information, and suppressing it would
      // leave a stopped clock. The check has to happen in JS: the CSS rule in
      // globals.css can shorten an animation but cannot stop one being asked
      // for by a JS-driven component.
      className={cn('skin-pill px-3 py-1 text-xs font-semibold', critical && !reduced && 'js-pulse')}
      style={{
        background: critical ? 'var(--critical)' : 'var(--warning)',
        color: critical ? 'var(--critical-ink)' : 'var(--warning-ink)',
      }}
    >
      {critical ? 'Under a minute' : 'Final five minutes'}
    </span>
  );
}

/*
 * The hooks below read a browser fact rather than hold state, so they go
 * through useSyncExternalStore like everything else in this app that reads one
 * (see appearance.ts). Mirroring the value into state with an effect would
 * render once with the wrong answer and then again with the right one — and
 * React's own lint rule refuses it.
 *
 * Every subscribe and snapshot function is module-scope so its identity is
 * stable; a fresh closure per render re-subscribes on every pass.
 */
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const subscribeReducedMotion = (onChange: () => void) => {
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const getReducedMotion = () => matchMedia(REDUCED_MOTION).matches;

const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};
const getFullscreenEnabled = () => Boolean(document.fullscreenEnabled);

/** Nothing to subscribe to: whether the API exists does not change. */
const subscribeNever = () => () => {};

/** The server cannot know any of these, and these are the safe answers. */
const serverFalse = () => false;
const serverClock = () => 0;

/**
 * One second-hand for the wall clock, shared by every subscriber and stopped
 * when the last one leaves.
 *
 * The snapshot is a cached number rather than a fresh `Date.now()`: getSnapshot
 * runs on every render and React bails only when the result is unchanged, so
 * reading the clock directly would be an endless re-render.
 */
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(onChange: () => void) {
  clockListeners.add(onChange);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((listener) => listener());
    }, 1000);
  }
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
const getClock = () => clockNow;

/** Reduced-motion, read in JS because a CSS rule cannot reach a JS decision. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, serverFalse);
}

/**
 * The real Fullscreen API.
 *
 * Driven by `fullscreenchange` rather than by the toggle, so pressing Escape —
 * the exit path every browser offers and none of them route through our button
 * — still leaves the component in the right state.
 */
function useFullscreen(target: React.RefObject<HTMLElement | null>) {
  const getIsFullscreen = useCallback(
    // The null check is load-bearing: before this mounts, `target.current` and
    // `document.fullscreenElement` are both null, and comparing them alone
    // would report the page as fullscreen on the very first render.
    () => document.fullscreenElement !== null && document.fullscreenElement === target.current,
    [target],
  );
  const isFullscreen = useSyncExternalStore(subscribeFullscreen, getIsFullscreen, serverFalse);
  const canFullscreen = useSyncExternalStore(subscribeNever, getFullscreenEnabled, serverFalse);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await target.current?.requestFullscreen();
    } catch {
      // Refused by the browser, or blocked by a permissions policy. The
      // in-page timer is unaffected, so there is nothing worth saying.
    }
  }, [target]);

  return { isFullscreen, canFullscreen, toggleFullscreen };
}
