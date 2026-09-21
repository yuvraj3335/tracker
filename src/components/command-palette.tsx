'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft } from 'lucide-react';
import {
  getCommands,
  onCommandsChange,
  serverCommands,
  type Command,
} from '@/lib/commands';
import {
  getDensity, getEffects, getSkin, serverDensity, serverEffects, serverSkin,
  setDensity, setEffects, setMode, setSkin, subscribe,
} from '@/lib/appearance';
import { SKINS, THEMES } from '@/lib/themes';
import { isPaletteShortcut, isTypingTarget } from '@/lib/keys';
import { matchesTokens, normalize, tokenize } from '@/lib/search';
import { cn } from '@/lib/utils';

/**
 * Cmd-K / Ctrl-K.
 *
 * Mounted once in the layout so the shortcut works on every route. The
 * always-available commands (navigate, theme, skin, density) are built here;
 * page-specific ones — jumping to one of the 18 sections, say — are published
 * into the registry by whichever page knows them, so the layout does not have
 * to load sheet data on every route.
 *
 * Nothing is rendered until it is first opened, so the cost on pages nobody
 * opens it on is one keydown listener.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const published = useSyncExternalStore(onCommandsChange, getCommands, serverCommands);
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const density = useSyncExternalStore(subscribe, getDensity, serverDensity);
  const effects = useSyncExternalStore(subscribe, getEffects, serverEffects);

  // ---- global shortcut ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // A bare "k" should not open it while someone is typing a word with a k
      // in it; the modifier check above already covers the normal case.
      if (e.key === 'Escape' && !isTypingTarget(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const builtin = useMemo<Command[]>(
    () => [
      { id: 'go:today', label: 'Go to today', group: 'Go', hint: 'Dashboard', run: () => router.push('/') },
      { id: 'go:sheet', label: 'Open the DSA sheet', group: 'Go', run: () => router.push('/areas/dsa') },
      { id: 'go:daily', label: 'Daily tracker', group: 'Go', run: () => router.push('/daily') },
      { id: 'go:analytics', label: 'Analytics', group: 'Go', run: () => router.push('/analytics') },
      { id: 'go:setup', label: 'Notion connection', group: 'Go', run: () => router.push('/setup') },

      { id: 'mode:light', label: 'Light mode', group: 'Appearance', run: () => setMode('light') },
      { id: 'mode:dark', label: 'Dark mode', group: 'Appearance', run: () => setMode('dark') },
      { id: 'mode:system', label: 'Match system theme', group: 'Appearance', run: () => setMode('system') },
      ...SKINS.map((s) => ({
        id: `skin:${s}`,
        label: `Theme: ${THEMES[s].name}`,
        group: 'Appearance',
        hint: s === skin ? 'current' : undefined,
        run: () => setSkin(s),
      })),
      {
        id: 'density',
        label: density === 'compact' ? 'Comfortable rows' : 'Compact rows',
        group: 'Appearance',
        run: () => setDensity(density === 'compact' ? 'comfortable' : 'compact'),
      },
      {
        id: 'effects',
        label: effects ? 'Turn off sound & haptics' : 'Turn on sound & haptics',
        group: 'Appearance',
        run: () => setEffects(!effects),
      },
    ],
    [router, skin, density, effects],
  );

  const all = useMemo(() => [...published, ...builtin], [published, builtin]);

  const results = useMemo(() => {
    const tokens = tokenize(query);
    if (!tokens.length) return all;
    return all.filter((c) => matchesTokens(normalize(`${c.group} ${c.label}`), tokens));
  }, [all, query]);

  // Group headers, preserving first-seen order.
  const grouped = useMemo(() => {
    const m = new Map<string, Command[]>();
    for (const c of results) {
      const list = m.get(c.group);
      if (list) list.push(c);
      else m.set(c.group, [c]);
    }
    return [...m.entries()];
  }, [results]);

  const flat = useMemo(() => grouped.flatMap(([, cs]) => cs), [grouped]);
  const active = flat[Math.min(cursor, flat.length - 1)];

  function runCommand(c: Command | undefined) {
    if (!c) return;
    setOpen(false);
    setQuery('');
    setCursor(0);
    c.run();
  }

  // Nothing in the DOM until first opened.
  if (!open) return null;

  return (
    <dialog
      ref={dialog}
      onClose={() => { setOpen(false); setQuery(''); setCursor(0); }}
      onClick={(e) => { if (e.target === dialog.current) setOpen(false); }}
      aria-label="Command palette"
      className="skin-card mx-auto mt-[12vh] mb-auto w-[min(34rem,calc(100vw-2rem))] border border-hairline bg-surface p-0 text-ink shadow-lift-3 backdrop:bg-black/40"
    >
      <div
        role="combobox"
        aria-expanded="true"
        aria-haspopup="listbox"
        aria-controls="palette-list"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); runCommand(active); }
          }}
          placeholder="Jump to a section, switch theme, go to today…"
          aria-label="Search commands"
          aria-activedescendant={active ? `cmd-${active.id}` : undefined}
          className="w-full border-b border-hairline bg-transparent px-4 py-3 text-sm outline-none placeholder:text-ink-muted"
        />
      </div>

      <ul id="palette-list" role="listbox" ref={listRef} className="max-h-[50vh] overflow-y-auto py-1.5">
        {flat.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-ink-muted">Nothing matches that.</li>
        ) : (
          grouped.map(([group, commands]) => (
            <li key={group}>
              <p className="px-4 pt-2 pb-1 text-micro font-semibold tracking-wide text-ink-muted uppercase">
                {group}
              </p>
              <ul>
                {commands.map((c) => {
                  const isActive = active?.id === c.id;
                  return (
                    <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={isActive}>
                      <button
                        type="button"
                        // Pointer moves the selection so mouse and keyboard
                        // never disagree about what Enter would run.
                        onMouseMove={() => { const i = flat.indexOf(c); if (i >= 0 && i !== cursor) setCursor(i); }}
                        onClick={() => runCommand(c)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors',
                          isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2',
                        )}
                      >
                        <span className="min-w-0 truncate">{c.label}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {c.hint ? <span className="text-micro text-ink-muted">{c.hint}</span> : null}
                          {isActive ? <CornerDownLeft className="size-3 text-ink-muted" /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))
        )}
      </ul>
    </dialog>
  );
}
