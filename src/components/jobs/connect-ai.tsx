'use client';

import { useActionState, useState, useTransition } from 'react';
import { Check, Copy, KeyRound, Loader2, TriangleAlert } from 'lucide-react';
import { createApiKeyAction, revokeApiKeyAction, type NewKeyState } from '@/app/jobs/actions';
import type { ApiKey } from '@/lib/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { FormMessage, inputClass } from './job-ui';
import { cn } from '@/lib/utils';

type Tool = { id: string; label: string; body: (c: Ctx) => React.ReactNode };
type Ctx = { origin: string; key: string | null };

const PATH = '~/work/job-switch-tracker';
const CONNECTOR = `${PATH}/connector/job-hunt.mjs`;

function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-hairline bg-surface-2 p-3 pr-10 text-xs leading-relaxed text-ink-2">
        {text}
      </pre>
      <button
        type="button"
        aria-label={label ?? 'Copy'}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* the text is selectable either way */
          }
        }}
        className="absolute top-2 right-2 rounded-md p-1.5 text-ink-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        {copied ? <Check className="size-3.5 text-good-text" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

const P = ({ children }: { children: React.ReactNode }) => <p className="text-xs leading-relaxed text-ink-2">{children}</p>;

/**
 * Every AI tool on the computer runs the same local connector; web and phone
 * apps, which cannot run anything locally, get the tracker's own URL instead.
 * The config below is what each tool actually expects today — checked against
 * each one's documentation when this was written.
 */
const TOOLS: Tool[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    body: () => (
      <>
        <P>Inside the tracker&apos;s folder it is already set up — the repo ships a project <code>.mcp.json</code>. Approve the “job-hunt” server when Claude Code asks. To use it from any folder:</P>
        <CopyBlock text={`claude mcp add --scope user job-hunt -- node ${CONNECTOR}`} />
      </>
    ),
  },
  {
    id: 'codex',
    label: 'Codex',
    body: () => (
      <>
        <P>Add to <code>~/.codex/config.toml</code> (board searches take up to a minute, hence the longer timeout):</P>
        <CopyBlock text={`[mcp_servers.job-hunt]\ncommand = "node"\nargs = ["${CONNECTOR.replace('~', '/Users/<you>')}"]\ntool_timeout_sec = 180`} />
      </>
    ),
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    body: () => (
      <>
        <P>Run once:</P>
        <CopyBlock text={`gemini mcp add --scope user job-hunt node ${CONNECTOR}`} />
      </>
    ),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    body: () => (
      <>
        <P>Add to <code>~/.cursor/mcp.json</code>:</P>
        <CopyBlock text={JSON.stringify({ mcpServers: { 'job-hunt': { command: 'node', args: [CONNECTOR.replace('~', '/Users/<you>')] } } }, null, 2)} />
      </>
    ),
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    body: () => (
      <>
        <P>
          Settings → Developer → Edit Config, and add the server below. Desktop apps do not see your shell&apos;s PATH, so
          use the full path from <code>which node</code>.
        </P>
        <CopyBlock text={JSON.stringify({ mcpServers: { 'job-hunt': { command: '/opt/homebrew/bin/node', args: [CONNECTOR.replace('~', '/Users/<you>')] } } }, null, 2)} />
      </>
    ),
  },
  {
    id: 'web',
    label: 'claude.ai · phone · ChatGPT',
    body: ({ origin, key }) => (
      <>
        <P>
          Web and phone apps cannot run the connector, so they reach the tracker directly: everything except the job
          boards, which need Crawl4AI on your computer. Company career-site search still works. In claude.ai:
          Settings → Connectors → Add custom connector, and paste:
        </P>
        <CopyBlock text={`${origin}/api/mcp/${key ?? 'jt_…your-key…'}`} />
        <p className="flex items-start gap-1.5 text-meta text-ink-muted">
          <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
          This URL contains the key itself, because these apps cannot send it any other way. Use a separate key for it,
          so you can revoke it on its own.
        </p>
      </>
    ),
  },
  {
    id: 'other',
    label: 'Any MCP client',
    body: ({ origin, key }) => (
      <>
        <P>Streamable HTTP, with the key as a bearer token:</P>
        <CopyBlock text={`URL:    ${origin}/api/mcp\nHeader: Authorization: Bearer ${key ?? 'jt_…your-key…'}`} />
      </>
    ),
  },
];

