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
      lastTap.current = 0;
      poke();
      return;
    }
    lastTap.current = now;
    // A single tap must not open the panel until the double-tap window has
    // closed, or every double-tap would also open it underneath itself.
    setTimeout(() => {
      if (lastTap.current === now) onOpen?.();
    }, DOUBLE_TAP_MS);
  }

  // ---- keyboard ----------------------------------------------------------
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') primeAudio();
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

  return (
    <div
      // Below the nav (z-30) and the celebration overlay (z-40) on purpose, so
      // it can never take a click meant for a tab or sit over a celebration.
      className="fixed z-20 touch-none select-none"
      style={{ left: position.x, top: position.y, width: SIZE, height: SIZE }}
    >
      <button
        type="button"
        aria-label="Your companion. Click to talk, drag or use the arrow keys to move it, Home to send it back to the corner."
        aria-haspopup="dialog"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={cn(
          'skin-pill grid size-full touch-none place-items-center rounded-full transition-[transform,background-color]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'hover:bg-accent/10 active:scale-95',
          dragging ? 'cursor-grabbing bg-accent/10' : 'cursor-grab',
        )}
      >
        <CharacterFigure pose={pose} size={SIZE} />
      </button>
    </div>
  );
}
