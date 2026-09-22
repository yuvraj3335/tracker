'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, AudioLines, Keyboard, Mic, Volume2, VolumeX, X } from 'lucide-react';
import { useActiveCharacter } from './character-provider';
import { CharacterThumb } from './character-figure';
import { getSkin, serverSkin, subscribe } from '@/lib/appearance';
import { pickCharacterLine } from '@/lib/character-voice';
import { THEMES } from '@/lib/themes';
import {
  KOKORO_PREFIX,
  KOKORO_VOICES,
  engineKind,
  engineProgress,
  engineState,
  modelMegabytes,
  serverEngineKind,
  serverEngineProgress,
  serverEngineState,
  warm,
} from '@/lib/kokoro';
import {
  HOSTED_PREFIX,
  checkHosted,
  hostedConfigured,
  serverHostedConfigured,
} from '@/lib/hosted-voice';
import {
  canListen,
  canSpeak,
  getVoice,
  getVoiceName,
  listVoices,
  cutSentences,
  leadCut,
  listen,
  loadEngine,
  naturalVoice,
  serverVoice,
  serverVoiceList,
  serverVoiceName,
  setVoice,
  setVoiceName,
  speak,
  speakStream,
  stopSpeaking,
  whenVoicesKnown,
} from '@/lib/speech';
import { captionFor, isHearing, isTalking, nextTurn, type Turn, type TurnEvent } from '@/lib/conversation';
import type { EngineKind } from '@/lib/kokoro';
import { MAX_MESSAGE_CHARS, type ChatMessage } from '@/lib/companion-prompt';
import { cn } from '@/lib/utils';

