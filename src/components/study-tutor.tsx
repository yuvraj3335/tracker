'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, BookOpen, Check, Copy, Globe, MessageSquare, Plus, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Reference, TutorMessage, TutorMode } from '@/lib/tutor';

type Turn = TutorMessage & { id: number; complete: boolean; sources?: Reference[]; warning?: string | null };
const MODES: { id: TutorMode; label: string; description: string }[] = [
  { id: 'discuss', label: 'Discuss', description: 'Explain a concept or talk through an approach' },
  { id: 'hint', label: 'Hint', description: 'One nudge at a time, without spoiling the solution' },
  { id: 'review', label: 'Review code', description: 'Find bugs, counterexamples and complexity' },
  { id: 'quiz', label: 'Quiz me', description: 'Practise one question at a time' },
];

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, i) => part.startsWith('`') && part.endsWith('`')
    ? <code key={i} className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>
    : part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}

function CodeBlock({ source, language }: { source: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return <div className="my-3 min-w-0 overflow-hidden rounded-xl border border-hairline bg-surface-2">
    <div className="flex items-center justify-between border-b border-hairline px-3 py-2 text-xs text-ink-muted">
      <span>{language || 'code'}</span>
      <button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-surface-3" onClick={async () => { try { await navigator.clipboard.writeText(source); setCopied(true); setError(''); } catch { setError('Select the code to copy it.'); } }}>
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? 'Copied' : 'Copy code'}
      </button>
    </div>
    <pre className="overflow-x-auto p-4 text-xs leading-6 sm:text-sm"><code>{source}</code></pre>
    {error ? <p className="px-3 pb-2 text-xs" role="status">{error}</p> : null}
  </div>;
}

