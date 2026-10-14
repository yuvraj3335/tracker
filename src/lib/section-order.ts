/** A saved order is a preference, not a rewrite of Codolio's source order. */
export function orderedSectionIds(canonical: readonly string[], saved: readonly string[] = []): string[] {
  const allowed = new Set(canonical);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [...saved, ...canonical]) {
    if (allowed.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

export function isCompleteSectionOrder(canonical: readonly string[], candidate: unknown): candidate is string[] {
  if (!Array.isArray(candidate) || candidate.length !== canonical.length || canonical.length > 100) return false;
  const allowed = new Set(canonical);
  return allowed.size === canonical.length && candidate.every((id) => typeof id === 'string' && allowed.delete(id)) && allowed.size === 0;
}

/** Move a section to the indicated edge of another one, preserving all others. */
export function moveSection(
  ids: readonly string[],
  from: string,
  to: string,
  edge: 'before' | 'after',
): string[] {
  if (from === to || !ids.includes(from) || !ids.includes(to)) return [...ids];
  const next = ids.filter((id) => id !== from);
  next.splice(next.indexOf(to) + (edge === 'after' ? 1 : 0), 0, from);
  return next;
}
