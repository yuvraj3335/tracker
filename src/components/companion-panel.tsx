'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, Mic, Send, Square, Volume2, VolumeX, X } from 'lucide-react';
import { useActiveCharacter } from './character-provider';
import { Button } from './ui/button';
import { getSkin, serverSkin, subscribe } from '@/lib/appearance';
import { pickCharacterLine } from '@/lib/character-voice';
import { THEMES } from '@/lib/themes';
import {
  canListen,
  canSpeak,
  getVoice,
  listen,
  serverVoice,
  setVoice,
  speak,
  stopSpeaking,
} from '@/lib/speech';
import { captionFor, isHearing, nextTurn, type Turn, type TurnEvent } from '@/lib/conversation';
import { MAX_MESSAGE_CHARS, type ChatMessage } from '@/lib/companion-prompt';
import { cn } from '@/lib/utils';

/**
 * A conversation you have out loud.
 *
 * Opening it is the whole gesture: it says hello, listens, answers, and
 * listens again, hands-free, until you stop it. Typing is still there — it is
 * the only thing that works in a browser without speech recognition, and the
 * only thing that works in a room where you cannot talk — but it is the
 * fallback now rather than the interface.
 *
 * Every turn is still captioned on screen. That is the accessibility floor,
 * and it is the only reason any of this is debuggable.
 */