// React renders all model output as text; HTML and generated links never execute.
function Answer({ text }: { text: string }) {
  const chunks = text.split('```');
  return <div className="min-w-0 text-sm leading-7 [overflow-wrap:anywhere]">{chunks.map((chunk, i) => {
    if (i % 2) {
      const newline = chunk.indexOf('\n');
      return <CodeBlock key={i} language={newline >= 0 ? chunk.slice(0, newline).trim() : ''} source={newline >= 0 ? chunk.slice(newline + 1).replace(/\n$/, '') : chunk} />;
    }
    return <div key={i} className="whitespace-pre-wrap">{chunk.split('\n').map((line, j) => /^#{1,4}\s/.test(line)
      ? <div key={j} className="mt-4 mb-1 font-semibold">{inline(line.replace(/^#{1,4}\s+/, ''))}</div>
      : <span key={j}>{inline(line)}{j < chunk.split('\n').length - 1 ? '\n' : ''}</span>)}</div>;
  })}</div>;
}

export function StudyTutor({ initialQuestion = '' }: { initialQuestion?: string }) {
  const [question, setQuestion] = useState(initialQuestion);
  const [mode, setMode] = useState<TutorMode>(initialQuestion ? 'hint' : 'discuss');
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [useSearch, setUseSearch] = useState(false);
  const [search, setSearch] = useState('');
  const abort = useRef<AbortController | null>(null);
  const serial = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [retry, setRetry] = useState<Turn[] | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns.length, busy]);

  async function ask(history: Turn[]) {
    if (busy) return;
    if (useSearch && !search.trim()) { setError('Enter a public search phrase first.'); return; }
    const messages = history.filter(t => t.content.trim()).map(t => ({
      role: t.role,
      content: t.content + (t.role === 'assistant' && !t.complete ? '\n[This answer was interrupted.]' : ''),
    }));
    if (messages.length > 24 || messages.reduce((sum, m) => sum + m.content.length, 0) > 36000) { setError('This chat is full. Start a new chat to continue.'); return; }
    const answerId = ++serial.current;
    setRetry(history);
    setTurns([...history, { id: answerId, role: 'assistant', content: '', complete: false }]);
    setBusy(true); setError(''); setDraft('');
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort('timeout'), 65000);
    const update = (patch: Partial<Turn>) => setTurns(current => current.map(t => t.id === answerId ? { ...t, ...patch } : t));
    let text = '', finished = false, streamError = '';
    try {
      const response = await fetch('/api/tutor', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, question, mode, search: useSearch ? search.trim() : '' }) });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || (response.status === 401 ? 'Sign in again to continue.' : 'The tutor is unavailable. Please retry.'));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === 'delta' && typeof event.text === 'string') { text += event.text; update({ content: text }); }
            if (event.type === 'sources') update({ sources: event.references ?? [], warning: event.warning ?? null });
            if (event.type === 'done') finished = true;
            if (event.type === 'error') streamError = event.message || 'The answer was interrupted.';
          }
        }
      } finally { reader.releaseLock(); }
      if (streamError) throw new Error(streamError);
      if (!finished || !text.trim()) throw new Error('The answer was interrupted. Please retry.');
      update({ complete: true }); setRetry(null);
    } catch (e) {
      setError(controller.signal.aborted ? controller.signal.reason === 'timeout' ? 'The answer timed out. Please retry.' : 'Answer stopped. You can retry or ask another question.' : (e as Error).message);
    } finally { clearTimeout(timer); setBusy(false); abort.current = null; }
  }

  const send = (text = draft) => { if (text.trim()) void ask([...turns, { id: ++serial.current, role: 'user', content: text.trim(), complete: true }]); };
  const modeInfo = MODES.find(m => m.id === mode)!;
  return <div className="js-content-in mx-auto max-w-3xl space-y-5 pb-4">
    <header className="flex items-center justify-between gap-3 border-b border-hairline pb-4">
      <div><p className="mb-1 text-xs font-medium tracking-widest text-accent uppercase">Your practice partner</p><h1 className="text-2xl font-semibold tracking-tight">Study tutor</h1></div>
      <button type="button" disabled={busy} onClick={() => { setTurns([]); setError(''); setRetry(null); input.current?.focus(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-xs hover:bg-surface-2 disabled:opacity-50"><Plus className="size-3.5" />New chat</button>
    </header>

    {question ? <div className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-2 px-4 py-3"><BookOpen className="mt-0.5 size-4 shrink-0 text-accent" /><div className="min-w-0 flex-1"><p className="text-xs text-ink-muted">Practising</p><p className="text-sm font-medium">{question}</p><p className="mt-1 text-xs text-ink-muted">Paste the full statement or your code when needed.</p></div><button disabled={busy} type="button" onClick={() => setQuestion('')} className="text-xs text-ink-muted hover:text-ink">Clear</button></div> : null}

    <div className="flex flex-wrap gap-2" aria-label="Tutor mode">{MODES.map(m => <button key={m.id} type="button" disabled={busy} aria-pressed={mode === m.id} title={m.description} onClick={() => setMode(m.id)} className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50', mode === m.id ? 'border-accent bg-accent text-accent-ink' : 'border-hairline hover:bg-surface-2')}>{m.label}</button>)}</div>

    {!turns.length ? <section className="rounded-2xl border border-hairline bg-surface-2/40 px-5 py-8 sm:px-8">
      <MessageSquare className="mb-4 size-7 text-accent" /><h2 className="text-xl font-medium tracking-tight">Let’s work through it.</h2><p className="mt-2 max-w-lg text-sm leading-6 text-ink-muted">Ask why an approach works, get a small hint, or paste code you’re stuck on. Follow up until it clicks.</p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">{(question ? ['Give me a first hint for this question.', 'What concepts should I know before solving this?'] : ['Explain binary search with a small dry run.', 'How do I recognise a sliding-window problem?', 'Quiz me on time and space complexity.', 'Help me understand recursion and the call stack.']).map(prompt => <button key={prompt} type="button" onClick={() => { setDraft(prompt); input.current?.focus(); }} className="rounded-xl border border-hairline bg-plane p-3 text-left text-xs leading-5 transition-colors hover:border-accent">{prompt}</button>)}</div>
    </section> : <section aria-label="Study conversation" className="space-y-6">{turns.map(turn => <article key={turn.id} className={cn('min-w-0', turn.role === 'user' ? 'ml-5 rounded-2xl bg-surface-2 px-4 py-3 sm:ml-12' : 'px-1')}>
      <p className="mb-2 text-xs font-semibold text-ink-muted">{turn.role === 'user' ? 'You' : 'Study tutor'}</p>
      {turn.content ? <Answer text={turn.content} /> : <p className="text-sm text-ink-muted" role="status">{busy ? 'Working through your question…' : 'No answer received.'}</p>}
      {turn.warning ? <p className="mt-3 text-xs text-ink-muted">{turn.warning}</p> : null}
      {turn.sources?.length ? <div className="mt-4 border-t border-hairline pt-3"><p className="mb-2 text-xs font-medium text-ink-muted">Retrieved references</p><ol className="space-y-1.5">{turn.sources.map((source, i) => <li key={source.url} className="text-xs"><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">[{i + 1}] {source.title}</a></li>)}</ol></div> : null}
    </article>)}</section>}

    <div ref={bottom} />
    <form onSubmit={e => { e.preventDefault(); send(); }} className="rounded-2xl border border-hairline bg-plane p-3 shadow-sm">
      <label htmlFor="tutor-message" className="sr-only">Message your study tutor</label>
      <textarea ref={input} id="tutor-message" value={draft} onChange={e => setDraft(e.target.value)} disabled={busy} maxLength={8000} rows={4} placeholder={mode === 'review' ? 'Paste your code and describe what is going wrong…' : 'Ask a question, share your approach, or paste code…'} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} className="w-full resize-y rounded-lg bg-transparent px-2 py-1 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60" />
      <div className="flex items-center justify-between gap-2 px-1 pt-2"><label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-muted"><input type="checkbox" checked={useSearch} disabled={busy} onChange={e => setUseSearch(e.target.checked)} /><Globe className="size-3.5" />Search references</label><div className="flex items-center gap-3"><span className="text-micro text-ink-muted">{draft.length}/8,000</span>{busy ? <button type="button" onClick={() => abort.current?.abort()} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-xs"><Square className="size-3" />Stop</button> : <button type="submit" disabled={!draft.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-ink disabled:opacity-40">Send<ArrowUp className="size-3.5" /></button>}</div></div>
      {useSearch ? <div className="mt-3 border-t border-hairline px-1 pt-3"><label htmlFor="tutor-search" className="text-xs font-medium">Public search phrase</label><input id="tutor-search" value={search} disabled={busy} onChange={e => setSearch(e.target.value)} maxLength={180} placeholder="e.g. binary search loop invariant" className="mt-1 w-full rounded-lg border border-hairline bg-plane px-3 py-2 text-sm" /><p className="mt-2 text-xs leading-5 text-ink-muted">Searches Wikipedia and Stack Overflow. Only this phrase is sent. {search.trim() ? <a href={`https://www.google.com/search?q=${encodeURIComponent(search.trim())}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">Open in Google ↗</a> : null}</p></div> : null}
    </form>
    {error ? <div role="alert" className="rounded-xl border border-hairline bg-surface-2 p-3 text-sm"><p>{error}</p>{retry && !busy ? <button type="button" onClick={() => { if (retry) void ask(retry); }} className="mt-2 font-medium text-accent underline">Retry answer</button> : null}</div> : null}
    <p className="text-center text-xs leading-5 text-ink-muted">{modeInfo.description}.<br />AI runs in the cloud. Daily free limits apply. Chat stays in this tab; code is discussed, not executed.</p>
  </div>;
}
