'use client';

import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';
import { Mascot } from './mascot';
import { useActiveCharacter } from './character-provider';
import { getSkin, serverSkin, subscribe } from '@/lib/appearance';
import { resolvePose, type Character, type Pose } from '@/lib/characters';
import { THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';

/**
 * The renderer for characters that ship a model rather than pose images.
 *
 * Loaded through `next/dynamic` with no SSR, and referenced only on the branch
 * below that has already established there is a model to draw — so three.js is
 * never in the bundle a fresh checkout downloads, and never in the bundle of a
 * route whose figure resolves to an image or to the SVG mascot.
 */
const CharacterCanvas = dynamic(
  () => import('./character-canvas').then((m) => m.CharacterCanvas),
  { ssr: false },
);

/**
 * Draws whichever figure is active: an installed character's model, an
 * installed character's art, or the original SVG mascot.
 *
 * One component for all three so no caller has to branch. The fallback is
 * silent and total — no art installed, none chosen, a stale id, or a character
 * missing the pose all land on the mascot, and the mascot itself renders
 * nothing for the Studio skin, which deliberately has none.
 *
 * Motion depends on which of the three is drawing. A model animates itself, so
 * the CSS bob and hop are withheld from it — applying both would move the
 * figure twice. An image or a mascot keeps exactly the motion it always had:
 * a slow bob at rest, the squash-and-stretch hop for the celebratory poses,
 * transform-only and collapsed by the reduced-motion rule in globals.css.
 */
export function CharacterFigure({
  pose = 'idle',
  size = 72,
  priority = false,
  className,
}: {
  pose?: Pose;
  size?: number;
  /** Preloads the image. Only the dashboard's resting figure sets this. */
  priority?: boolean;
  className?: string;
}) {
  const character = useActiveCharacter();
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const src = resolvePose(character, pose);

  // A model carries its own motion and its own pose chain, so it is checked
  // before pose images and never combined with them.
  if (character?.model) {
    return (
      <span
        className={cn('relative inline-block shrink-0', className)}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <CharacterCanvas url={character.model} pose={pose} size={size} />
      </span>
    );
  }

  const motion = pose === 'celebrate' || pose === 'milestone' ? 'js-jump' : 'js-bob';

  if (!src) {
    const mascot = THEMES[skin].mascot;
    if (mascot === 'none') return null;
    return (
      <Mascot
        id={mascot}
        state={pose === 'celebrate' || pose === 'milestone' ? 'jump' : 'idle'}
        size={size}
        className={className}
      />
    );
  }

  return (
    // Fixed box with explicit image dimensions: the figure can never shift
    // layout while the art loads, which matters most in the celebration overlay.
    <span
      className={cn('relative inline-block shrink-0 overflow-hidden', motion, className)}
      style={{ width: size, height: size, transformOrigin: '50% 100%' }}
      aria-hidden
    >
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        priority={priority}
        sizes={`${size}px`}
        className="h-full w-full object-contain"
        draggable={false}
      />
    </span>
  );
}

/**
 * A thumbnail of a specific character, rather than the active one.
 *
 * The picker needs this: it lists every installed character side by side, so it
 * cannot go through `CharacterFigure`, which reads whichever one is selected.
 * It also cannot assume a pose image exists — a character that ships a model
 * has none at all, and the picker used to reach for `poses.idle!` and hand
 * `undefined` to next/image.
 */
export function CharacterThumb({
  character,
  size = 36,
}: {
  character: Character;
  size?: number;
}) {
  if (character.model) {
    return (
      <span className="inline-block" style={{ width: size, height: size }} aria-hidden>
        <CharacterCanvas url={character.model} pose="idle" size={size} />
      </span>
    );
  }
  const src = resolvePose(character, 'idle');
  if (!src) return null;
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className="object-contain"
      style={{ width: size, height: size }}
    />
  );
}

/** A resting figure for empty states and headers. */
export function CharacterBadge({
  size = 40,
  priority = false,
}: {
  size?: number;
  priority?: boolean;
}) {
  return <CharacterFigure pose="idle" size={size} priority={priority} />;
}