export function ConnectAI({ origin, keys, now }: { origin: string; keys: ApiKey[]; now: number }) {
  const [state, action, pending] = useActionState<NewKeyState, FormData>(createApiKeyAction, null);
  const [tool, setTool] = useState(TOOLS[0].id);
  const created = state?.ok ? state : null;
  const active = keys.filter((k) => !k.revokedAt);
  const current = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];

  return (
    <div className="space-y-4">
      {/* ---- 1. key ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <KeyRound className="size-3.5 text-ink-muted" /> 1 · Create a personal key
          </CardTitle>
          <CardDescription>
            A key lets an AI tool read and update your jobs and profile — nothing else, not your sign-in or your DSA
            progress. It is shown once; only a fingerprint of it is stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={action} className="flex flex-wrap gap-2">
            <input name="name" placeholder="Name it, e.g. MacBook" maxLength={60} className={cn(inputClass, 'max-w-xs flex-1')} aria-label="Key name" />
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create key
            </Button>
          </form>
          {state && !state.ok ? <FormMessage state={{ ok: false, message: state.message }} /> : null}
          {created ? (
            <div className="space-y-2 rounded-lg border border-hairline bg-surface-2 p-3">
              <p className="text-xs font-medium text-ink">
                “{created.name}” — copy it now, it will not be shown again.
              </p>
              <CopyBlock text={created.key} label="Copy key" />
              <p className="text-xs text-ink-2">Then save it on your computer, where the connector reads it (after copying):</p>
              <CopyBlock text="mkdir -p ~/.config/job-tracker && pbpaste > ~/.config/job-tracker/key && chmod 600 ~/.config/job-tracker/key" />
            </div>
          ) : null}
          {active.length ? (
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-hairline">
              {active.map((k) => (
                <KeyRow key={k.id} k={k} now={now} />
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {/* ---- 2. crawler ---- */}
      <Card>
        <CardHeader>
          <CardTitle>2 · Start the crawler on your computer</CardTitle>
          <CardDescription>
            Job boards are searched by Crawl4AI — free, open source, running in Docker on your own machine. Needs Docker
            Desktop. In the tracker&apos;s folder:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <CopyBlock text={`cd ${PATH} && npm run crawler:setup`} />
          <P>
            It starts Crawl4AI on <code>127.0.0.1:11235</code> — reachable from this computer only, behind its own token
            — and restarts it with Docker. Check everything with <code>npm run check:boards</code>.
          </P>
        </CardContent>
      </Card>

      {/* ---- 3. tools ---- */}
      <Card>
        <CardHeader>
          <CardTitle>3 · Connect your AI tools</CardTitle>
          <CardDescription>
            Every tool on your computer runs the same small connector, so they all search and save the same way.
            <code className="ml-1">npm run connect</code> prints each tool&apos;s config with your real paths.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="AI tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tool === t.id}
                onClick={() => setTool(t.id)}
                className={cn(
                  'skin-pill shrink-0 border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                  tool === t.id ? 'border-transparent bg-accent text-accent-ink' : 'border-hairline text-ink-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="space-y-2">
            {current.body({ origin, key: created?.key ?? null })}
          </div>
          <div className="rounded-lg border border-hairline px-3 py-2.5">
            <p className="text-xs font-medium text-ink">Then just ask:</p>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
              <li>“Find SDE-1 jobs in Bengaluru or remote, posted this week.”</li>
              <li>“I applied to the Visa role through a referral from Ravi.”</li>
              <li>“Stripe sent an OA, due Friday.” · “What should I follow up on?”</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** "just now", "12m ago", "3h ago", "2d ago" — how recently a tool used this key. */
function since(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** `now` comes from the server render, so both renders agree on "12m ago". */
function KeyRow({ k, now }: { k: ApiKey; now: number }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // "Active" is what the page can honestly say: a tool used this key recently.
  // Whether a tool is open right now is not something the tracker can see.
  const active = k.lastUsedAt ? now - new Date(k.lastUsedAt).getTime() < 24 * 3_600_000 : false;
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-xs">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: active ? 'var(--good)' : 'var(--axis)' }}
      />
      <span className="font-medium text-ink">{k.name}</span>
      <code className="text-ink-muted">{k.prefix}…</code>
      <span className="text-ink-muted">· {k.lastUsedAt ? `${active ? 'active, ' : ''}used ${since(k.lastUsedAt, now)}` : 'not used yet'}</span>
      <span className="ml-auto flex items-center gap-2">
        {message ? <span className="text-ink-muted">{message}</span> : null}
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await revokeApiKeyAction(k.id);
                  if (r && !r.ok) setMessage(r.message);
                })
              }
            >
              {pending ? <Loader2 className="size-3 animate-spin" /> : null}
              Revoke
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="text-ink-muted underline-offset-2 hover:text-ink hover:underline">
            Revoke…
          </button>
        )}
      </span>
    </li>
  );
}