export function CompanionPanel({
  onClose,
  onTurn,
}: {
  onClose: () => void;
  /** Drives the figure outside: it talks, listens and casts in step with this. */
  onTurn: (turn: Turn) => void;
}) {
  const character = useActiveCharacter();
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const voice = useSyncExternalStore(subscribe, getVoice, serverVoice);

  const [canHear] = useState(canListen);
  const [canTalk] = useState(canSpeak);
  // Mounted only while open, so the opening turn and the greeting are the
  // initial state rather than something an effect has to set afterwards.
  const [hello] = useState(() => pickCharacterLine(character, 'idle', THEMES[skin], 0));
  const [turn, setTurn] = useState<Turn>(() => nextTurn('closed', 'open', { canHear: canListen(), canSpeak: canSpeak() }));
  const [messages, setMessages] = useState<ChatMessage[]>(() => [{ role: 'assistant', content: hello }]);
  const [heard, setHeard] = useState('');
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [problem, setProblem] = useState('');

  const box = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const stopHearing = useRef<(() => void) | null>(null);

  const name = character?.name ?? 'Your companion';

  /**
   * The single way the turn ever changes.
   *
   * A functional update rather than a read of `turn`, because half of these
   * arrive from callbacks — a finished utterance, a closed microphone, a reply
   * — that fire long after the render they were created in and would otherwise
   * decide from a stale turn.
   */
  const advance = useCallback(
    (event: TurnEvent) => setTurn((from) => nextTurn(from, event, { canHear, canSpeak: canTalk })),
    [canHear, canTalk],
  );

  const say = useCallback(
    (text: string) => {
      // `speak` calls back even when muted or unsupported, so the loop hands
      // the turn on either way rather than stopping dead the first time
      // someone mutes it.
      speak(text, () => advance('spoke'));
    },
    [advance],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!trimmed) return;
      stopHearing.current?.();
      stopHearing.current = null;
      setHeard('');
      setDraft('');
      setProblem('');
      advance('heard');

      const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
      setMessages(next);
      try {
        const res = await fetch('/api/companion/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: next, characterId: character?.id ?? null }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; reply?: string; message?: string }
          | null;

        if (data?.ok && data.reply) {
          setMessages((m) => [...m, { role: 'assistant', content: data.reply as string }]);
          advance('reply');
          say(data.reply);
          return;
        }
        setProblem(
          res.status === 401
            ? 'Your session has ended. Sign in again to keep talking.'
            : (data?.message ?? 'Could not reach your companion just now.'),
        );
      } catch {
        setProblem('Could not reach your companion just now. Check your connection and try again.');
      }
      advance('error');
    },
    [messages, character, advance, say],
  );

  // ---- the microphone, opened only while the loop says to ----------------
  useEffect(() => {
    if (!isHearing(turn)) {
      stopHearing.current?.();
      stopHearing.current = null;
      return;
    }
    let got = false;
    const stop = listen({
      onTranscript: (text, final) => {
        setHeard(text);
        if (final && text) {
          got = true;
          void send(text);
        }
      },
      onError: (message) => {
        if (message) setProblem(message);
        advance('error');
      },
      // Closing with nothing heard is silence, not a failure — it rests and
      // waits to be asked again rather than reopening the microphone forever.
      onEnd: () => {
        if (!got) advance('silence');
      },
    });
    stopHearing.current = stop;
    return () => {
      stop();
      stopHearing.current = null;
    };
    // `send` changes with every message, which would tear the microphone down
    // mid-sentence; the turn is what should drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn]);

  // ---- opening and closing ------------------------------------------------
  // Says hello on mount. Only an external call — the turn it hands back
  // arrives through `speak`'s callback, not from this effect's body.
  useEffect(() => {
    say(hello);
    return () => {
      stopHearing.current?.();
      stopHearing.current = null;
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Keeps the figure outside in step. */
  useEffect(() => {
    onTurn(turn);
  }, [turn, onTurn]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, heard, turn]);

  const busy = turn === 'thinking';
  const caption = problem || captionFor(turn, name);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`Talk to ${name}`}
      className="skin-card fixed inset-x-3 bottom-24 z-40 flex max-h-[min(72vh,36rem)] flex-col overflow-hidden border border-hairline bg-surface shadow-lift-3 sm:inset-x-auto sm:right-6 sm:bottom-36 sm:w-[22rem]"
    >
      <div className="flex items-center gap-1 border-b border-hairline px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{name}</p>
        {canTalk ? (
          <button
            type="button"
            aria-pressed={!voice}
            aria-label={voice ? 'Mute' : 'Unmute'}
            onClick={() => {
              setVoice(!voice);
              if (voice) stopSpeaking();
            }}
            className="grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {voice ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Captions. Everything said in either direction lands here, whether or
          not the microphone or the voice was ever used. */}
      <div ref={log} className="min-h-28 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.map((m, i) => (
          <p
            key={`${i}-${m.content.slice(0, 12)}`}
            className={cn(
              'skin-pill max-w-[85%] px-2.5 py-1.5 text-xs leading-snug',
              m.role === 'user'
                ? 'ml-auto bg-accent text-accent-ink'
                : 'border border-hairline bg-surface-2 text-ink-2',
            )}
          >
            {m.content}
          </p>
        ))}
        {heard ? (
          <p className="skin-pill ml-auto max-w-[85%] border border-dashed border-control px-2.5 py-1.5 text-xs text-ink-muted italic">
            {heard}
          </p>
        ) : null}
      </div>

      <p
        role="status"
        aria-live="polite"
        className={cn(
          'px-3 pb-2 text-xs',
          problem ? 'text-critical' : 'text-ink-muted',
          isHearing(turn) && 'font-medium text-ink-2',
        )}
      >
        {caption}
      </p>

      <div className="border-t border-hairline p-2">
        {typing || !canHear ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor="companion-draft" className="sr-only">
              Message
            </label>
            <input
              id="companion-draft"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_MESSAGE_CHARS}
              autoComplete="off"
              placeholder={`Say something to ${name}…`}
              disabled={busy}
              className={cn(
                'skin-pill h-11 min-w-0 flex-1 border border-control bg-surface-2 px-3 text-xs',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                'disabled:opacity-50',
              )}
            />
            {canHear ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 min-w-11 px-2"
                onClick={() => setTyping(false)}
              >
                <Mic className="size-4" />
                <span className="sr-only">Talk instead</span>
              </Button>
            ) : null}
            <Button type="submit" className="min-h-11 min-w-11 px-2" disabled={busy || !draft.trim()}>
              <Send className="size-4" />
              <span className="sr-only">Send</span>
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-1.5">
            {/* One big control that always does the obvious thing: stop it if
                it is doing something, start it listening if it is not. */}
            <Button
              type="button"
              variant={isHearing(turn) ? 'outline' : 'primary'}
              className="min-h-11 flex-1"
              disabled={busy}
              onClick={() => {
                if (turn === 'resting') {
                  setProblem('');
                  advance('listen');
                  return;
                }
                stopSpeaking();
                advance('stop');
              }}
            >
              {isHearing(turn) ? <Square className="size-4" /> : <Mic className="size-4" />}
              {isHearing(turn) ? 'Stop' : turn === 'resting' ? 'Talk' : 'Stop'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 min-w-11 px-2"
              onClick={() => {
                stopSpeaking();
                advance('stop');
                setTyping(true);
              }}
            >
              <Keyboard className="size-4" />
              <span className="sr-only">Type instead</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
