'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Expand, Pause, Play, RotateCcw, Shrink, Volume2, VolumeX } from 'lucide-react';
import { CharacterFigure } from './character-figure';
import { Button } from './ui/button';
import { ProgressBar } from './progress-bar';
import { getEffects, serverEffects, setEffects, subscribe } from '@/lib/appearance';
import { playChime, primeAudio } from '@/lib/effects';
import {
  CRITICAL_MS,
  WARNING_MS,
  crossedBelow,
  describeRemaining,
  elapsedFraction,
  formatRemaining,
  parseDuration,
  phaseFor,
  remainingMs,
} from '@/lib/timer';
import { cn } from '@/lib/utils';

/**
 * A countdown for one sitting.
 *
 * All the arithmetic lives in `@/lib/timer` and is tested there; this component
 * only samples a clock and draws the result. The clock is `performance.now()`
 * rather than `Date.now()` on purpose — it is monotonic, so changing the system
 * clock (or a DST shift, or an NTP correction) cannot move the finish line, and
 * it keeps advancing while the tab is in the background, which `setInterval`
 * does not.
 *
 * It is deliberately scoped to this page. The session ends if you navigate
 * away, because the app has no server-side session state and persisting one
 * across routes would mean inventing the "currently working" signal rather than
 * measuring it.
 */
const PRESETS = [15, 25, 50];

type Status = 'idle' | 'running' | 'paused' | 'done';

export function FocusTimer() {
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
  const shell = useRef<HTMLDivElement>(null);
  const { isFullscreen, canFullscreen, toggleFullscreen } = useFullscreen(shell);

  const parsed = parseDuration(input);
  const phase = phaseFor(remaining);
  const live = status === 'running' || status === 'paused';

  const sample = useCallback(() => {
    const next = remainingMs(deadline.current, performance.now());
    const prev = previous.current;
    previous.current = next;

    // Comparing samples rather than testing the current value is what survives
    // a backgrounded tab: timers there are throttled to once a minute or worse,
    // so the sample after 8:00 can be 2:00 and must still count as crossing 5.
    if (crossedBelow(prev, next, WARNING_MS)) {
      setAnnouncement('Five minutes left.');
      playChime('warning');
    } else if (crossedBelow(prev, next, CRITICAL_MS)) {
      setAnnouncement('One minute left.');
    }
    if (crossedBelow(prev, next, 0)) {
      setAnnouncement('Time is up.');
      playChime('done');
      setStatus('done');
    }
    setRemaining(next);
  }, []);

  // One interval and one listener, and only while a session is actually
  // running. 250ms rather than 1000 so the displayed second is never up to a
  // second stale; it is four renders a second of one small component on one
  // route, not anything that touches the 456-row sheet.
  useEffect(() => {
    if (status !== 'running') return;
    sample();
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
    deadline.current = 0;
    previous.current = 0;
    setStatus('idle');
    setRemaining(0);
    setTotal(0);
    setAnnouncement('');
  }

  return (
    <div
      ref={shell}
      className={cn(
        // --surface, not --plane, because the digits go to --critical in the
        // last minute and that pairing is what `npm run check:color` measures.
        'skin-card flex flex-col items-center gap-4 border border-hairline bg-surface p-5 text-ink',
        isFullscreen && 'h-screen w-screen justify-center gap-6 rounded-none border-0 p-6',
      )}
    >
      <CharacterFigure
        pose={status === 'running' ? 'focused' : status === 'done' ? 'celebrate' : 'idle'}
        size={isFullscreen ? 96 : 64}
      />

      <div
        role="timer"
        aria-atomic="true"
        aria-label={live || status === 'done' ? describeRemaining(remaining) : 'No timer running'}
        className="font-semibold tabular-nums"
        style={{
          // Bounded by height as well as width so a long "1:00:00" cannot
          // overflow a narrow phone or a short landscape window.
          fontSize: isFullscreen
            ? 'clamp(3rem, min(18vw, 26vh), 14rem)'
            : 'clamp(2.75rem, min(15vw, 20vh), 6rem)',
          lineHeight: 1,
          letterSpacing: '-0.03em',
          // Validated as text against --surface in all six theme/mode
          // combinations. --warning is not, at 1.79:1, which is why the tier
          // below it escalates with a filled pill instead of coloured digits.
          color: phase === 'critical' ? 'var(--critical)' : undefined,
        }}
      >
        {formatRemaining(live || status === 'done' ? remaining : (parsed ?? 0))}
      </div>

      {/* The visual half of the warning. Colour never carries it alone — the
          words change at every tier too. */}
      <StatusPill status={status} phase={phase} reduced={reduced} />

      <div className="w-full max-w-md">
        <ProgressBar
          value={live || status === 'done' ? elapsedFraction(remaining, total) * 100 : 0}
          height={6}
          label="Session progress"
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {status === 'idle' ? (
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
                'skin-pill h-11 w-28 border border-control bg-surface-2 px-3 text-center text-sm',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              )}
            />
            <Button type="submit" className="min-h-11" disabled={!parsed}>
              <Play className="size-4" />
              Start
            </Button>
          </form>
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
            {status === 'done' ? 'Again' : 'Reset'}
          </Button>
        ) : null}

        {canFullscreen ? (
          // No aria-label: the visible words are the accessible name, so the
          // two cannot drift apart and a voice-control user can say what they
          // can see.
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />}
            {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </Button>
        ) : null}
      </div>

      {status === 'idle' ? (
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
        Chime at five minutes: {effects ? 'on' : 'off'}
      </button>

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

function StatusPill({
  status,
  phase,
  reduced,
}: {
  status: Status;
  phase: ReturnType<typeof phaseFor>;
  reduced: boolean;
}) {
  if (status === 'done') {
    // The accent pairing rather than --good: --good has no validated ink token
    // of its own, and accent/accent-ink is already measured in all six
    // theme/mode combinations. It is the same fill the celebration overlay
    // uses for its bigger tiers, so a finished session reads like one.
    return (
      <span className="skin-pill bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">
        Session complete
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
 * Both hooks below read a browser fact rather than hold state, so they go
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

/** The server cannot know either of these, and false is the safe answer. */
const serverFalse = () => false;

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
