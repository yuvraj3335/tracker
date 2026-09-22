'use client';

import { useCallback, useState } from 'react';
import { Companion } from './companion';
import { CompanionPanel } from './companion-panel';

/**
 * Mounts the companion and the conversation it opens.
 *
 * One owner for both so the figure can react to what the panel is doing — it
 * casts a spell while a reply is being worked out, which is the only "thinking"
 * indicator that is also in character.
 */
export function CompanionLayer() {
  const [open, setOpen] = useState(false);
  const [thinking, setThinking] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <>
      <Companion onOpen={toggle} overridePose={thinking ? 'casting' : null} />
      <CompanionPanel open={open} onClose={close} onThinking={setThinking} />
    </>
  );
}
