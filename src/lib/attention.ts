/** Only simple derived landmarks leave the webcam loop; no pixels or results are stored. */
export type Point = { x: number; y: number };
export type Gaze = { x: number; y: number; yaw: number };

function between(value: number, a: number, b: number): number | null {
  const span = Math.abs(b - a);
  return span > 0.005 ? (value - Math.min(a, b)) / span : null;
}

/** Approximate iris position in each eye and nose position between the eyes. */
export function gazeFromLandmarks(points: Point[] | undefined): Gaze | null {
  if (!points || points.length < 478) return null;
  const eye = (outer: number, inner: number, top: number, bottom: number, iris: number) => {
    const p = points[iris];
    return {
      x: between(p.x, points[outer].x, points[inner].x),
      y: between(p.y, points[top].y, points[bottom].y),
    };
  };
  const left = eye(33, 133, 159, 145, 468);
  const right = eye(362, 263, 386, 374, 473);
  const eyeMidA = (points[33].x + points[133].x) / 2;
  const eyeMidB = (points[362].x + points[263].x) / 2;
  const yaw = between(points[1].x, eyeMidA, eyeMidB);
  if (left.x === null || right.x === null || left.y === null || right.y === null || yaw === null) return null;
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, yaw };
}

/** A generous range: this is an attention hint, not calibrated eye tracking. */
export function looksAtScreen(gaze: Gaze | null, baseline: Gaze = { x: 0.5, y: 0.5, yaw: 0.5 }): boolean {
  if (!gaze) return false;
  return Math.abs(gaze.x - baseline.x) <= 0.23 &&
    Math.abs(gaze.y - baseline.y) <= 0.32 &&
    Math.abs(gaze.yaw - baseline.yaw) <= 0.24;
}

export type AttentionState = { awaySince: number | null; alerted: boolean };
export const INITIAL_ATTENTION: AttentionState = { awaySince: null, alerted: false };

/** Consecutive absence only. Returning to the screen starts a fresh interval. */
export function advanceAttention(
  state: AttentionState,
  present: boolean,
  now: number,
  thresholdMs: number,
): AttentionState {
  if (present) return INITIAL_ATTENTION;
  const awaySince = state.awaySince ?? now;
  return { awaySince, alerted: state.alerted || now - awaySince >= thresholdMs };
}
