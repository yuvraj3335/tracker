import { notFound } from 'next/navigation';
import { VoiceLab } from './voice-lab';

/**
 * Dev-only bench for the spoken half of the companion.
 *
 * The voice pipeline is the one part of this app whose bugs are all timing:
 * how long until the first word is heard, how long the silence between two
 * sentences is, whether the main thread was free while either happened. None
 * of that can be seen by reading the code and none of it survives being
 * guessed at, so it gets a harness that measures it rather than a claim in a
 * comment.
 *
 * 404s outside development, exactly like the component preview next door.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Voice bench · dev only' };

export default function VoiceLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <VoiceLab />;
}
