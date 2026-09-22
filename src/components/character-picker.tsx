'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Info, Sparkles, ArrowLeft, ExternalLink } from 'lucide-react';
import { CharacterThumb } from './character-figure';
import { useActiveCharacter, useCharacterCatalog } from './character-provider';
import { getSkin, serverSkin, setCharacter, subscribe } from '@/lib/appearance';
import { THEMES } from '@/lib/themes';
import { celebrate } from '@/lib/celebrate';
import { pickCharacterLine } from '@/lib/character-voice';
import type { Character } from '@/lib/characters';
import { cn } from '@/lib/utils';

/**
 * Character switcher, alongside the skin picker.
 *
 * Renders nothing when no characters are installed — a checkout with the folder
 * deleted falls back to the built-in SVG mascots and needs no picker at all.
 * There is no longer a "default" entry: the app ships a character, so having no
 * character is not a state worth offering. With one installed this is mostly
 * the attribution surface.
 *
 * The second panel is the attribution surface. Every installed character's
 * artist, source and licence is reachable in two clicks from the nav, because
 * shipping someone else's art without visible credit is the failure mode this
 * whole system is supposed to avoid.
 */
export function CharacterPicker() {
  const catalog = useCharacterCatalog();
  // The effective character, not the raw stored id — with one installed and
  // nothing chosen, that one is still what is on screen and should be ticked.
  const active = useActiveCharacter()?.id ?? '';
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Closing always returns to the list, so the popover never reopens on the
  // credits panel. Done at every close site rather than in an effect watching
  // `open` — a setState inside that effect would cascade an extra render.
  const close = () => {
    setOpen(false);
    setCredits(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!catalog.length) return null;

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Change character"
        aria-expanded={open}
        className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <Sparkles className="size-4" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={credits ? 'Character credits' : 'Characters'}
          className="skin-card absolute right-0 z-50 mt-1.5 w-72 border border-hairline bg-surface p-1.5 shadow-lift-3"
        >
          {credits ? (
            <Credits catalog={catalog} onBack={() => setCredits(false)} />
          ) : (
            <>
              {catalog.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCharacter(c.id);
                    close();
                    celebrate('cheer', pickCharacterLine(c, 'cheer', THEMES[skin], 0));
                  }}
                  className={cn(
                    'skin-pill flex w-full items-center gap-2.5 px-2 py-2 text-left transition-colors',
                    active === c.id ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2">
                    <CharacterThumb character={c} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-ink">{c.name}</span>
                    <span className="block truncate text-meta text-ink-muted">
                      by {c.artist}
                    </span>
                  </span>
                  {active === c.id ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setCredits(true)}
                className="skin-pill mt-1 flex w-full items-center gap-1.5 px-2 py-1.5 text-meta text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Info className="size-3" />
                Artwork credits
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Artist, source and licence for every installed character. */
function Credits({
  catalog,
  onBack,
}: {
  catalog: readonly Character[];
  onBack: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="skin-pill mb-1 flex w-full items-center gap-1.5 px-2 py-1.5 text-meta font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <ArrowLeft className="size-3" />
        Back
      </button>

      <ul className="max-h-72 space-y-2 overflow-y-auto px-2 pb-1">
        {catalog.map((c) => (
          <li key={c.id} className="border-b border-hairline pb-2 last:border-0">
            <p className="text-xs font-semibold text-ink">{c.name}</p>
            <dl className="mt-0.5 space-y-0.5 text-meta leading-snug text-ink-muted">
              <div className="flex gap-1.5">
                <dt className="shrink-0">Artist</dt>
                <dd className="min-w-0 flex-1 text-ink-2">{c.artist}</dd>
              </div>
              {c.source ? (
                <div className="flex gap-1.5">
                  <dt className="shrink-0">Source</dt>
                  <dd className="min-w-0 flex-1 text-ink-2">
                    {/^https?:\/\//i.test(c.source) ? (
                      <a
                        href={c.source}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-0.5 break-all text-accent underline underline-offset-2"
                      >
                        {c.source}
                        <ExternalLink className="size-2.5 shrink-0" />
                      </a>
                    ) : (
                      c.source
                    )}
                  </dd>
                </div>
              ) : null}
              <div className="flex gap-1.5">
                <dt className="shrink-0">Licence</dt>
                <dd className="min-w-0 flex-1 text-ink-2">{c.license}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <p className="px-2 pt-1 pb-1 text-micro leading-snug text-ink-muted">
        Artwork belongs to its creators and is used with their permission.
      </p>
    </div>
  );
}
