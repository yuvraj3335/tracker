'use server';

import { requireTenant } from '@/lib/tenant';
import { getAreas, getTopics } from '@/lib/notion';
import { getSectionOrder, saveSectionOrder } from '@/lib/db';
import { isCompleteSectionOrder, orderedSectionIds } from '@/lib/section-order';

export type SaveSectionOrderResult =
  | { ok: true; version: number }
  | { ok: false; message: string; ids?: string[]; version?: number };

export async function saveSectionOrderAction(
  areaId: string,
  ids: string[],
  expectedVersion: number,
): Promise<SaveSectionOrderResult> {
  if (typeof areaId !== 'string' || areaId.length > 100 || !Array.isArray(ids) ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return { ok: false, message: 'That section order is not valid.' };
  }
  try {
    const tenant = await requireTenant();
    const [areas, topics] = await Promise.all([getAreas(tenant), getTopics(tenant)]);
    if (!areas.some((area) => area.id === areaId)) return { ok: false, message: 'That area is not in your tracker.' };
    const canonical = topics.filter((topic) => topic.areaIds.includes(areaId)).map((topic) => topic.id);
    if (!isCompleteSectionOrder(canonical, ids)) return { ok: false, message: 'The section list changed. Reload and try again.' };

    const saved = await saveSectionOrder(tenant.userId, areaId, ids, expectedVersion);
    if (saved) return { ok: true, version: saved.version };

    const current = await getSectionOrder(tenant.userId, areaId);
    return {
      ok: false,
      message: 'The order changed in another tab. This page has synced to the latest order.',
      ids: orderedSectionIds(canonical, current.ids),
      version: current.version,
    };
  } catch (error) {
    console.error('[section order] save failed:', (error as Error)?.message ?? error);
    return { ok: false, message: 'Could not save the section order. Try again.' };
  }
}
