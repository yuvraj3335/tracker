'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, Mic, Send, Volume2, VolumeX, X } from 'lucide-react';
import { useActiveCharacter } from './character-provider';
import { Button } from './ui/button';
import { getSkin, serverSkin, subscribe } from '@/lib/appearance';
import { pickCharacterLine } from '@/lib/character-voice';
import { THEMES } from '@/lib/themes';
import {
  KOKORO_PREFIX,
  KOKORO_VOICES,
  MODEL_MEGABYTES,
  engineProgress,
  engineState,
  serverEngineProgress,
  serverEngineState,
} from '@/lib/kokoro';
import {
  canListen,
  canSpeak,
  getVoice,
  getVoiceName,
  listVoices,
  listen,
  loadEngine,
  naturalVoice,
  serverVoice,
  serverVoiceList,
  serverVoiceName,
  setVoice,
  setVoiceName,
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
          speak(data.reply, () => advance('spoke'));
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
    [messages, character, advance],
  );

  // ---- the microphone, open the whole time the loop says to ---------------
  // It closes only while something is being said aloud, so it never hears the
  // companion and answers itself.
  useEffect(() => {
    if (!isHearing(turn)) {
      stopHearing.current?.();
      stopHearing.current = null;
      return;
    }
    const stop = listen({
      onPartial: setHeard,
      onUtterance: (text) => void send(text),
      onError: (message) => {
        if (message) setProblem(message);
        advance('error');
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

  // The voice downloads itself when a conversation starts, rather than when
  // somebody finds the dropdown. Until it lands the browser's own voice
  // answers, so this costs nothing but the bytes — and on a metered or
  // low-powered device it does not happen at all.
  useEffect(() => {
    const voice = naturalVoice();
    if (voice) void loadEngine(voice);
  }, []);

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
        {canTalk && voice ? <VoicePicker name={name} /> : null}
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
        {turn === 'thinking' ? (
          <span className="skin-pill inline-flex w-fit items-center gap-1 border border-hairline bg-surface-2 px-3 py-2.5">
            <span className="sr-only">Working on a reply</span>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                aria-hidden
                className="js-dot size-1.5 rounded-full bg-ink-muted"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </span>
        ) : null}
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
                onClick={() => {
                  setTyping(false);
                  setProblem('');
                  advance('listen');
                }}
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
          <div className="flex items-center gap-2">
            {/* No Talk button and no Stop button. The microphone is open for
                as long as the conversation is, and the cross in the corner is
                how it ends — which is what "just talk to it" has to mean.
                What is left is the live level and a way out to the keyboard. */}
            <Listening active={isHearing(turn)} />
            {turn === 'resting' ? (
              <Button
                type="button"
                className="min-h-11"
                onClick={() => {
                  setProblem('');
                  advance('listen');
                }}
              >
                <Mic className="size-4" />
                Listen again
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="ml-auto min-h-11 min-w-11 px-2"
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


/**
 * That the microphone is open, shown rather than stated.
 *
 * Three bars breathing is read at a glance and does not need reading at all,
 * which is what a status line asks of you. Decorative only — the caption
 * beside it carries the same thing for a screen reader, and the animation
 * collapses under the reduced-motion rule in globals.css.
 */
function Listening({ active }: { active: boolean }) {
  return (
    <span className="flex items-center gap-2 px-1" aria-hidden>
      <span className="flex h-5 items-end gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('w-[3px] rounded-full transition-all', active ? 'js-level' : 'h-1 bg-control')}
            style={active ? { background: 'var(--accent)', animationDelay: `${i * 140}ms` } : undefined}
          />
        ))}
      </span>
      <span className="text-xs text-ink-muted">{active ? 'Just talk' : 'Paused'}</span>
    </span>
  );
}

/**
 * Which of the installed voices to use.
 *
 * Every browser ships a pile of them and picks the worst one by default, and
 * the ranking in speech.ts can only get to the best one *installed* — which on
 * some machines is still a formant synthesiser from 1998. The honest fix is to
 * hand over the list, best first, and say the name out loud on change so the
 * choice is made by ear in one click rather than by reading voice names.
 */
function VoicePicker({ name }: { name: string }) {
  const voices = useSyncExternalStore(subscribe, listVoices, serverVoiceList);
  const chosen = useSyncExternalStore(subscribe, getVoiceName, serverVoiceName);
  const state = useSyncExternalStore(subscribe, engineState, serverEngineState);
  const percent = useSyncExternalStore(subscribe, engineProgress, serverEngineProgress);

  return (
    <span className="flex min-w-0 items-center gap-1">
      {state === 'loading' ? (
        <span className="text-micro tabular-nums text-ink-muted" role="status" aria-live="polite">
          {percent}%
        </span>
      ) : null}
      <select
        value={chosen}
        aria-label="Voice"
        onChange={(e) => {
          setVoiceName(e.target.value);
          // Heard immediately, in the voice just picked. Choosing by ear is
          // the entire point of the control — and for a natural voice this is
          // also what the download is for, so it plays the moment it lands.
          speak(`Hi, I'm ${name}.`);
        }}
        className={cn(
          'skin-pill max-w-[7.5rem] cursor-pointer appearance-none border border-control bg-surface-2 px-2 py-1 text-micro text-ink-muted',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        )}
      >
        <option value="">Best available</option>
        {/* The real answer to "it sounds like a robot". These run on this
            machine, so the only cost is the one-off download, and saying so
            in the label is the difference between a choice and a surprise. */}
        <optgroup label={state === 'ready' ? 'Natural' : `Natural — ${MODEL_MEGABYTES} MB once`}>
          {KOKORO_VOICES.map((v) => (
            <option key={v.id} value={`${KOKORO_PREFIX}${v.id}`}>
              {v.label}
            </option>
          ))}
        </optgroup>
        {voices.length ? (
          <optgroup label="This browser">
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </span>
  );
}
