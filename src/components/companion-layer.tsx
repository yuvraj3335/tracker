'use client';

import { useCallback, useState } from 'react';
import { Companion } from './companion';
import { CompanionPanel } from './companion-panel';
import { poseForTurn, type Turn } from '@/lib/conversation';

/**
 * Mounts the companion and the conversation it opens.
 *
 * One owner for both so the figure can act out what the conversation is doing:
 * it talks while it talks, leans in while it listens, and casts while it works
 * out a reply. That is the entire status indicator, and it says something a
 * spinner cannot.
 */
export function CompanionLayer() {
  const [open, setOpen] = useState(false);
  const [turn, setTurn] = useState<Turn>('closed');

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // The figure is the status indicator: it talks while it is talking, leans in
  // while it is listening, and casts while it is thinking. A spinner would say
  // the same thing and say nothing about who you are talking to.
  const pose = turn === 'closed' || turn === 'resting' ? null : poseForTurn(turn);

  return (
    <>
      <Companion onOpen={toggle} overridePose={pose} />
      {/* Mounted only while open, so opening it is a mount and the greeting
          is initial state rather than something an effect has to set. */}
      {open ? <CompanionPanel onClose={close} onTurn={setTurn} /> : null}
    </>
  );
}
