/** A selected, visible tab owns the microphone. Hidden tabs release it entirely. */
export function bindVisibleMicrophone(page: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>, enabled: () => boolean, start: () => void, pause: () => void) {
  const changed = () => { if (!enabled()) return; if (page.hidden) pause(); else start(); };
  page.addEventListener('visibilitychange', changed);
  changed();
  return () => page.removeEventListener('visibilitychange', changed);
}
