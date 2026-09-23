'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { CharacterFigure } from './character-figure';
import { useActiveCharacter } from './character-provider';
import { BARE_ROUTES } from './nav';
import type { Pose } from '@/lib/characters';
import {
  DOUBLE_TAP_MS,
  NUDGE,
  NUDGE_FAR,
  TAP_SLOP,
  clampToViewport,
  defaultPosition,
  getCompanionDismissed,
  getCompanionPosition,
  pokeReaction,
  serverCompanionDismissed,
  serverCompanionPosition,
  setCompanionPosition,
  subscribeCompanion,
  trimPokes,
  type Point,
  type Safe,
} from '@/lib/companion';
import { hasSpeechLevel, speechLevel } from '@/lib/kokoro';
import { primeAudio } from '@/lib/speech';
import { cn } from '@/lib/utils';

/**
 * The character, loose on the page: pick it up, move it, poke it, talk to it.
 *
 * Only appears once a character has actually been chosen. A fresh checkout has
 * none selected, so the app looks exactly as it did before this existed —
 * which is the same rule the character picker itself follows.
 *
 * It deliberately sits *below* the nav and the celebration overlay in the
 * stack, and its position is clamped clear of both bars, so it can never cover
 * a tab, the sign-out button, or the mobile bottom bar. It cannot cover a tick
 * box either for long: it is a small target and the whole point is that it
 * moves.
 */
const SIZE = 104;

/** Clear of the sticky header, and of the phone tab bar plus its safe area. */
const SAFE_DESKTOP: Safe = { top: 68, right: 16, bottom: 20, left: 16 };
const SAFE_PHONE: Safe = { top: 68, right: 12, bottom: 96, left: 12 };

