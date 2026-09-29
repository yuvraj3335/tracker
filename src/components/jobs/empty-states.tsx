import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { CharacterFigure } from '../character-figure';
import { CopyText } from './copy-text';

const PROMPTS = [
  'Find SDE-1 jobs in Bengaluru or remote, posted this week.',
  'Search company career sites for backend roles in India.',
  'What should I follow up on?',
];

/** Shown until an AI tool is connected — the step that makes the pipeline fill itself. */
export function ConnectNudge() {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4 sm:pt-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <p className="text-xs text-ink-2">
            Connect Claude Code, Codex, Gemini or Claude Desktop, then ask it to find jobs. It searches the boards and
            company career sites, and saves the good ones here with how to apply.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/jobs/connect">Connect an AI tool</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** An empty pipeline says what to do next, and hands over the words to say it. */
export function EmptyPipeline({ connected }: { connected: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 px-4 py-10 text-center">
        <CharacterFigure pose="idle" size={64} />
        <div className="max-w-md space-y-1">
          <p className="text-sm font-semibold text-ink">No jobs yet</p>
          <p className="text-xs text-ink-muted">
            {connected
              ? 'Ask your AI tool to find some — try one of these:'
              : 'Connect an AI tool and it fills this in for you. Or add a job you found yourself.'}
          </p>
        </div>
        {connected ? (
          <ul className="w-full max-w-md space-y-1.5 text-left">
            {PROMPTS.map((p) => (
              <li key={p}>
                <CopyText text={p} />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild size="sm">
            <Link href="/jobs/new">Add a job</Link>
          </Button>
          {!connected ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/jobs/connect">Connect an AI tool</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
