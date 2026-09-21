'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from './ui/button';
import { ProgressBar } from './progress-bar';
import { CharacterFigure } from './character-figure';
import { getSkin, serverSkin, subscribe } from '@/lib/appearance';
import { useActiveCharacter } from './character-provider';
import { THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';

type Step = 'token' | 'page' | 'seeding' | 'ready';

/**
 * Walks a new user through connecting their own Notion.
 *
 * Seeding is driven from here on purpose: 456 questions at Notion's ~3
 * requests/second is minutes of work, far longer than a serverless function may
 * run. So the browser asks the server for one small chunk at a time and draws a
 * progress bar. If a request fails the cursor is kept, so Retry resumes rather
 * than starting over or double-inserting.
 */
export function SetupFlow({
  initialStep,
  initialCursor,
  initialTotal,
  initialError,
}: {
  initialStep: Step;
  initialCursor: number;
  initialTotal: number;
  initialError?: string | null;
}) {
  const router = useRouter();
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const character = useActiveCharacter();
  // A figure exists when art is installed and chosen, or the skin ships a
  // mascot. Studio with no character has neither, and keeps the plain tick.
  const hasFigure = Boolean(character) || THEMES[skin].mascot !== 'none';
  const [step, setStep] = useState<Step>(initialStep);
  const [cursor, setCursor] = useState(initialCursor);
  const [total, setTotal] = useState(initialTotal);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);

  // Guards against two seeding loops running at once (e.g. React re-mount).
  const looping = useRef(false);

  const post = useCallback(async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || 'Something went wrong.');
    return json;
  }, []);

  // ---- the seeding loop ----
  const runSeeding = useCallback(async () => {
    if (looping.current) return;
    looping.current = true;
    // No state is touched before the first await on purpose: this is started
    // from an effect, and a synchronous setState there would cascade renders.
    try {
      while (true) {
        const r = await post('/api/notion/provision', { action: 'step' });
        setCursor(r.cursor);
        if (r.total) setTotal(r.total);
        if (r.done) {
          setStep('ready');
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      looping.current = false;
    }
  }, [post]);

  // Kicked off on the next tick rather than inline, so the 'seeding' render
  // commits (and the progress bar paints) before any network work begins.
  useEffect(() => {
    if (step !== 'seeding' || error) return;
    const id = setTimeout(() => void runSeeding(), 0);
    return () => clearTimeout(id);
  }, [step, error, runSeeding]);

  // Once everything is in, send them to the dashboard.
  useEffect(() => {
    if (step !== 'ready') return;
    const id = setTimeout(() => router.push('/'), 1200);
    return () => clearTimeout(id);
  }, [step, router]);

  async function submitToken(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = new FormData(e.currentTarget).get('token');
    setBusy(true);
    setError(null);
    try {
      const r = await post('/api/notion/connect', { token });
      setWorkspace(r.workspace ?? null);
      setStep('page');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const page = new FormData(e.currentTarget).get('page');
    setBusy(true);
    setError(null);
    try {
      const r = await post('/api/notion/provision', { action: 'start', page });
      setCursor(r.cursor ?? 0);
      setTotal(r.total ?? total);
      setError(null);
      setStep('seeding');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      const r = await post('/api/notion/provision', { action: 'retry' });
      setError(null);
      setCursor(r.cursor ?? cursor);
      setStep(r.state === 'needs_page' ? 'page' : 'seeding');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pct = total ? (cursor / total) * 100 : 0;

  return (
    <div className="space-y-5">
      <Steps current={step} />

      {/* ---------- 1. token ---------- */}
      {step === 'token' ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Connect your Notion</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-ink-muted">
            <li>
              Open{' '}
              <a
                className="inline-flex items-center gap-0.5 text-accent underline underline-offset-2"
                href="https://www.notion.so/my-integrations"
                target="_blank"
                rel="noreferrer noopener"
              >
                notion.so/my-integrations
                <ExternalLink className="size-2.5" />
              </a>{' '}
              and click <strong>New integration</strong>.
            </li>
            <li>Give it any name, pick your workspace, and save.</li>
            <li>
              Copy the <strong>Internal Integration Secret</strong> — it starts with{' '}
              <code className="rounded bg-surface-2 px-1">ntn_</code>.
            </li>
          </ol>
          <form onSubmit={submitToken} className="space-y-2.5">
            <input
              name="token"
              type="password"
              required
              autoComplete="off"
              placeholder="ntn_..."
              className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <p className="text-meta text-ink-muted">
              Encrypted before it is stored, and only ever sent to Notion.
            </p>
            <Err message={error} />
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy ? 'Checking…' : 'Continue'}
            </Button>
          </form>
        </section>
      ) : null}

      {/* ---------- 2. page ---------- */}
      {step === 'page' ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            Pick a page to build in
            {workspace ? <span className="ml-1 font-normal text-ink-muted">· {workspace}</span> : null}
          </h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-ink-muted">
            <li>In Notion, create a new blank page (call it anything).</li>
            <li>
              On that page click the <strong>•••</strong> menu (top right) →{' '}
              <strong>Connections</strong> → add the integration you just made.
            </li>
            <li>
              Copy the page link with <strong>Share → Copy link</strong> and paste it below.
            </li>
          </ol>
          <p className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-meta text-ink-2">
            Don’t skip step 2 — without it, Notion won’t let us reach the page.
          </p>
          <form onSubmit={submitPage} className="space-y-2.5">
            <input
              name="page"
              required
              placeholder="https://www.notion.so/Your-Page-..."
              className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <Err message={error} />
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy ? 'Setting up…' : 'Build my tracker'}
            </Button>
            {busy ? (
              <p className="text-meta text-ink-muted">
                Setting up your tracker. This takes a few seconds.
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {/* ---------- 3. seeding ---------- */}
      {step === 'seeding' ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Adding your questions</h2>
          <ProgressBar value={pct} height={8} label="Setup progress" />
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-ink-muted">
              {error ? 'Paused' : 'Adding your questions…'}
            </span>
            <span className="tnum font-medium">
              {cursor} / {total}
            </span>
          </div>
          <p className="text-meta text-ink-muted">
            This takes a few minutes. You can close this tab and come back — it picks up
            where it left off.
          </p>
          {error ? (
            <>
              <Err message={error} />
              <Button onClick={retry} disabled={busy} variant="outline" className="w-full">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Continue
              </Button>
            </>
          ) : null}
        </section>
      ) : null}

      {/* ---------- 4. done ---------- */}
      {step === 'ready' ? (
        <section className="space-y-2 text-center">
          {hasFigure ? (
            <div className="flex justify-center">
              <CharacterFigure pose="celebrate" size={72} />
            </div>
          ) : (
            <div className="mx-auto grid size-10 place-items-center rounded-full bg-good/15">
              <Check className="size-5 text-good" />
            </div>
          )}
          <h2 className="text-sm font-semibold">All set</h2>
          <p className="text-xs text-ink-muted">
            All {total} questions are ready. Taking you to your dashboard…
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Err({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-xs text-critical"
    >
      <TriangleAlert className="mt-px size-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

const ORDER: Step[] = ['token', 'page', 'seeding', 'ready'];
const LABELS: Record<Step, string> = {
  token: 'Token',
  page: 'Page',
  seeding: 'Questions',
  ready: 'Done',
};

function Steps({ current }: { current: Step }) {
  const idx = ORDER.indexOf(current);
  return (
    <ol className="flex items-center gap-1.5">
      {ORDER.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col gap-1">
          <div
            className="h-1 rounded-full"
            style={{ background: i <= idx ? 'var(--accent)' : 'var(--grid)' }}
          />
          <span
            className={cn(
              'text-micro',
              i === idx ? 'font-medium text-ink' : 'text-ink-muted',
            )}
          >
            {LABELS[s]}
          </span>
        </li>
      ))}
    </ol>
  );
}
