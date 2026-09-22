'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mic, Send, Square, Volume2, VolumeX, X } from 'lucide-react';
import { useActiveCharacter } from './character-provider';
import { Button } from './ui/button';
import { subscribe } from '@/lib/appearance';
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
import { MAX_MESSAGE_CHARS, type ChatMessage } from '@/lib/companion-prompt';
import { cn } from '@/lib/utils';

/**
 * The conversation.
 *
 * Same dialog shape the character picker uses — outside click and Escape both
 * close it, and it is a real `role="dialog"` rather than a floating div — so
 * there is one popover pattern here rather than two.
 *
 * Everything said is always on screen as text, whether or not the microphone
 * or the voice was ever used. That is the accessibility floor, and it is also
 * the only reason any of this is debuggable.
 */
export function CompanionPanel({
  open,
  onClose,
  onThinking,
}: {
  open: boolean;
  onClose: () => void;
  /** Lets the figure outside cast a spell while it works out a reply. */
  onThinking: (thinking: boolean) => void;
}) {
  const character = useActiveCharacter();
  const voice = useSyncExternalStore(subscribe, getVoice, serverVoice);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');

  const box = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stopListening = useRef<(() => void) | null>(null);

  const name = character?.name ?? 'Your companion';

  // Escape and outside-click, the same two the character picker handles.
  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  // Closing must take the microphone and the voice with it. Leaving either
  // running behind a shut panel is the failure people rightly do not forgive.
  useEffect(() => {
    if (open) return;
    stopListening.current?.();
    stopListening.current = null;
    stopSpeaking();
  }, [open]);

  useEffect(
    () => () => {
      stopListening.current?.();
      stopSpeaking();
    },
    [],
  );

  // Keep the newest turn in view without stealing focus from the input.
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, pending]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!trimmed || pending) return;

      stopListening.current?.();
      stopListening.current = null;
      setListening(false);
      setHeard('');
      setDraft('');
      setStatus('');

      const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
      setMessages(next);
      setPending(true);
      onThinking(true);
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
          speak(data.reply);
        } else if (res.status === 401) {
          // The proxy refuses an expired session before the route is reached,
          // and answers in its own shape — so this case needs its own copy
          // rather than the generic "could not be reached".
          setStatus('Your session has ended. Sign in again to keep talking.');
        } else {
          // Already translated by the route. Nothing upstream reaches here.
          setStatus(data?.message ?? 'Your companion could not be reached just now.');
        }
      } catch {
        setStatus('Your companion could not be reached just now. Check your connection and try again.');
      } finally {
        setPending(false);
        onThinking(false);
      }
    },
    [messages, pending, character, onThinking],
  );

  function toggleListening() {
    if (listening) {
      stopListening.current?.();
      stopListening.current = null;
      setListening(false);
      return;
    }
    setStatus('');
    setHeard('');
    // Started from this click and only this click. Nothing here ever starts a
    // microphone on mount, on open, or on a remembered preference.
    const stop = listen({
      onTranscript: (text, final) => {
        setHeard(text);
        if (final && text) void send(text);
      },
      onError: (message) => {
        if (message) setStatus(message);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    if (!stop) {
      setStatus('This browser will not do speech recognition. You can type instead.');
      return;
    }
    stopListening.current = stop;
    setListening(true);
  }

  if (!open) return null;

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`Talk to ${name}`}
      className="skin-card fixed inset-x-3 bottom-24 z-40 flex max-h-[min(70vh,34rem)] flex-col border border-hairline bg-surface shadow-lift-3 sm:inset-x-auto sm:right-6 sm:bottom-32 sm:w-96"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{name}</p>
        <VoiceToggle voice={voice} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={log} className="min-h-24 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Say hello, or ask for a nudge. {name} cannot see your tracker, so it will not
            pretend to know how you are doing.
          </p>
        ) : null}
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
        {pending ? <p className="text-xs text-ink-muted">Thinking…</p> : null}
      </div>

      {/* Both the spoken half and the failures land here, announced politely
          rather than silently changing colour somewhere. */}
      <p role="status" aria-live="polite" className="px-3 text-xs text-ink-muted empty:hidden">
        {listening ? 'Listening… say something, or press Stop.' : status}
      </p>

      <form
        className="flex items-center gap-1.5 border-t border-hairline p-2"
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
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_MESSAGE_CHARS}
          autoComplete="off"
          placeholder="Type a message…"
          disabled={pending}
          className={cn(
            'skin-pill h-11 min-w-0 flex-1 border border-control bg-surface-2 px-3 text-xs',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            'disabled:opacity-50',
          )}
        />
        {canListen() ? (
          <Button
            type="button"
            variant={listening ? 'primary' : 'outline'}
            className="min-h-11 min-w-11 px-2"
            onClick={toggleListening}
            disabled={pending}
          >
            {listening ? <Square className="size-4" /> : <Mic className="size-4" />}
            <span className="sr-only">{listening ? 'Stop listening' : 'Talk'}</span>
          </Button>
        ) : null}
        <Button type="submit" className="min-h-11 min-w-11 px-2" disabled={pending || !draft.trim()}>
          <Send className="size-4" />
          <span className="sr-only">Send</span>
        </Button>
      </form>
    </div>
  );
}

/**
 * Whether replies are read aloud. Off until asked, then remembered — the same
 * rule the tick sound follows, and for the same reason.
 */
function VoiceToggle({ voice }: { voice: boolean }) {
  if (!canSpeak()) return null;
  return (
    <button
      type="button"
      aria-pressed={voice}
      onClick={() => setVoice(!voice)}
      className={cn(
        'skin-pill inline-flex min-h-9 items-center gap-1 px-2 text-micro transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        voice ? 'text-ink-2 hover:bg-surface-2' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {voice ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
      Voice {voice ? 'on' : 'off'}
    </button>
  );
}
