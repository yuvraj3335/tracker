'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Companion } from './companion';
import { CompanionPanel, type MisoControls } from './companion-panel';
import { BARE_ROUTES } from './nav';
import { poseForTurn, type Turn } from '@/lib/conversation';
export function CompanionLayer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [turn, setTurn] = useState<Turn>('closed');
  const controls = useRef<MisoControls>(null);
  const close = useCallback(() => setOpen(false), []);
  const show = useCallback(() => setOpen(true), []);
  const talk = useCallback(() => controls.current?.talk(), []);
  useEffect(() => { const openMiso = () => controls.current?.talk(); window.addEventListener('miso:talk', openMiso); return () => window.removeEventListener('miso:talk', openMiso); }, []);
  if (BARE_ROUTES.some(route => pathname.startsWith(route))) return null;
  const questionId = pathname.startsWith('/questions/') ? decodeURIComponent(pathname.split('/')[2]) : undefined;
  const pose = turn === 'closed' || turn === 'resting' ? null : poseForTurn(turn);
  return <><Companion onOpen={talk} overridePose={pose} /><CompanionPanel ref={controls} open={open} onOpen={show} onClose={close} onTurn={setTurn} questionId={questionId} /></>;
}
