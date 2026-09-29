'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/** One line of text with a copy button — for prompts and commands. */
export function CopyText({ text, mono = false, className }: { text: string; mono?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* the text is on screen either way */
        }
      }}
      className={cn(
        'group flex w-full items-center justify-between gap-3 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-left text-xs text-ink-2 transition-colors hover:border-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
        mono && 'font-mono',
        className,
      )}
    >
      <span className="min-w-0 break-words">{text}</span>
      <span className="shrink-0 text-ink-muted group-hover:text-ink" aria-hidden>
        {copied ? <Check className="size-3.5 text-good-text" /> : <Copy className="size-3.5" />}
      </span>
      <span className="sr-only">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
