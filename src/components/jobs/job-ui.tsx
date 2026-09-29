import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { daysBetween, formatKey, type DayKey } from '@/lib/date';
import type { JobStatus } from '@/lib/schema';
import type { FollowUp } from '@/lib/jobs';
import { cn } from '@/lib/utils';

/**
 * Pieces every job screen shares.
 *
 * Status is shown as a coloured dot beside neutral ink, never as coloured text
 * on a coloured chip: the skins' accents are tuned for controls, and a ten-way
 * palette of tinted chips would have to clear contrast against six skin-mode
 * surfaces each. The dot carries identity; the word carries meaning.
 */
export const STATUS_COLOR: Record<JobStatus, string> = {
  Found: 'var(--ink-muted)',
  Shortlisted: 'var(--series-1)',
  Applied: 'var(--accent)',
  Assessment: 'var(--warning)',
  Interviewing: 'var(--series-2)',
  Offer: 'var(--good)',
  Rejected: 'var(--critical)',
  Ghosted: 'var(--axis)',
  Withdrawn: 'var(--axis)',
  Skipped: 'var(--axis)',
};

export function StatusDot({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ background: STATUS_COLOR[status] }}
    />
  );
}

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className="skin-pill inline-flex items-center gap-1.5 border border-hairline px-2 py-0.5 text-micro font-medium text-ink-2">
      <StatusDot status={status} />
      {status}
    </span>
  );
}

/** Match as a plain number with a short bar — the bar reinforces, the number carries it. */
export function MatchBadge({ match }: { match: number | null }) {
  if (match === null) return null;
  const tone = match >= 75 ? 'var(--good)' : match >= 55 ? 'var(--accent)' : 'var(--axis)';
  return (
    <span className="inline-flex items-center gap-1 text-micro font-semibold text-ink-2 tnum" title={`Match ${match} of 100`}>
      <span className="relative h-1 w-6 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${match}%`, background: tone }} />
      </span>
      {match}
    </span>
  );
}

/** "today", "yesterday", "5d ago", "3w ago", then a date. */
export function ago(day: DayKey | null, today: DayKey): string {
  if (!day) return '';
  const d = daysBetween(day, today);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return formatKey(day, 'd MMM yyyy');
}

export function followUpLabel(f: FollowUp): string {
  if (f.kind === 'due') return f.days === 0 ? 'Follow up today' : `Follow-up ${f.days}d overdue`;
  if (f.kind === 'stale') return `${f.days}d, no reply — ghosted?`;
  return `${f.days}d, no reply — nudge`;
}

export function FollowUpBadge({ followUp }: { followUp: FollowUp | null }) {
  if (!followUp) return null;
  return (
    <span
      className={cn(
        'skin-pill inline-flex items-center gap-1 border px-2 py-0.5 text-micro font-medium',
        followUp.kind === 'due' ? 'border-transparent bg-accent text-accent-ink' : 'border-hairline text-ink-2',
      )}
    >
      {followUpLabel(followUp)}
    </span>
  );
}

/** A form's answer, announced: politely when it worked, assertively when it did not. */
export function FormMessage({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state?.message) return null;
  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-1.5 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-xs',
        state.ok ? 'text-ink-2' : 'text-critical',
      )}
    >
      {state.ok ? (
        <CheckCircle2 className="mt-px size-3.5 shrink-0 text-good-text" aria-hidden />
      ) : (
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      )}
      <span>{state.message}</span>
    </p>
  );
}

export const inputClass =
  'w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function Label({ htmlFor, children, hint }: { htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-ink-2">
      {children}
      {hint ? <span className="ml-1 font-normal text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export function TextField({
  name,
  label,
  defaultValue,
  placeholder,
  type = 'text',
  hint,
  required,
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  placeholder?: string;
  type?: 'text' | 'url' | 'date' | 'number';
  hint?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={name} hint={hint}>
        {label}
      </Label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        required={required}
        {...(type === 'number' ? { min: 0, max: 100, step: 1 } : {})}
        className={inputClass}
      />
    </div>
  );
}

export function TextArea({
  name,
  label,
  defaultValue,
  placeholder,
  rows = 3,
  hint,
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
  rows?: number;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={name} hint={hint}>
        {label}
      </Label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        className={cn(inputClass, 'resize-y leading-relaxed')}
      />
    </div>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  empty = '—',
  className,
}: {
  name: string;
  label: string;
  options: readonly string[];
  defaultValue?: string | null;
  /** Label for the blank choice; pass null to force a value. */
  empty?: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={name}>{label}</Label>
      <select id={name} name={name} defaultValue={defaultValue ?? ''} className={cn(inputClass, 'cursor-pointer')}>
        {empty !== null ? <option value="">{empty}</option> : null}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Only http(s) links are ever rendered as hrefs — a row edited by hand in Notion could hold anything. */
export const safeHref = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);
