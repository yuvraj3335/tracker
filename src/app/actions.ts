'use server';

import { revalidatePath } from 'next/cache';
import { setTaskDone, setTaskFlag, setTaskDifficulty } from '@/lib/notion';
import { requireTenant } from '@/lib/tenant';
import { todayKey } from '@/lib/date';
import type { Difficulty } from '@/lib/schema';

/**
 * Every action resolves the tenant from the session cookie on the server. The
 * browser sends only a task id — never a token, a workspace or a user id — so
 * a crafted request cannot act as somebody else.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function toggleTaskAction(id: string, done: boolean) {
  const t = await requireTenant();
  await setTaskDone(t, id, done, done ? todayKey() : undefined);
  revalidateAll();
}

/** Backdating, for when you log a session a day late. */
export async function completeOnAction(id: string, day: string) {
  if (!DAY_RE.test(day)) throw new Error('invalid date');
  const t = await requireTenant();
  await setTaskDone(t, id, true, day);
  revalidateAll();
}

export async function toggleFlagAction(
  id: string,
  flag: 'bookmarked' | 'revisit',
  value: boolean,
) {
  if (flag !== 'bookmarked' && flag !== 'revisit') throw new Error('invalid flag');
  const t = await requireTenant();
  await setTaskFlag(t, id, flag, value);
  revalidateAll();
}

export async function setDifficultyAction(id: string, difficulty: Difficulty | null) {
  if (difficulty !== null && !['Easy', 'Medium', 'Hard'].includes(difficulty)) {
    throw new Error('invalid difficulty');
  }
  const t = await requireTenant();
  await setTaskDifficulty(t, id, difficulty);
  revalidateAll();
}

function revalidateAll() {
  revalidatePath('/');
  revalidatePath('/daily');
  revalidatePath('/analytics');
  revalidatePath('/areas/[slug]', 'page');
}