export function Companion({
  onOpen,
  overridePose,
}: {
  onOpen?: () => void;
  /** Wins over every reaction — it is a state, not a moment. */
  overridePose?: Pose | null;
}) {
  const pathname = usePathname();
  const character = useActiveCharacter();
  const stored = useSyncExternalStore(subscribeCompanion, getCompanionPosition, serverCompanionPosition);
  const dismissed = useSyncExternalStore(
    subscribeCompanion,
    getCompanionDismissed,
    serverCompanionDismissed,
  );

  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reaction, setReaction] = useState<Pose | null>(null);

  const grab = useRef<{ dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  const pokes = useRef<number[]>([]);
  const lastTap = useRef(0);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shell = useRef<HTMLSpanElement>(null);

  // One resize listener for the whole feature, and it only exists while the
  // companion is on screen.
  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(
    () => () => {
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
    },
    [],
  );

  /**
   * The figure moves with the voice, not with a timer.
   *
   * `speechLevel` is the loudness of what is actually coming out of the
   * speaker this frame, so the motion lands on the syllables instead of
   * merely happening at the same time as them — which is the difference
   * between a figure that is talking and a figure that is wobbling. Written
   * straight to a custom property rather than through state: this runs every
   * frame, and a re-render per frame would cost more than the whole rest of
   * the panel.
   */
  const talking = overridePose === 'talking';
  /**
   * Whether the voice is one this can actually measure.
   *
   * Only the neural and hosted voices go through this file's audio graph. The
   * browser's own `speechSynthesis` cannot be captured, so on that voice the
   * level is a flat zero — and the frame loop below was running for the whole
   * length of every reply to write `--voice: 0.000` sixty times a second.
   */
  const [metered, setMetered] = useState(false);
  useEffect(() => {
    if (!talking) return;
    // Asked repeatedly rather than once: on the neural voice the first clip
    // can be a second or two behind the turn changing. The answer is not reset
    // when it stops talking — it is asked again within a frame or two of the
    // next reply starting, and nothing reads it in between.
    const id = setInterval(() => setMetered(hasSpeechLevel()), 120);
    return () => clearInterval(id);
  }, [talking]);

  useEffect(() => {
    const node = shell.current;
    if (!node || !talking || !metered) return;
    // The reduced-motion rule in globals.css can shorten an animation but it
    // cannot tell a transform written from JavaScript every frame to stop
    // asking for one, so this has to check for itself — the same reason the
    // focus timer's countdown does.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let smoothed = 0;
    const step = () => {
      const level = speechLevel();
      // Attack fast, release slow. A mouth opens quicker than it closes, and
      // tracking the fall as sharply as the rise is what makes a level meter
      // look like a level meter rather than like breathing.
      smoothed = level > smoothed ? level : smoothed * 0.82 + level * 0.18;
      node.style.setProperty('--voice', smoothed.toFixed(3));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      node.style.removeProperty('--voice');
    };
  }, [talking, metered]);

  const safe = viewport && viewport.width < 640 ? SAFE_PHONE : SAFE_DESKTOP;
  // Clamped on every read, not only on write: a position saved on a wider
  // window, or before the phone was turned, has to come back somewhere it can
  // be reached rather than off the edge.
  const position: Point | null = viewport
    ? clampToViewport(stored ?? defaultPosition(SIZE, viewport, safe), SIZE, viewport, safe)
    : null;

  const react = useCallback((pose: Pose, holdMs: number) => {
    setReaction(pose);
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReaction(null), holdMs);
  }, []);

  const move = useCallback(
    (next: Point) => {
      if (!viewport) return;
      setCompanionPosition(clampToViewport(next, SIZE, viewport, safe));
    },
    [viewport, safe],
  );

  function poke() {
    const now = Date.now();
    const history = [...trimPokes(pokes.current, now), now];
    pokes.current = history;
    const pose = pokeReaction(history, now);
    react(pose, pose === 'angry' ? 700 : 900);
  }

  // ---- pointer -----------------------------------------------------------
  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!position) return;
    // Captured on the element the handlers are actually on. Capturing on the
    // wrapper instead redirects every subsequent pointermove to an element
    // with no listener, and the drag silently does nothing.
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { dx: e.clientX - position.x, dy: e.clientY - position.y, x: e.clientX, y: e.clientY, moved: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const held = grab.current;
    if (!held) return;
    if (!held.moved && Math.hypot(e.clientX - held.x, e.clientY - held.y) < TAP_SLOP) return;
    // Past the slop it is a drag, not a tap — a few pixels of finger travel
    // must not turn opening the panel into moving the character.
    if (!held.moved) {
      held.moved = true;
      setDragging(true);
    }
    move({ x: e.clientX - held.dx, y: e.clientY - held.dy });
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const held = grab.current;
    grab.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!held) return;

    if (held.moved) {
      setDragging(false);
      react('jumping', 950);
      return;
    }

    // Inside the tap, before anything defers. Mobile Safari only grants
    // audio to code running in the gesture itself, and the open below goes
    // through a timer — so by the time the panel mounts and tries to say
    // hello, the gesture is over and the permission is gone.
    primeAudio();

    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      // The second tap of a double-tap is the poke, and only the poke. It no
      // longer toggles the panel, so poking the thing you are talking to
      // cannot close the conversation by accident.
      lastTap.current = 0;
      poke();
      return;
    }
    lastTap.current = now;
    // Immediately. This used to wait out the whole double-tap window before
    // opening, so every single tap cost 320 ms of nothing happening — paid by
    // everyone who only ever wanted to talk to it, to keep a double-tap from
    // opening the panel underneath itself. It cannot open underneath itself
    // any more, because the second tap does not open anything.
    onOpen?.();
  }

  // ---- keyboard ----------------------------------------------------------
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      // Everything else here is driven by pointer events, and a keyboard never
      // sends any — pressing Enter on a button synthesises a click and nothing
      // else. So this was a control that announced `aria-haspopup="dialog"`
      // and could not be opened from a keyboard at all.
      //
      // `preventDefault` is what keeps that synthesised click from arriving
      // afterwards and opening it a second time, and it also stops Space
      // scrolling the page.
      e.preventDefault();
      primeAudio();
      onOpen?.();
      return;
    }
    if (!position || !viewport) return;
    const step = e.shiftKey ? NUDGE_FAR : NUDGE;
    const delta: Record<string, Point> = {
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
    };
    const d = delta[e.key];
    if (d) {
      e.preventDefault();
      move({ x: position.x + d.x, y: position.y + d.y });
      react('jumping', 700);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      move(defaultPosition(SIZE, viewport, safe));
      react('jumping', 700);
    }
  }

  if (!character || dismissed || !position) return null;
  if (BARE_ROUTES.some((p) => pathname.startsWith(p))) return null;

  // Being carried beats everything; working out a reply beats a reaction that
  // has already happened; otherwise it is whatever it was last poked into.
  const pose: Pose = dragging ? 'floating' : (overridePose ?? reaction ?? 'idle');
  const thinking = overridePose === 'floating' && !dragging;
  const listening = overridePose === 'listening' && !dragging;

  return (
    <div
      // Below the nav (z-30) and the celebration overlay (z-40) on purpose, so
      // it can never take a click meant for a tab or sit over a celebration.
      className="fixed z-20 touch-none select-none"
      style={{ left: position.x, top: position.y, width: SIZE, height: SIZE }}
    >
      <button
        type="button"
        // The panel closes on a click outside itself, and this is outside it.
        // Without a way to recognise the figure, tapping it to dismiss the
        // panel closed it and then reopened it a moment later on the
        // double-tap timer — losing the whole conversation in between.
        data-companion-figure=""
        aria-label="Your companion. Click to talk, drag or use the arrow keys to move it, Home to send it back to the corner."
        aria-haspopup="dialog"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={cn(
          'skin-pill grid size-full touch-none place-items-center rounded-full transition-[background-color]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'hover:bg-accent/10 active:scale-95',
          dragging ? 'cursor-grabbing bg-accent/10' : 'cursor-grab',
          listening && 'js-halo',
        )}
      >
        {/* Two nested motions on purpose, because they mean different things
            and must be able to run at once: the shell carries the state the
            conversation is in, the inner span carries the voice itself. */}
        <span
          ref={shell}
          className={cn(
            'grid size-full place-items-center',
            // Working out a reply is the one state worth animating the whole
            // figure for. A second 3D canvas would have looked better still
            // and would have been competing for the processor with the voice
            // it is covering for, which is the wrong trade at exactly the
            // wrong moment.
            thinking && 'js-think',
            // Two different claims. With a level to read, the figure moves
            // with the syllables. Without one — the browser's own voice, which
            // cannot be measured — it breathes instead, which says "talking"
            // without pretending to know when the mouth opens.
            talking && (metered ? 'js-voice' : 'js-speak'),
          )}
        >
          <CharacterFigure pose={pose} size={SIZE} />
        </span>
      </button>
    </div>
  );
}
