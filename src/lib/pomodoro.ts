import { MINUTE } from './timer';

export type PomodoroSegment = 'focus' | 'short-break' | 'long-break';

export const POMODORO_DEFAULTS = { focus: 25, shortBreak: 5, longBreak: 15 } as const;

export type PomodoroLengths = { focus: number; shortBreak: number; longBreak: number };

export function segmentDuration(segment: PomodoroSegment, lengths: PomodoroLengths): number {
  return (segment === 'focus' ? lengths.focus : segment === 'short-break' ? lengths.shortBreak : lengths.longBreak) * MINUTE;
}

/** One long break follows every four *completed* focus sessions. */
export function nextPomodoroSegment(segment: PomodoroSegment, completedFocus: number): PomodoroSegment {
  if (segment !== 'focus') return 'focus';
  return completedFocus > 0 && completedFocus % 4 === 0 ? 'long-break' : 'short-break';
}

export function segmentLabel(segment: PomodoroSegment): string {
  return segment === 'focus' ? 'Focus' : segment === 'short-break' ? 'Short break' : 'Long break';
}
