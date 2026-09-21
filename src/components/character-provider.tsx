'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { getCharacter, serverCharacter, subscribe } from '@/lib/appearance';
import { resolveCharacter, type Character } from '@/lib/characters';
import { usableAccent } from '@/lib/contrast';

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
  return (
    <CatalogContext.Provider value={catalog}>
      <CharacterAccent />
      {children}
    </CatalogContext.Provider>
  );
}

/**
 * Applies the active character's accent — but only when it is good enough.
 *
 * `meta.json` accepts any `#rrggbb`, and the accent is link text, a filled
 * button carrying its own ink, and the focus ring. Applying one blindly would
 * let a character drop the palette below the contrast floors every shipped
 * token is held to. So it is measured against the surfaces the theme is
 * currently using, and only applied if it clears them; otherwise the theme's
 * own accent stands.
 *
 * Re-measured on every skin and mode change, because the surfaces move.
 */
function CharacterAccent() {
  const character = useActiveCharacter();
  const accent = character?.accent;

  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-ink');
    };
    if (!accent) {
      clear();
      return;
    }

    const apply = () => {
      // Read the theme's own surfaces, with the override removed first so the
      // measurement is against the theme rather than a previous application.
      clear();
      const cs = getComputedStyle(root);
      const read = (keys: string[]) => keys.map((k) => cs.getPropertyValue(k).trim()).filter(Boolean);
      // Accent is TEXT on cards and on the page, and a drawn ring elsewhere —
      // the same split `npm run check:color` applies to the shipped accents.
      const ok = usableAccent(accent, read(['--surface', '--plane']), read(['--surface-2']));
      if (!ok) return; // keeps the theme's accent
      root.style.setProperty('--accent', ok.accent);
      root.style.setProperty('--accent-ink', ok.ink);
    };

    apply();
    // The surfaces change with the skin, with the OS colour scheme, and with
    // the light/dark toggle — all of which land as an attribute change here.
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ['data-skin', 'data-theme'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', apply);
      clear();
    };
  }, [accent]);

  return null;
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
