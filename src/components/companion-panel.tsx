'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Mic, Square, Volume2, VolumeX, X } from 'lucide-react';
import type { Turn } from '@/lib/conversation';
import { speechPieces, speechQueue, unlockMisoAudio } from '@/lib/miso-audio';
import { openMisoLive, type LiveConnection } from '@/lib/miso-live';
import { bindVisibleMicrophone } from '@/lib/miso-visibility';
import { useActiveCharacter } from './character-provider';
import { CharacterThumb } from './character-figure';
import type { ChatMessage } from '@/lib/companion-prompt';
import type { Reference } from '@/lib/tutor';

export type MisoControls = { talk: () => void; show: () => void };
type Mode = 'off' | 'wake' | 'talk';
type Props = { open: boolean; onOpen: () => void; onClose: () => void; onTurn: (turn: Turn) => void; questionId?: string };

/** One persistent session belongs to the existing Miso character, across routes. */
export const CompanionPanel = forwardRef<MisoControls, Props>(function CompanionPanel({ open, onOpen, onClose, onTurn, questionId }, ref) {
  const character = useActiveCharacter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('Ready when you are.');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('off');
  const [micReady, setMicReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [opening, setOpening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [wake, setWake] = useState(false);
  const [voice, setVoice] = useState<'natural' | 'longer'>('natural');
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Reference[]>([]);
  const [sourceWarning, setSourceWarning] = useState('');
  const history = useRef<ChatMessage[]>([]);
  const modeRef = useRef<Mode>('off');
  const wakeRef = useRef(false);
  const voiceRef = useRef(voice);
  const mutedRef = useRef(muted);
  const selected = useRef(questionId);
  const mic = useRef<AbortController | null>(null);
  const live = useRef<LiveConnection | null>(null);
  const desired = useRef(false);
  const openingRef = useRef(false);
  const needsGesture = useRef(false);
  const answer = useRef('');
  const restart = useRef<(mode: Mode) => Promise<void>>(async () => {});
  const request = useRef<AbortController | null>(null);
  const lastAsked = useRef<ChatMessage[] | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { selected.current = questionId; live.current?.updateQuestion(questionId); }, [questionId]);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, open]);

  const changeMode = useCallback((next: Mode) => { modeRef.current = next; setMode(next); }, []);
  const pause = useCallback((message: string) => {
    if (answer.current) { history.current = [...history.current, { role: 'assistant' as const, content: answer.current + ' [Interrupted.]' }].slice(-12); answer.current = ''; setMessages([...history.current]); }
    mic.current?.abort(); request.current?.abort(); live.current?.close();
    mic.current = null; request.current = null; live.current = null;
    openingRef.current = false; setOpening(false); setMicReady(false); setBusy(false); setTranscript('');
    modeRef.current = 'off'; setMode('off'); setStatus(message); onTurn('resting');
  }, [onTurn]);
  const stop = useCallback((message = 'Microphone off. Tap Enable microphone to resume.') => {
    desired.current = false; needsGesture.current = false; setEnabled(false); wakeRef.current = false; setWake(false);
    try { localStorage.setItem('miso-live-enabled', 'off'); } catch { /* Session state still applies. */ }
    pause(message);
  }, [pause]);

  const ask = useCallback(async (text: string, retryHistory?: ChatMessage[]) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const thread = retryHistory ?? [...history.current, { role: 'user' as const, content: text.slice(0, 1200) }].slice(-12);
    lastAsked.current = thread;
    history.current = thread;
    setMessages([...thread, { role: 'assistant', content: '' }]); setSources([]); setSourceWarning(''); setBusy(true); setError(''); setStatus('Miso is thinking…'); onTurn('thinking');
    let spoken = '', answer = '', finished = false;
    const queue = mutedRef.current ? null : speechQueue(voiceRef.current, controller.signal, () => { if (!controller.signal.aborted) { setStatus('Miso is speaking…'); onTurn('speaking'); } });
    const timeout = setTimeout(() => controller.abort('timeout'), 60000);
    try {
      const res = await fetch('/api/companion/chat', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: thread, ...(selected.current ? { questionId: selected.current } : {}) }) });
      if (!res.ok || !res.body) { const data = await res.json().catch(() => null); throw new Error(data?.error || 'Miso could not respond. Please retry.'); }
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === 'error') throw new Error(event.message || 'Miso’s answer was interrupted.');
            if (event.type === 'done') finished = true;
            if (event.type === 'sources') { setSources(event.references ?? []); setSourceWarning(event.warning ?? ''); }
            if (event.type === 'delta' && typeof event.text === 'string') {
              answer += event.text; spoken += event.text;
              setMessages([...thread, { role: 'assistant', content: answer }]);
              const [pieces, rest] = speechPieces(spoken); spoken = rest; pieces.forEach(piece => queue?.push(piece));
            }
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!finished || !answer.trim()) throw new Error('Miso’s answer was interrupted. Please retry.');
      history.current = [...thread, { role: 'assistant' as const, content: answer }].slice(-12);
      speechPieces(spoken, true)[0].forEach(piece => queue?.push(piece));
      clearTimeout(timeout);
      await queue?.end();
      if (!controller.signal.aborted) { setStatus('Your turn.'); onTurn(modeRef.current === 'off' ? 'resting' : 'listening'); }
    } catch (e) {
      const intentional = controller.signal.aborted && controller.signal.reason !== 'timeout';
      controller.abort();
      await queue?.end().catch(() => {});
      if (!intentional) {
        const message = e instanceof Error ? e.message : 'Miso could not respond. Please retry.';
        setError(message); setStatus('Paused.'); mic.current?.abort(); changeMode('off'); wakeRef.current = false; setWake(false); onTurn('resting');
        if (answer) history.current = [...thread, { role: 'assistant', content: answer + ' [Reply interrupted.]' }];
      }
    } finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }, [changeMode, onTurn]);

  const startListening = useCallback(async (next: Mode) => {
    if (document.hidden || openingRef.current) return;
    if (live.current) { changeMode(next); return; }
    desired.current = true; setEnabled(true); openingRef.current = true; setOpening(true); needsGesture.current = false;
    try { localStorage.setItem('miso-live-enabled', 'on'); } catch { /* Session state still applies. */ }
    mic.current?.abort(); request.current?.abort(); setBusy(false);
    const controller = new AbortController(); mic.current = controller;
    changeMode(next); setMicReady(false); setError(''); setStatus('Allow microphone access to talk hands-free in this tab.');
    const commit = (interrupted = false) => {
      if (!answer.current) return;
      history.current = [...history.current, { role: 'assistant' as const, content: answer.current + (interrupted ? ' [Interrupted.]' : '') }].slice(-12);
      answer.current = ''; setMessages([...history.current]);
    };
    try {
      const connection = await openMisoLive({
        signal: controller.signal, questionId: selected.current, messages: history.current,
        voice: voiceRef.current, muted: mutedRef.current, wake: wakeRef.current,
        onReady: () => { if (!controller.signal.aborted) { setMicReady(true); setStatus(wakeRef.current ? 'Listening for “Hey Miso”…' : 'Listening. Speak whenever you like.'); onTurn('listening'); } },
        onSpeech: () => { if (!controller.signal.aborted) { request.current?.abort(); setBusy(false); setStatus('Hearing you…'); onTurn('listening'); } },
        onSpeaking: () => { if (!controller.signal.aborted) { setStatus('Miso is speaking. You can speak to interrupt.'); onTurn('speaking'); } },
        onIdle: () => { if (!controller.signal.aborted) { setBusy(false); setStatus('Listening. Your turn.'); onTurn('listening'); } },
        onSources: (references, warning) => { if (!controller.signal.aborted) { setSources(references); setSourceWarning(warning ?? ''); } },
        onError: error => {
          if (controller.signal.aborted) return;
          desired.current = false; setEnabled(false); needsGesture.current = /audio playback/i.test(error.message);
          pause('Voice paused. Tap Enable microphone to resume.');
          setError(error.name === 'NotAllowedError' ? 'Allow microphone access in your browser, then tap Enable microphone.' : error.message);
        },
        onEvent: event => {
          if (controller.signal.aborted) return;
          if (event.type === 'clear') { commit(true); setBusy(false); }
          if (event.type === 'transcript') setTranscript(event.text ?? '');
          if (event.type === 'no_speech') setStatus('Listening. Please try that again.');
          if (event.type === 'transcribing') setStatus('Understanding your question…');
          if (event.type === 'hearing') { setStatus('Hearing you…'); onTurn('listening'); }
          if (event.type === 'user') {
            commit(true); history.current = [...history.current, { role: 'user' as const, content: event.text ?? '' }].slice(-12);
            setTranscript(''); setSources([]); setSourceWarning(''); setError(''); lastAsked.current = history.current;
            setMessages([...history.current, { role: 'assistant', content: '' }]);
          }
          if (event.type === 'answer_start') { answer.current = ''; setBusy(true); setStatus('Miso is replying…'); onTurn('thinking'); }
          if (event.type === 'delta') { answer.current += event.text ?? ''; setMessages([...history.current, { role: 'assistant' as const, content: answer.current }]); }
          if (event.type === 'answer_done') commit();
          if (event.type === 'waiting') { changeMode('wake'); setStatus('Listening for “Hey Miso”…'); }
          if (event.type === 'disabled') stop('Microphone off.');
          if (event.type === 'renew') {
            live.current = null;
            queueMicrotask(() => { if (desired.current && !document.hidden) void restart.current(wakeRef.current ? 'wake' : 'talk'); });
          }
        },
      });
      if (controller.signal.aborted) { connection.close(); return; }
      live.current = connection; connection.updateQuestion(selected.current); connection.preferences({ voice: voiceRef.current, muted: mutedRef.current, wake: wakeRef.current });
    } catch (error) {
      if (!controller.signal.aborted) {
        desired.current = false; setEnabled(false); needsGesture.current = /audio playback/i.test((error as Error).message);
        pause('Tap Enable microphone to talk hands-free.');
        setError((error as Error).name === 'NotAllowedError' ? 'Allow microphone access in your browser, then tap Enable microphone.' : (error as Error).message);
      }
    } finally { if (mic.current === controller) { openingRef.current = false; setOpening(false); } }
  }, [changeMode, onTurn, pause, stop]);
  useEffect(() => { restart.current = startListening; }, [startListening]);
  useEffect(() => {
    live.current?.preferences({ voice, muted, wake });
  }, [voice, muted, wake]);

  useEffect(() => {
    // Permission is requested on the first visible visit. A manual Off choice persists.
    let wanted = true;
    try { wanted = localStorage.getItem('miso-live-enabled') !== 'off'; } catch { /* Default to the visible-tab permission request. */ }
    desired.current = wanted; setEnabled(wanted);
    const detach = bindVisibleMicrophone(document, () => desired.current,
      () => { void startListening(wakeRef.current ? 'wake' : 'talk'); },
      () => pause('Microphone paused while this tab is inactive. It resumes when you return.'));
    const gesture = () => {
      if (needsGesture.current && !document.hidden) { needsGesture.current = false; void unlockMisoAudio().then(() => startListening(wakeRef.current ? 'wake' : 'talk')).catch(error => setError(error.message)); }
    };
    const stored = (event: StorageEvent) => {
      if (event.key !== 'miso-live-enabled') return;
      const wanted = event.newValue !== 'off'; desired.current = wanted; setEnabled(wanted);
      if (!wanted) { needsGesture.current = false; pause('Microphone off.'); }
      else if (!document.hidden) void startListening(wakeRef.current ? 'wake' : 'talk');
    };
    window.addEventListener('storage', stored); document.addEventListener('pointerdown', gesture);
    return () => { detach(); window.removeEventListener('storage', stored); document.removeEventListener('pointerdown', gesture); mic.current?.abort(); live.current?.close(); request.current?.abort(); openingRef.current = false; };
  }, [pause, startListening]);

  useImperativeHandle(ref, () => ({ talk: () => { onOpen(); void startListening('talk'); }, show: onOpen }), [onOpen, startListening]);

  function close() { onClose(); }
  function toggleWake() {
    const next = !wakeRef.current; wakeRef.current = next; setWake(next);
    if (!live.current) void startListening(next ? 'wake' : 'talk');
    else changeMode(next ? 'wake' : 'talk');
  }
  async function send() {
    if (!draft.trim()) return;
    const text = draft.trim(); setDraft('');
    if (live.current) { live.current.send(text); return; }
    try { if (!mutedRef.current) await unlockMisoAudio(); await ask(text); } catch (error) { setError((error as Error).message); }
  }

  if (!open) return <button type="button" onClick={onOpen} className="fixed left-3 bottom-24 z-40 max-w-[75vw] rounded-full border border-hairline bg-plane px-4 py-2 text-xs text-ink shadow-lg sm:bottom-6">{micReady ? '● Miso is listening · Open' : opening ? 'Miso · Allow microphone access' : enabled ? 'Miso · Microphone paused' : 'Miso · Enable microphone'}</button>;
  return <section role="dialog" aria-label="Talk with Miso" className="fixed right-3 bottom-24 z-50 flex max-h-[78dvh] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-hairline bg-plane shadow-2xl sm:right-6 sm:bottom-6">
    <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
      {character ? <CharacterThumb character={character} size={40} /> : null}
      <div className="min-w-0 flex-1"><h2 className="font-semibold">Talk with Miso</h2><p className="text-xs text-ink-muted">{questionId ? 'With your current question · Java' : 'Your questions, concepts, and Java practice'}</p></div>
      <button onClick={close} aria-label="Close Miso" className="rounded-lg p-2 hover:bg-surface-2"><X size={18} /></button>
    </header>
    <div ref={log} className="min-h-24 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-relevant="additions">
      {!messages.length ? <p className="text-sm leading-6 text-ink-muted">Talk through a question, ask for a hint, or practise explaining your approach. I can see your tracker’s questions and notes.</p> : messages.map((message, i) => <div key={i} className={`rounded-xl p-3 text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere] ${message.role === 'user' ? 'ml-6 bg-surface-2' : 'mr-3 border border-hairline'}`}><span className="mb-1 block text-[10px] font-semibold tracking-wide text-ink-muted uppercase">{message.role === 'user' ? 'You' : 'Miso'}</span>{message.content || 'Thinking…'}</div>)}
      {sources.length ? <div className="space-y-1 text-xs"><p className="text-ink-muted">References for this reply</p>{sources.map(source => <a key={source.url} className="block text-accent underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>)}</div> : null}
      {sourceWarning ? <p className="text-xs text-ink-muted">{sourceWarning}</p> : null}
    </div>
    <div className="space-y-3 border-t border-hairline p-4">
      <p role="status" className="text-xs text-accent">{status}</p>
      {transcript ? <p className="text-xs text-ink-muted" aria-live="polite">You: {transcript}</p> : null}
      {error ? <div role="alert" className="rounded-lg border border-hairline p-2 text-xs leading-5">{error}{lastAsked.current ? <button className="ml-2 underline" onClick={() => { void unlockMisoAudio().then(() => ask('', lastAsked.current ?? undefined)); }}>Retry reply</button> : null}</div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink" onClick={() => { if (micReady) stop(); else { void unlockMisoAudio().catch(error => setError(error.message)); void startListening('talk'); } }}><Mic size={16} />{micReady ? 'Microphone on' : opening ? 'Connecting…' : 'Enable microphone'}</button>
        <button type="button" onClick={() => stop()} className="rounded-full border border-hairline p-2" aria-label="Stop Miso and microphone"><Square size={16} /></button>
        <button type="button" onClick={() => { setMuted(v => !v); if (!muted) { request.current?.abort(); setBusy(false); } }} aria-label={muted ? 'Unmute Miso' : 'Mute Miso'} className="rounded-full border border-hairline p-2">{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <span className="text-xs text-ink-muted">{mode === 'off' ? 'Mic off' : micReady ? '● Mic on' : 'Awaiting microphone'}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" checked={wake} onChange={toggleWake} />Only answer after “Hey Miso”</label>
        <select aria-label="Miso cloud voice" value={voice} onChange={e => setVoice(e.target.value as 'natural' | 'longer')} className="max-w-44 rounded-lg border border-hairline bg-plane px-2 py-1.5"><option value="natural">Natural · shorter allowance</option><option value="longer">Simple · longer allowance</option></select>
      </div>
      <p className="text-[11px] leading-4 text-ink-muted">Speak to interrupt Miso at any time. The microphone pauses when you leave this tab and resumes when you return. Cloud speech uses your free daily allowance.</p>
      <p className="text-[11px] leading-4 text-ink-muted">Say “search the web for…” to look up Wikipedia and Stack Overflow references.</p>
      <form onSubmit={e => { e.preventDefault(); void send(); }} className="flex items-end gap-2">
        <textarea aria-label="Message Miso" rows={2} maxLength={1200} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Or type to Miso…" className="min-w-0 flex-1 resize-none rounded-xl border border-hairline bg-surface-2 p-2.5 text-sm" />
        <button aria-label="Send message to Miso" disabled={!draft.trim() || opening || (busy && !live.current)} className="rounded-xl bg-accent p-3 text-accent-ink disabled:opacity-40"><ArrowUp size={17} /></button>
      </form>
    </div>
  </section>;
});
