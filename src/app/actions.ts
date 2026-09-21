'use server';

import { revalidatePath } from 'next/cache';
import { setTaskDone, setTaskFlag, setTaskDifficulty } from '@/lib/notion';
import { todayKey } from '@/lib/date';
import type { Difficulty } from '@/lib/schema';

/**
 * Ticking a question is the only input the system needs. The action stamps
 * `Completed On` with today's date in the configured timezone, which is what
 * places it in the Daily Tracker and lights up the heatmap cell.
 */
export async function toggleTaskAction(id: string, done: boolean) {
  await setTaskDone(id, done, done ? todayKey() : undefined);
  revalidateAll();
}

/** Backdating, for when you log a session a day late. */
export async function completeOnAction(id: string, day: string) {
  await setTaskDone(id, true, day);
  revalidateAll();
}

export async function toggleFlagAction(
  id: string,
  flag: 'bookmarked' | 'revisit',
  value: boolean,
) {
  await setTaskFlag(id, flag, value);
  revalidateAll();
}

export async function setDifficultyAction(id: string, difficulty: Difficulty | null) {
  await setTaskDifficulty(id, difficulty);
  revalidateAll();
}

function revalidateAll() {
  revalidatePath('/');
  revalidatePath('/daily');
  revalidatePath('/analytics');
  revalidatePath('/areas/[slug]', 'page');
}
