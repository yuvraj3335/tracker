'use client';

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { getCharacter, serverCharacter, subscribe } from '@/lib/appearance';
import { resolveCharacter, type Character } from '@/lib/characters';

/**
 * Carries the installed-character catalogue from the server into the tree.
 *
 * Discovery is a filesystem walk, so it can only happen in a server component.
 * The root layout does it once and hands the result down as plain data; every
 * client surface reads it from here instead of fetching.
 *
 * The catalogue is frequently empty — that is the default state of a fresh
 * checkout — so every consumer must handle "no character" as normal.
 */
const CatalogContext = createContext<readonly Character[]>([]);

export function CharacterProvider({
  catalog,
  children,
}: {
  catalog: readonly Character[];
  children: React.ReactNode;
}) {
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}

export function useCharacterCatalog(): readonly Character[] {
  return useContext(CatalogContext);
}

/**
 * The character this device has selected, or null.
 *
 * Null covers three cases that all render identically: nothing installed,
 * nothing chosen, and a stored id whose folder has since been removed. The last
 * one matters — a stale localStorage value must not blank the figure out.
 */
export function useActiveCharacter(): Character | null {
  const catalog = useCharacterCatalog();
  const id = useSyncExternalStore(subscribe, getCharacter, serverCharacter);
  return useMemo(() => resolveCharacter(catalog, id), [catalog, id]);
}
