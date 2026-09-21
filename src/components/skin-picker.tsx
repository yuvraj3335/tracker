'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Palette, Volume2, VolumeX } from 'lucide-react';
import { getEffects, getSkin, serverEffects, serverSkin, setEffects, setSkin, subscribe } from '@/lib/appearance';
import { SKINS, THEMES } from '@/lib/themes';
import { celebrate } from '@/lib/celebrate';
import { cn } from '@/lib/utils';

/** Theme switcher. Picking a skin fires its own mascot so you see it move. */
export function SkinPicker() {
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const effects = useSyncExternalStore(subscribe, getEffects, serverEffects);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — a popover that traps you is worse than none.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change theme"
        aria-expanded={open}
        className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Palette className="size-4" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Themes"
          className="skin-card absolute right-0 z-50 mt-1.5 w-64 border border-hairline bg-surface p-1.5 shadow-lift-3"
        >
          {SKINS.map((id) => {
            const t = THEMES[id];
            const active = id === skin;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSkin(id);
                  setOpen(false);
                  // Immediate payoff: the new mascot performs straight away.
                  if (THEMES[id].mascot !== 'none') celebrate('cheer', t.tagline);
                }}
                className={cn(
                  'skin-pill flex w-full items-center gap-2.5 px-2 py-2 text-left transition-colors',
                  active ? 'bg-surface-2' : 'hover:bg-surface-2',
                )}
              >
                <span className="flex shrink-0 gap-0.5" aria-hidden>
                  {t.swatch.map((c) => (
                    <span
                      key={c}
                      className="block size-3 rounded-full border border-hairline"
                      style={{ background: c }}
                    />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink">{t.name}</span>
                  <span className="block truncate text-meta text-ink-muted">{t.tagline}</span>
                </span>
                {active ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
              </button>
            );
          })}

          {/* Feedback is off by default; this is the visible, persisted switch. */}
          <button
            type="button"
            onClick={() => setEffects(!effects)}
            aria-pressed={effects}
            className="skin-pill mt-1 flex w-full items-center gap-2 border-t border-hairline px-2 pt-2 pb-1.5 text-left text-xs transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {effects ? (
              <Volume2 className="size-3.5 shrink-0 text-accent" />
            ) : (
              <VolumeX className="size-3.5 shrink-0 text-ink-muted" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink">Sound &amp; haptics</span>
              <span className="block text-micro text-ink-muted">
                {effects ? 'On for this device' : 'Off'}
              </span>
            </span>
          </button>

          <p className="px-2 pt-1.5 pb-1 text-micro leading-snug text-ink-muted">
            Saved on this device.
          </p>
        </div>
      ) : null}
    </div>
  );
}
