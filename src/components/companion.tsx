'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { Maximize2, MessageCircle, Minimize2 } from 'lucide-react';
import { CharacterFigure, type MisoExpression } from './character-figure';
import { useActiveCharacter } from './character-provider';
import { BARE_ROUTES } from './nav';
import { misoFrameUrl, type Pose } from '@/lib/characters';
import {
  DOUBLE_TAP_MS, HOLD_MS, NUDGE, NUDGE_FAR, TAP_SLOP,
  clampToViewport, defaultPosition, getCompanionCompact, getCompanionDismissed, getCompanionPosition,
  pokeReaction, serverCompanionCompact, serverCompanionDismissed, serverCompanionPosition,
  setCompanionCompact, setCompanionPosition, subscribeCompanion, touchZone, trimPokes,
  type Point, type Safe, type TouchZone,
} from '@/lib/companion';
import { hasSpeechLevel, speechLevel } from '@/lib/kokoro';
import { primeAudio } from '@/lib/speech';
import { cn } from '@/lib/utils';

/** Double the old 104px figure. Compact is an opt-in escape hatch on phones. */
export const COMPANION_SIZE = 208;
const COMPACT_SIZE = 104;
const SAFE_DESKTOP: Safe = { top: 68, right: 16, bottom: 20, left: 16 };
const SAFE_PHONE: Safe = { top: 68, right: 12, bottom: 96, left: 12 };

type Physical = {
  pose: Pose;
  expression?: MisoExpression;
  label: string;
  motion: 'pat' | 'tickle' | 'surprise' | 'wave' | 'cuddle' | 'grumpy' | 'land';
};

const TOUCH: Record<TouchZone, Physical> = {
  head: { pose: 'laughing', expression: 'patted', label: 'That’s nice ♡', motion: 'pat' },
  hand: { pose: 'celebrate', expression: 'winking', label: 'High five! ✨', motion: 'wave' },
  body: { pose: 'laughing', expression: 'tickled', label: 'Hehe, tickles!', motion: 'tickle' },
  feet: { pose: 'jumping', expression: 'surprised', label: 'Whoa!', motion: 'surprise' },
};