/** How tall the message box is allowed to grow before it scrolls instead. */
const MAX_FIELD_PX = 120;

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
  const field = useRef<HTMLTextAreaElement>(null);
  const stopHearing = useRef<(() => void) | null>(null);
  /**
   * The transcript, kept where a callback can read the current one.
   *
   * `messages` is what renders; this is what is true right now. A reply
   * streams in over several seconds and a second message can be sent in the
   * middle of it, at which point every closure created before that point is
   * holding a transcript that is missing a turn. Writing to the array by
   * position, from a closure, is how a typed message vanished from the screen
   * *and* from the history posted to the model.
   */
  const thread = useRef<ChatMessage[]>([{ role: 'assistant', content: hello }]);
  /** Whichever reply is still arriving, so it can be called off. */
  const inFlight = useRef<AbortController | null>(null);
  /**
   * Whether the microphone is wanted at all.
   *
   * A ref as well as state because `advance` must not be rebuilt when it
   * changes — it is a dependency of the effect that owns the microphone, and
   * rebuilding it there would tear the microphone down mid-sentence.
   */
  const typingRef = useRef(false);
  /** The completed reply, for a screen reader. See the live region below. */
  const [spoken, setSpoken] = useState('');

  const name = character?.name ?? 'Your companion';

  const commit = useCallback((next: ChatMessage[]) => {
    thread.current = next;
    setMessages(next);
  }, []);

  /**
   * The single way the turn ever changes.
   *
   * A functional update rather than a read of `turn`, because half of these
   * arrive from callbacks — a finished utterance, a closed microphone, a reply
   * — that fire long after the render they were created in and would otherwise
   * decide from a stale turn.
   *
   * `canHear` is asked about the moment rather than the browser. Having
   * chosen to type, the machine must not route back through `listening` when
   * a reply finishes — that opened the microphone under a text box, with no
   * level meter and nothing on screen saying it was on.
   */
  const advance = useCallback(
    (event: TurnEvent) =>
      setTurn((from) =>
        nextTurn(from, event, { canHear: canHear && !typingRef.current, canSpeak: canTalk }),
      ),
    [canHear, canTalk],
  );

  /** Calls off whatever reply is still arriving. Safe to call at any time. */
  const abandon = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

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
      // Talking over it is an interruption, not a queue. Saying something
      // while it is still reading a reply should stop the reply, not leave
      // two of them to be got through in order.
      abandon();
      stopSpeaking();
      setHeard('');
      setDraft('');
      setProblem('');
      advance('heard');

      const mine = new AbortController();
      inFlight.current = mine;
      const next: ChatMessage[] = [...thread.current, { role: 'user', content: trimmed }];
      commit(next);
      try {
        const res = await fetch('/api/companion/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: next, characterId: character?.id ?? null }),
          signal: mine.signal,
        });

        // Anything that went wrong is JSON; the reply itself is a plain text
        // stream. The content type is the test, rather than guessing from the
        // shape of what arrives.
        const streamed = res.ok && res.body && !(res.headers.get('content-type') ?? '').includes('json');

        if (streamed && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let whole = '';
          let started = false;
          /** Where this reply's bubble lives. Never `length - 1`. */
          let at = -1;

          // One utterance for the whole reply, written to as it arrives.
          //
          // It used to be one call to `speak` per sentence, which made every
          // sentence an independent playback — so the silence between two of
          // them was two schedules meeting by luck, and that luck was bad. A
          // stream is a single timeline: the pause after a full stop is the
          // one `pauseAfter` asked for and nothing else.
          const voice = speakStream(() => advance('spoke'), true);
          let said = 0;
          const utter = (line: string) => {
            said += 1;
            voice.push(line);
          };

          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              const piece = decoder.decode(value, { stream: true });
              if (!piece) continue;
              buffer += piece;
              whole += piece;

              if (!started) {
                // The dots go the moment there are words, not when the whole
                // reply has landed.
                started = true;
                advance('reply');
                at = thread.current.length;
                commit([...thread.current, { role: 'assistant', content: whole }]);
              } else {
                const copy = [...thread.current];
                copy[at] = { role: 'assistant', content: whole };
                commit(copy);
              }

              // The first thing said is cut at the first clause rather than the
              // first full stop, because the wait before anything is heard is
              // the cost of generating that one line and nothing else. "Nice,
              // that is four today." can start being said at the comma.
              if (!said) {
                const lead = leadCut(buffer);
                if (lead) {
                  utter(lead[0]);
                  buffer = lead[1];
                }
              }

              const [sentences, rest] = cutSentences(buffer);
              buffer = rest;
              for (const sentence of sentences) utter(sentence);
            }

            // Whatever is left of a multi-byte character at the very end of
            // the stream. Without this a reply can lose its last letter.
            const rest = decoder.decode();
            if (rest) {
              buffer += rest;
              whole += rest;
              if (at >= 0) {
                const copy = [...thread.current];
                copy[at] = { role: 'assistant', content: whole };
                commit(copy);
              }
            }
            const tail = buffer.trim();
            if (tail) utter(tail);
            setSpoken(whole.trim());
          } finally {
            // Whatever happened — the reply ended, the connection dropped, the
            // reader threw — this utterance has to be closed.
            //
            // An open one sits at the head of the speech queue for ever: the
            // queue is serial and it waits for more text that is never coming,
            // so every reply after it is silent and the turn never comes back.
            // A dropped connection mid-reply used to break the companion for
            // the rest of the session, and it took a reload to get it back.
            voice.end();
          }

          if (!started) {
            setProblem('Your companion did not have anything to say to that. Try asking another way.');
            advance('error');
            return;
          }

          // Nothing more is coming; the turn is handed back once the last of
          // it has actually been heard.
          return;
        }

        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setProblem(
          res.status === 401
            ? 'Your session has ended. Sign in again to keep talking.'
            : (data?.message ?? 'Could not reach your companion just now.'),
        );
      } catch {
        // Called off on purpose — the panel was closed, or they went back to
        // typing. That is not a failure and must not be reported as one.
        if (mine.signal.aborted) return;
        setProblem('Could not reach your companion just now. Check your connection and try again.');
      } finally {
        if (inFlight.current === mine) inFlight.current = null;
      }
      if (mine.signal.aborted) return;
      advance('error');
    },
    [character, advance, abandon, commit],
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
  //
  // Once it is here, the lines this panel opens with are generated and kept.
  // They never change, they are short, and the second conversation of a
  // session then starts talking immediately instead of pausing on hello.
  useEffect(() => {
    let gone = false;
    let stop = () => {};
    // Both answers before anything is decided. Which voices the browser has
    // arrives a tick or two after load, and whether this deployment has a
    // hosted voice is a round trip — and guessing at either is how a machine
    // that needed no download at all starts a 155 MB one.
    void checkHosted().then(() => {
      if (gone) return;
      stop = whenVoicesKnown(() => {
        const id = naturalVoice();
        if (!id || gone) return;
        void loadEngine(id).then((ok) => {
          if (!ok || gone) return;
          // Just the greeting. There is one model behind one worker, so a
          // warm-up still running when a reply arrives is a reply waiting
          // behind it — the exact wait this was meant to remove. `hello` is
          // picked deterministically, so warming that one line is what makes
          // the next conversation open without a pause.
          void warm([hello], id);
        });
      });
    });
    return () => {
      gone = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- opening and closing ------------------------------------------------
  // Says hello on mount. Only an external call — the turn it hands back
  // arrives through `speak`'s callback, not from this effect's body.
  useEffect(() => {
    say(hello);
    return () => {
      stopHearing.current?.();
      stopHearing.current = null;
      // Both halves. Silencing the voice without calling off the reply that
      // is still arriving meant closing the panel mid-question and then
      // hearing the answer read out with nothing on screen and no way to
      // stop it.
      inFlight.current?.abort();
      inFlight.current = null;
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Keeps the figure outside in step. */
  useEffect(() => {
    onTurn(turn);
  }, [turn, onTurn]);

  /**
   * And tells it the conversation is over.
   *
   * Nothing dispatches `close` — the panel simply unmounts — so without this
   * the figure kept whatever pose it was last in: a talking loop with the
   * panel shut, driven by a `requestAnimationFrame` callback that rescheduled
   * itself for the rest of the page's life.
   */
  useEffect(() => () => onTurn('closed'), [onTurn]);

  /**
   * Focus goes into the panel when it opens and back where it came from when
   * it closes.
   *
   * Opening it moved focus nowhere, so a keyboard user's next Tab carried on
   * from wherever they were on the page behind. Switching between talking and
   * typing unmounts the control that was focused, which dropped focus to the
   * body and restarted tabbing from the top of the document.
   */
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // Unless something inside has already taken it. The message box
    // autofocuses when the panel opens straight into typing, and pulling
    // focus back to the dialog would close the keyboard on a phone the
    // instant it opened.
    if (!box.current?.contains(document.activeElement)) {
      box.current?.focus({ preventScroll: true });
    }
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!box.current || box.current.contains(target as Node)) return;
      // The character is the control that opens this, so it is also the one
      // that closes it. Treating a tap on it as "clicked outside" shut the
      // panel here and let the figure's own double-tap timer reopen it a
      // moment later — with a new greeting and the conversation gone.
      if (target?.closest?.('[data-companion-figure]')) return;
      onClose();
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

  /**
   * The message box grows with what is being written.
   *
   * Driven by the value rather than by the keystroke that changed it, so it is
   * also right when the draft is cleared on send, and when the window is
   * narrow enough that the same text takes two lines instead of one. Doing it
   * in the change handler meant a box that was the right height for the width
   * it was typed at.
   */
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_PX)}px`;
  }, [draft, typing]);

  const busy = turn === 'thinking';
  const caption = problem || captionFor(turn, name);
  const composing = typing || !canHear;

  return (
    <div
      ref={box}
      role="dialog"
      // Focusable but not in the tab order: the panel takes focus when it
      // opens so tabbing starts inside it, and gives it back when it closes.
      tabIndex={-1}
      aria-label={`Talk to ${name}`}
      className={cn(
        'js-panel-in fixed z-40 flex flex-col overflow-hidden bg-surface shadow-lift-3',
        // Phone: a sheet off the bottom edge, square where it meets the edge
        // so it reads as attached rather than as a card that missed.
        'inset-x-0 bottom-0 max-h-[86dvh] rounded-t-2xl border-t border-hairline',
        'pb-[env(safe-area-inset-bottom)]',
        // Desktop: a panel beside the figure, clear of it.
        'sm:skin-card sm:inset-x-auto sm:right-6 sm:bottom-32 sm:max-h-[min(72vh,40rem)] sm:w-[25rem]',
        'sm:rounded-2xl sm:border sm:pb-0',
      )}
    >
      {/* A grab bar. It does nothing, which is the point: it is the shape that
          says "this came up from the bottom edge" on a phone, and it is the
          only chrome the sheet needs above the name. */}
      <span
        aria-hidden
        className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-control/50 sm:hidden"
      />

      <header className="flex items-center gap-2.5 px-3.5 pt-3 pb-3 sm:pt-4">
        <span className="relative shrink-0">
          <Avatar turn={turn} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] leading-tight font-semibold tracking-tight text-ink">
            {name}
          </span>
          <span
            role="status"
            aria-live="polite"
            className={cn(
              'mt-0.5 block truncate text-meta',
              problem ? 'text-critical' : 'text-ink-muted',
            )}
          >
            {caption || ' '}
          </span>
        </span>
        {canTalk && voice ? <VoicePicker name={name} onSpoke={() => advance('spoke')} /> : null}
        {canTalk ? (
          <IconButton
            label={voice ? 'Mute' : 'Unmute'}
            pressed={!voice}
            onClick={() => {
              setVoice(!voice);
              if (voice) stopSpeaking();
            }}
          >
            {voice ? <Volume2 className="size-[1.125rem]" /> : <VolumeX className="size-[1.125rem]" />}
          </IconButton>
        ) : null}
        <IconButton label="Close" onClick={onClose}>
          <X className="size-[1.125rem]" />
        </IconButton>
      </header>

      {/* Captions. Everything said in either direction lands here, whether or
          not the microphone or the voice was ever used. */}
      <div className="relative min-h-40 flex-1">
        {/* What is scrolling away passes under the header rather than being
            cut off by it. Sits above the list and takes no clicks. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-surface to-transparent"
        />
        <div
          ref={log}
          className="h-full space-y-2 overflow-y-auto overscroll-contain px-4 pt-3 pb-4"
        >
          {messages.map((m, i) => (
          <Bubble
            // By position. Keying on the text remounted the bubble every time
            // the streamed reply grew past the slice, which restarted its
            // entry animation two or three times at the start of every reply.
            key={i}
            role={m.role}
            first={m.role !== messages[i - 1]?.role}
          >
            {m.content}
          </Bubble>
        ))}
        {turn === 'thinking' ? (
          <span className="js-rise-in flex w-fit items-center gap-1.5 rounded-2xl rounded-bl-md bg-surface-2 px-4 py-3.5">
            <span className="sr-only">Working on a reply</span>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                aria-hidden
                className="js-dot size-[0.3125rem] rounded-full bg-ink-muted"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        ) : null}
        {heard ? (
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-control px-3.5 py-2.5 text-sm leading-relaxed text-ink-muted italic">
            {heard}
          </p>
        ) : null}
        {/* The reply itself, once, when it is complete.
            The status line above announces whose turn it is, which is the
            cheap half; the half worth hearing is what was actually said, and
            it was being announced to nobody. Not the log itself, because that
            is rewritten on every streamed chunk and would be read out a
            syllable at a time. */}
        <span className="sr-only" role="status" aria-live="polite">
          {spoken}
        </span>
        </div>
      </div>

      <div className="shrink-0 border-t border-hairline p-2.5 sm:p-3">
        {composing ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor="companion-draft" className="sr-only">
              Message
            </label>
            {/* One container holds the field and the send key, so the focus
                ring lands on the whole control rather than on a box with a
                button floating beside it. */}
            <div
              className={cn(
                'flex min-w-0 flex-1 items-end gap-1 rounded-2xl border border-control bg-surface-2 py-1 pr-1 pl-3.5',
                'focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-[-1px] focus-within:outline-accent',
                busy && 'opacity-60',
              )}
            >
              <textarea
                id="companion-draft"
                ref={field}
                autoFocus
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                maxLength={MAX_MESSAGE_CHARS}
                autoComplete="off"
                placeholder={`Say something to ${name}…`}
                disabled={busy}
                className="min-w-0 flex-1 resize-none bg-transparent py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
                style={{ maxHeight: MAX_FIELD_PX }}
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={busy || !draft.trim()}
                className={cn(
                  'mb-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition',
                  'hover:opacity-90 disabled:bg-control disabled:opacity-40',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                )}
              >
                <ArrowUp className="size-4" strokeWidth={2.5} />
              </button>
            </div>
            {canHear ? (
              <IconButton
                label="Talk instead"
                big
                onClick={() => {
                  // The ref before the state: `advance` reads it synchronously
                  // and would otherwise decide from the previous mode.
                  typingRef.current = false;
                  setTyping(false);
                  setProblem('');
                  advance('listen');
                }}
              >
                <Mic className="size-[1.125rem]" />
              </IconButton>
            ) : null}
          </form>
        ) : (
          <div className="flex items-center gap-2 pl-1">
            {/* No Talk button and no Stop button. The microphone is open for
                as long as the conversation is, and the cross in the corner is
                how it ends — which is what "just talk to it" has to mean.
                What is left is the live level and a way out to the keyboard. */}
            <Level turn={turn} />
            {turn === 'resting' ? (
              <button
                type="button"
                onClick={() => {
                  setProblem('');
                  advance('listen');
                }}
                className={cn(
                  'ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink',
                  'transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                )}
              >
                <Mic className="size-4" />
                Listen again
              </button>
            ) : null}
            <IconButton
              label="Type instead"
              big
              className={turn === 'resting' ? '' : 'ml-auto'}
              onClick={() => {
                // Calling off the reply as well as the voice. Stopping only
                // the voice left a reply already on its way, which arrived a
                // second later and was read out over a panel that said
                // "Paused".
                typingRef.current = true;
                abandon();
                stopSpeaking();
                advance('stop');
                setTyping(true);
              }}
            >
              <Keyboard className="size-[1.125rem]" />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

/** One message. */
function Bubble({
  role,
  first,
  children,
}: {
  role: ChatMessage['role'];
  /** First of a run from the same speaker — only that one gets the tail. */
  first: boolean;
  children: React.ReactNode;
}) {
  const mine = role === 'user';
  return (
    <p
      className={cn(
        'js-rise-in w-fit max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed',
        // A generous radius with one corner pulled in is the shape everyone
        // already reads as "someone said this". Only the first of a run gets
        // the pulled-in corner, so consecutive lines read as one turn.
        'rounded-2xl',
        mine
          ? ['ml-auto bg-accent text-accent-ink', first && 'rounded-br-md']
          : ['bg-surface-2 text-ink', first && 'rounded-bl-md'],
        !first && 'mt-1',
      )}
    >
      {children}
    </p>
  );
}

/** A square, comfortable tap target for the header and the composer. */
function IconButton({
  label,
  pressed,
  big,
  className,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  big?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'grid shrink-0 place-items-center rounded-full text-ink-muted transition-colors',
        'hover:bg-surface-2 hover:text-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        big ? 'size-11' : 'size-9',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * The figure, small, with a ring that says what it is doing.
 *
 * The same information as the caption beside it, in the shape people check
 * first. Decorative: the caption is the live region, this is not.
 */
function Avatar({ turn }: { turn: Turn }) {
  const character = useActiveCharacter();
  const active = isTalking(turn) || isHearing(turn) || turn === 'thinking';
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 place-items-center rounded-full bg-surface-2 transition-shadow',
        active && 'shadow-[0_0_0_2px_var(--accent)]',
        isHearing(turn) && 'js-halo',
      )}
    >
      {character ? <CharacterThumb character={character} size={34} /> : null}
    </span>
  );
}

/**
 * That the microphone is open, shown rather than stated.
 *
 * Five bars breathing is read at a glance and does not need reading at all,
 * which is what a status line asks of you. Decorative only — the caption in
 * the header carries the same thing for a screen reader, and the animation
 * collapses under the reduced-motion rule in globals.css.
 */
const BARS = [0.45, 0.75, 1, 0.7, 0.4];

function Level({ turn }: { turn: Turn }) {
  const active = isHearing(turn);
  return (
    <span className="flex items-center gap-2.5" aria-hidden>
      <span className="flex h-6 items-center gap-[3px]">
        {BARS.map((scale, i) => (
          <span
            key={i}
            className={cn(
              'w-[3px] rounded-full transition-[height,background-color] duration-200',
              active ? 'js-level bg-accent' : 'h-1 bg-control',
            )}
            style={active ? { animationDelay: `${i * 110}ms`, ['--level' as string]: scale } : undefined}
          />
        ))}
      </span>
      <span className="text-xs text-ink-muted">{active ? 'Just talk' : 'Tap to talk, or type'}</span>
    </span>
  );
}

/**
 * What the auto setting has actually landed on, said plainly.
 *
 * Three engines can be behind it and they differ in ways worth knowing about
 * — one of them is not running on this machine — so the control says which
 * rather than leaving "Auto" to mean whatever it happens to mean today.
 */
const ENGINE_LABEL: Record<EngineKind, string> = {
  hosted: 'hosted voice',
  webgpu: 'on your GPU',
  wasm: 'on this machine',
  none: 'browser voice',
};

/**
 * Which of the installed voices to use.
 *
 * Every browser ships a pile of them and picks the worst one by default, and
 * the ranking in speech.ts can only get to the best one *installed* — which on
 * some machines is still a formant synthesiser from 1998. The honest fix is to
 * hand over the list, best first, and say the name out loud on change so the
 * choice is made by ear in one click rather than by reading voice names.
 */
function VoicePicker({ name, onSpoke }: { name: string; onSpoke: () => void }) {
  const voices = useSyncExternalStore(subscribe, listVoices, serverVoiceList);
  const chosen = useSyncExternalStore(subscribe, getVoiceName, serverVoiceName);
  const state = useSyncExternalStore(subscribe, engineState, serverEngineState);
  const percent = useSyncExternalStore(subscribe, engineProgress, serverEngineProgress);
  const hosted = useSyncExternalStore(subscribe, hostedConfigured, serverHostedConfigured);
  const kind = useSyncExternalStore(subscribe, engineKind, serverEngineKind);
  // Device-dependent, and this panel is never server-rendered — it mounts on
  // a click — so reading it once on mount is safe and cannot mismatch.
  const [megabytes] = useState(modelMegabytes);

  return (
    // The native control, kept and made invisible over an icon. A select wide
    // enough to show "Nicole — soft, American" is wider than the name of the
    // person you are talking to, which is the wrong thing to give the room
    // to; the labels are worth reading in the list and worth nothing on the
    // closed control. Everything about the select still works — keyboard,
    // screen reader, the platform's own picker on a phone — and the ring is
    // carried by the wrapper through `focus-within`.
    <span
      className={cn(
        'relative grid size-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors',
        'hover:bg-surface-2 hover:text-ink focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent',
        state === 'loading' && 'text-accent',
      )}
    >
      {/* Shown, never announced. This is a live region no more: `announce`
          fires on every whole percent, so a screen reader read out a bare
          number up to ninety-nine times during the download. The state is on
          the control's own label instead, where it is read when it is asked
          for. */}
      {state === 'loading' ? (
        <span className="text-micro tabular-nums" aria-hidden>
          {percent}
        </span>
      ) : (
        <AudioLines className="size-[1.125rem]" aria-hidden />
      )}
      <select
        value={chosen}
        aria-label={state === 'loading' ? `Voice — downloading, ${percent} per cent` : 'Voice'}
        onChange={(e) => {
          setVoiceName(e.target.value);
          // Heard immediately, in the voice just picked. Choosing by ear is
          // the entire point of the control — and for a natural voice this is
          // also what the download is for, so it plays the moment it lands.
          //
          // It carries the turn, because it takes it. Picking a voice mid-
          // reply cuts that reply off, and a preview with no callback left
          // nothing to hand the conversation back — the panel sat on "…is
          // talking…" with the microphone shut until it was closed.
          speak(`Hi, I'm ${name}.`, onSpoke);
        }}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0 focus:outline-none"
      >
        <option value="">{`Auto — ${ENGINE_LABEL[kind]}`}</option>
        {/* Only where somebody has configured one. It costs money per reply
            and the reply text leaves the device, so it is never a default
            this code chooses — it is a key an owner set. */}
        {hosted ? (
          <optgroup label="Hosted">
            <option value={HOSTED_PREFIX}>Studio — instant, off this machine</option>
          </optgroup>
        ) : null}
        {/* The real answer to "it sounds like a robot". These run on this
            machine, so the only cost is the one-off download, and saying so
            in the label is the difference between a choice and a surprise. */}
        <optgroup label={state === 'ready' ? 'Natural' : `Natural — ${megabytes} MB once`}>
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
