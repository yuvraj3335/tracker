'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { AnimationMixer, LoopOnce, LoopRepeat, type Group } from 'three';
import { poseChain, type Pose } from '@/lib/characters';

/**
 * Renders a character that ships a model instead of pose images.
 *
 * This module is the only thing in the app that imports three.js, and nothing
 * imports it statically — `character-figure.tsx` reaches it through
 * `next/dynamic` and only when the selected character actually has a model. A
 * fresh checkout installs no characters, so the default experience never
 * downloads a renderer it has no use for.
 *
 * Poses are animation clips on one model rather than six files, which is what
 * makes them the same character in six states by construction. A clip that is
 * not in the file degrades through `poseChain` — the same order pose images
 * use — so a model with only `idle` is as valid here as an idle-only folder is
 * there.
 */
const FADE_SECONDS = 0.25;

/**
 * How far down the figure sits in frame.
 *
 * Chosen against the camera below so that neither end of the motion leaves the
 * box: at rest the mitts stop just inside the bottom edge, and at the top of
 * the milestone jump the crest bead stops just inside the top one.
 */
const GROUND_OFFSET = -0.197;

/**
 * Poses that happen once and hold, rather than looping.
 *
 * Reactions are events: laughing, jumping and a flash of temper all end. The
 * moods and the two "right now" states — crying, floating, casting — loop,
 * because they describe a condition that is still true.
 */
const ONE_SHOT: ReadonlySet<Pose> = new Set(['celebrate', 'milestone', 'laughing', 'jumping', 'angry']);

function Figure({ url, pose }: { url: string; pose: Pose }) {
  const group = useRef<Group>(null);
  const { scene, animations } = useGLTF(url);
  // useGLTF caches one scene graph per URL, and an Object3D can only be in one
  // place at a time — rendering the cached scene twice would silently remove
  // the figure from whichever surface mounted first. Two figures are on screen
  // together often enough to matter (the dashboard hero and the celebration
  // overlay, for one), so each instance gets its own copy. A plain clone is
  // safe here because the model is animated by node transforms, with no
  // skinning for a clone to break.
  const model = useMemo(() => scene.clone(true), [scene]);
  const { actions, mixer } = useAnimations(animations, group);

  useEffect(() => {
    const available = actions;
    const name = poseChain(pose).find((candidate) => available[candidate]);
    const action = name ? available[name] : undefined;
    if (!action) return;

    const once = ONE_SHOT.has(pose);
    action.reset();
    action.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    // No `clampWhenFinished`: the one-shot clips are authored to land back on
    // the rest pose, so where a finished action leaves the figure and where it
    // started are the same place. (It would also mean assigning to a value
    // React owns, which the compiler rightly refuses.)
    action.fadeIn(FADE_SECONDS).play();
    return () => {
      action.fadeOut(FADE_SECONDS);
    };
  }, [actions, pose]);

  // The mixer keeps time in seconds and is the one thing here that would drift
  // if a tab were suspended mid-clip; resetting it on unmount keeps a remounted
  // figure from starting halfway through a blink.
  useEffect(
    () => () => {
      (mixer as AnimationMixer).stopAllAction();
    },
    [mixer],
  );

  return (
    <group position={[0, GROUND_OFFSET, 0]}>
      <primitive ref={group} object={model} />
    </group>
  );
}

export function CharacterCanvas({ url, pose, size }: { url: string; pose: Pose; size: number }) {
  return (
    <Canvas
      style={{ width: size, height: size }}
      // Capped at 2: this draws a few thousand triangles into a box that is
      // never larger than 112px, and a 3x phone screen would be paying for
      // detail nobody can see.
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      // Framed for the figure's whole range of motion, not just its rest pose,
      // so the milestone jump has somewhere to go instead of clipping.
      camera={{ fov: 30, position: [0, 0, 4.72], near: 0.1, far: 20 }}
    >
      {/* A three-point rig plus a sky/ground ambient, rather than one flat
          ambient. An HDRI environment would light the metal better still, but
          every preset is a network fetch at first render and this app does not
          fetch artwork — so the hemisphere stands in for one, and the gold is
          kept at low metalness because there is nothing for it to reflect. */}
      <hemisphereLight args={['#dceaff', '#5a4c40', 1.3]} />
      <ambientLight intensity={0.3} />
      {/* Key, from above and camera-right. */}
      <directionalLight position={[2.6, 3.4, 2.6]} intensity={2.35} />
      {/* Cool rim from behind, which is what separates the figure from a dark
          surface without needing an outline. */}
      <directionalLight position={[-3, 1.6, -2.6]} intensity={1.25} color="#b7d4ea" />
      {/* A warm bounce from below, standing in for light off the page. */}
      <directionalLight position={[0, -2.2, 1.8]} intensity={0.42} color="#ffd6bb" />
      <Suspense fallback={null}>
        <Figure url={url} pose={pose} />
      </Suspense>
    </Canvas>
  );
}