/** A physical little character: tap different places, hold, or pick her up. */
export function Companion({ onOpen, overridePose }: { onOpen?: () => void; overridePose?: Pose | null }) {
  const pathname = usePathname();
  const character = useActiveCharacter();
  const stored = useSyncExternalStore(subscribeCompanion, getCompanionPosition, serverCompanionPosition);
  const dismissed = useSyncExternalStore(subscribeCompanion, getCompanionDismissed, serverCompanionDismissed);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const compact = useSyncExternalStore(subscribeCompanion, getCompanionCompact, serverCompanionCompact);
  const [dragPoint, setDragPoint] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [reaction, setReaction] = useState<(Physical & { id: number }) | null>(null);
  const reactionSeq = useRef(0);
  const grab = useRef<{ dx: number; dy: number; x: number; y: number; moved: boolean; held: boolean } | null>(null);
  const dragRef = useRef<Point | null>(null);
  const pokes = useRef<number[]>([]);
  const lastTap = useRef(0);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shell = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => () => {
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  // Physical reactions must be ready on the first touch. These four local
  // cutouts total under 200 KB; the optimized route would start on demand
  // and can easily outlive a one-second expression on a cold server.
  useEffect(() => {
    if (character?.id !== 'miso') return;
    for (const frame of ['patted', 'tickled', 'surprised', 'winking']) {
      const image = new window.Image();
      image.src = misoFrameUrl(frame);
    }
  }, [character?.id]);

  const talking = overridePose === 'talking';
  const [metered, setMetered] = useState(false);
  useEffect(() => {
    if (!talking) return;
    const id = setInterval(() => setMetered(hasSpeechLevel()), 120);
    return () => clearInterval(id);
  }, [talking]);

  useEffect(() => {
    const node = shell.current;
    if (!node || !talking || !metered) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let smoothed = 0;
    const step = () => {
      const level = speechLevel();
      smoothed = level > smoothed ? level : smoothed * 0.82 + level * 0.18;
      node.style.setProperty('--voice', smoothed.toFixed(3));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); node.style.removeProperty('--voice'); };
  }, [talking, metered]);

  const size = compact ? COMPACT_SIZE : COMPANION_SIZE;
  const safe = viewport && viewport.width < 640 ? SAFE_PHONE : SAFE_DESKTOP;
  const position = viewport
    ? clampToViewport(dragPoint ?? stored ?? defaultPosition(size, viewport, safe), size, viewport, safe)
    : null;

  const react = useCallback((next: Physical, ms = 1100) => {
    setReaction({ ...next, id: ++reactionSeq.current });
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReaction(null), ms);
  }, []);

  const move = useCallback((next: Point, persist = false) => {
    if (!viewport) return;
    const at = clampToViewport(next, size, viewport, safe);
    if (persist) setCompanionPosition(at);
    else { dragRef.current = at; setDragPoint(at); }
  }, [viewport, size, safe]);

  function clearHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!position || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { dx: e.clientX - position.x, dy: e.clientY - position.y, x: e.clientX, y: e.clientY, moved: false, held: false };
    setPressed(true);
    clearHold();
    holdTimer.current = setTimeout(() => {
      if (!grab.current || grab.current.moved) return;
      grab.current.held = true;
      react({ pose: 'laughing', expression: 'patted', label: 'Stay a little ♡', motion: 'cuddle' }, 1400);
    }, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const held = grab.current;
    if (!held) return;
    if (!held.moved && Math.hypot(e.clientX - held.x, e.clientY - held.y) < TAP_SLOP) return;
    if (!held.moved) { held.moved = true; setDragging(true); clearHold(); }
    move({ x: e.clientX - held.dx, y: e.clientY - held.dy });
  }

  function finishPointer(e: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
    const held = grab.current;
    grab.current = null;
    clearHold();
    setPressed(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!held) return;
    if (held.moved) {
      setDragging(false);
      if (dragRef.current) setCompanionPosition(dragRef.current);
      dragRef.current = null;
      setDragPoint(null);
      if (!cancelled) react({ pose: 'jumping', label: 'Ta-da! ✨', motion: 'land' }, 800);
      return;
    }
    if (cancelled || held.held) return;
    const now = Date.now();
    const history = [...trimPokes(pokes.current, now), now];
    pokes.current = history;
    const annoyed = pokeReaction(history, now) === 'angry';
    const double = now - lastTap.current < DOUBLE_TAP_MS;
    lastTap.current = now;
    const zone = touchZone(e.clientX - (position?.x ?? 0), e.clientY - (position?.y ?? 0), size);
    react(annoyed
      ? { pose: 'angry', label: 'Hey, gentle! ♡', motion: 'grumpy' }
      : double
        ? { pose: 'laughing', expression: 'winking', label: 'Got you! ✨', motion: 'wave' }
        : TOUCH[zone]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      react(TOUCH.head);
      return;
    }
    if (!position || !viewport) return;
    const step = e.shiftKey ? NUDGE_FAR : NUDGE;
    const delta: Record<string, Point> = {
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
    };
    const d = delta[e.key];
    if (d) {
      e.preventDefault();
      move({ x: position.x + d.x, y: position.y + d.y }, true);
      react({ pose: 'jumping', label: 'Whee!', motion: 'land' }, 700);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(defaultPosition(size, viewport, safe), true);
    }
  }

  if (!character || dismissed || !position) return null;
  if (BARE_ROUTES.some((p) => pathname.startsWith(p))) return null;

  // Speech and thinking keep their lip-sync/status; a pat can interrupt idle
  // or listening without shutting the conversation down.
  const busy = overridePose === 'talking' || overridePose === 'floating';
  const pose: Pose = dragging ? 'floating' : (busy ? overridePose : reaction?.pose ?? overridePose ?? 'idle');
  const thinking = overridePose === 'floating' && !dragging;
  const listening = overridePose === 'listening' && !dragging;

  return (
    <div className={cn('companion-stage fixed z-20 select-none', compact && 'is-compact')}
      style={{ left: position.x, top: position.y, width: size, height: size }}>
      <span className="companion-aura" aria-hidden />
      {reaction && <span key={reaction.id} className="companion-emote" role="status">{reaction.label}</span>}
      <span className={cn('companion-particles', reaction && `companion-particles-${reaction.motion}`)} aria-hidden>
        <i>✦</i><i>♡</i><i>✧</i>
      </span>
      <button type="button" data-companion-figure=""
        aria-label="Play with Miso: tap her head, hand or body; hold to cuddle; drag or use arrow keys to move. Talk is a separate button."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={(e) => finishPointer(e)} onPointerCancel={(e) => finishPointer(e, true)}
        onKeyDown={onKeyDown}
        className={cn('companion-figure group relative grid size-full touch-none place-items-center rounded-full',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          dragging ? 'cursor-grabbing' : 'cursor-grab', pressed && 'is-pressed',
          reaction && `companion-gesture-${reaction.motion}`, listening && 'js-halo')}>
        <span ref={shell} className={cn('grid size-full place-items-center', thinking && 'js-think',
          talking && (metered ? 'js-voice' : 'js-speak'))}>
          <CharacterFigure pose={pose} expression={busy ? null : reaction?.expression} size={size} />
        </span>
      </button>
      <div className="companion-controls">
        <button type="button" aria-label={compact ? 'Make Miso big again' : 'Make Miso smaller'}
          title={compact ? 'Make Miso big again' : 'Make Miso smaller'}
          onClick={() => {
            const next = !compact;
            // Keep her right/bottom edge anchored while changing sizes; a
            // phone's minimized figure should not suddenly float mid-screen.
            if (viewport) {
              const nextSize = next ? COMPACT_SIZE : COMPANION_SIZE;
              const delta = size - nextSize;
              setCompanionPosition(clampToViewport(
                { x: position.x + delta, y: position.y + delta }, nextSize, viewport, safe,
              ));
            }
            setCompanionCompact(next);
          }} className="companion-size-control">
          {compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
        </button>
        <button type="button" data-companion-figure="" aria-haspopup="dialog"
          aria-label="Talk with Miso" onClick={() => { primeAudio(); onOpen?.(); }}
          className="companion-talk-control"><MessageCircle size={17} /><span>Talk</span></button>
      </div>
    </div>
  );
}
