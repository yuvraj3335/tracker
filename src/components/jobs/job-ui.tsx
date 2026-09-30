import {
  CheckCircle2,
  ChevronDown,
  CircleCheck,
  CircleDot,
  CircleMinus,
  ExternalLink,
  OctagonX,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { daysBetween, formatKey, type DayKey } from '@/lib/date';
import { JOB_STATUS, type EvalDepth, type JobStatus, type Legitimacy, type PostingState, type Verdict } from '@/lib/schema';
import { APPLY_AT, CONSIDER_AT, DIMENSIONS, type DimensionId, type DimensionScores, type FollowUp } from '@/lib/jobs';
import { cn } from '@/lib/utils';

/**
 * The pieces every job screen is built from.
 *
 * Colour carries identity, never meaning on its own: a status is a dot beside
 * its name, a fit score is a ring beside its number. The skins' accents are
 * tuned for controls, and a ten-way palette of tinted text would have to clear
 * contrast against six skin-mode surfaces each — so text stays in ink, and the
 * colour sits in shapes, which need only 3:1.
 */

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

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

/** The pipeline groups' colours, in the same roles as the statuses inside them. */
export const GROUP_COLOR: Record<string, string> = {
  review: 'var(--ink-muted)',
  apply: 'var(--series-1)',
  applied: 'var(--accent)',
  process: 'var(--series-2)',
  offer: 'var(--good)',
  closed: 'var(--axis)',
};

export function StatusDot({ status, className }: { status: JobStatus; className?: string }) {
  return <Dot color={STATUS_COLOR[status]} className={className} />;
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color }} />;
}

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className="skin-pill inline-flex items-center gap-1.5 border border-hairline bg-surface px-2 py-0.5 text-micro font-medium text-ink-2">
      <StatusDot status={status} />
      {status}
    </span>
  );
}

/**
 * The status control: a real <select>, dressed as a pill with the status dot.
 * Native on purpose — keyboard and screen-reader correct for free, and the
 * platform picker on a phone — with the dot drawn beside it, not inside it.
 */
export function StatusSelect({
  value,
  onChange,
  label,
  disabled,
  size = 'sm',
}: {
  value: JobStatus;
  onChange: (next: JobStatus) => void;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <StatusDot status={value} className="pointer-events-none absolute left-2.5" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as JobStatus)}
        aria-label={label}
        disabled={disabled}
        className={cn(
          'skin-pill cursor-pointer appearance-none border border-hairline bg-surface font-medium text-ink-2 transition-colors',
          'hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60',
          size === 'md' ? 'py-1.5 pr-8 pl-7 text-sm' : 'py-1 pr-7 pl-6 text-xs',
        )}
      >
        {JOB_STATUS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3 text-ink-muted" aria-hidden />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Company, chips, fit
// ---------------------------------------------------------------------------

const TINTS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Initials of the name that matter: "Walmart Global Tech" → "WG", "CRED" → "CR". */
export function initials(name: string): string {
  const words = name
    .replace(/\b(pvt|private|ltd|limited|inc|llc|technologies|solutions)\b\.?/gi, '')
    .split(/[\s\-–—&/,.()]+/)
    .filter((w) => /[A-Za-z0-9]/.test(w));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * A company's mark: its initials on a tint picked from the company name, so the
 * same company always wears the same colour and a list is easier to scan. The
 * tint is mixed toward the surface, so the ink on it keeps full contrast.
 */
export function CompanyMark({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const tint = TINTS[hash(name.toLowerCase()) % TINTS.length];
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-[min(var(--radius-card),10px)] font-semibold tracking-tight text-ink select-none', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: `color-mix(in oklab, ${tint} 17%, var(--surface))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tint} 32%, transparent)`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function Chip({ children, icon, className, title }: { children: React.ReactNode; icon?: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn('skin-pill inline-flex max-w-full items-center gap-1 border border-hairline bg-surface px-2 py-0.5 text-micro text-ink-2', className)}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A fit score: the number, with a ring that reinforces it. The ring's tones follow the verdict lines. */
export function MatchBadge({ match, className }: { match: number | null; className?: string }) {
  if (match === null) return null;
  const tone = match >= APPLY_AT ? 'var(--good)' : match >= CONSIDER_AT ? 'var(--accent)' : 'var(--axis)';
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <span
      className={cn('skin-pill inline-flex items-center gap-1 border border-hairline bg-surface px-1.5 py-0.5 text-micro font-semibold text-ink-2 tnum', className)}
      title={`Fits your profile ${match} out of 100`}
    >
      <svg viewBox="0 0 14 14" className="size-3 -rotate-90" aria-hidden>
        <circle cx="7" cy="7" r={r} fill="none" stroke="var(--grid)" strokeWidth="2.5" />
        <circle cx="7" cy="7" r={r} fill="none" stroke={tone} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - match / 100)} />
      </svg>
      {match}% fit
    </span>
  );
}

// ---------------------------------------------------------------------------
// Judgment: verdict, legitimacy, flags, scores
// ---------------------------------------------------------------------------

export const VERDICT_STYLE: Record<Verdict, { color: string; Icon: LucideIcon; hint: string }> = {
  Apply: { color: 'var(--good)', Icon: CircleCheck, hint: 'Worth applying' },
  Consider: { color: 'var(--accent)', Icon: CircleDot, hint: 'Apply with a reason: a referral, a target company' },
  'Research first': { color: 'var(--warning)', Icon: ScanSearch, hint: 'Read the posting in full before deciding' },
  Skip: { color: 'var(--axis)', Icon: CircleMinus, hint: 'Not worth the application' },
};

/** The rubric's verdict, as an icon beside its word. A quick look says so. */
export function VerdictBadge({
  verdict,
  depth,
  className,
}: {
  verdict: Verdict | null;
  depth?: EvalDepth | null;
  className?: string;
}) {
  if (!verdict) return null;
  const { color, Icon, hint } = VERDICT_STYLE[verdict];
  return (
    <span
      title={`${verdict}${depth === 'Quick' ? ', from a quick look' : ''}: ${hint}`}
      className={cn('skin-pill inline-flex items-center gap-1 border border-hairline bg-surface px-1.5 py-0.5 text-micro font-semibold text-ink-2', className)}
    >
      <Icon className="size-3 shrink-0" style={{ color }} aria-hidden />
      {verdict}
      {depth === 'Quick' ? <span className="font-normal text-ink-muted">· quick</span> : null}
    </span>
  );
}

const LEGITIMACY_STYLE: Record<Legitimacy, { color: string; Icon: LucideIcon; label: string }> = {
  High: { color: 'var(--good)', Icon: ShieldCheck, label: 'Looks genuine' },
  Caution: { color: 'var(--warning)', Icon: ShieldAlert, label: 'Check the posting' },
  Suspicious: { color: 'var(--critical)', Icon: ShieldX, label: 'Looks suspicious' },
};

/** Only a doubt is worth the space on a card; the job page shows High too. */
export function LegitimacyBadge({ legitimacy, showHigh = false }: { legitimacy: Legitimacy | null; showHigh?: boolean }) {
  if (!legitimacy || (legitimacy === 'High' && !showHigh)) return null;
  const { color, Icon, label } = LEGITIMACY_STYLE[legitimacy];
  return (
    <span
      title={`Legitimacy: ${legitimacy}`}
      className="skin-pill inline-flex items-center gap-1 border border-hairline bg-surface px-1.5 py-0.5 text-micro font-medium text-ink-2"
    >
      <Icon className="size-3 shrink-0" style={{ color }} aria-hidden />
      {label}
    </span>
  );
}

const POSTING_STYLE: Record<PostingState, { color: string; label: string }> = {
  Open: { color: 'var(--good)', label: 'Still open' },
  Closed: { color: 'var(--critical)', label: 'Posting closed' },
  Unclear: { color: 'var(--axis)', label: 'Could not tell if open' },
  Blocked: { color: 'var(--warning)', label: 'Site blocked the check' },
};

/**
 * Whether the posting is still up. On a card only Closed earns the space; the
 * job page shows every state, with when it was checked.
 */
export function PostingBadge({ posting, checkedOn, today, all = false }: { posting: PostingState | null; checkedOn?: DayKey | null; today?: DayKey; all?: boolean }) {
  if (!posting || (!all && posting !== 'Closed')) return null;
  const { color, label } = POSTING_STYLE[posting];
  return (
    <span className="skin-pill inline-flex items-center gap-1 border border-hairline bg-surface px-1.5 py-0.5 text-micro font-medium text-ink-2" title={checkedOn ? `Checked ${checkedOn}` : undefined}>
      <Dot color={color} />
      {label}
      {all && checkedOn && today ? <span className="font-normal text-ink-muted">· {ago(checkedOn, today)}</span> : null}
    </span>
  );
}

export function HardStopChip({ children }: { children: string }) {
  return (
    <Chip icon={<OctagonX className="size-2.5 shrink-0" style={{ color: 'var(--critical)' }} aria-hidden />} title={`Hard stop: ${children}`}>
      {children}
    </Chip>
  );
}

export function RedFlagChip({ children }: { children: string }) {
  return (
    <Chip icon={<TriangleAlert className="size-2.5 shrink-0" style={{ color: 'var(--warning)' }} aria-hidden />} title={`Red flag: ${children}`}>
      {children}
    </Chip>
  );
}

const scoreTone = (s: number) => (s >= 4 ? 'var(--good)' : s === 3 ? 'var(--accent)' : 'var(--warning)');

/**
 * The five scores as short bars, with the number beside each. The weight is
 * shown so it is clear why Skills moved the match more than Pay did.
 */
export function ScoreBars({ scores, notes }: { scores: DimensionScores; notes?: Partial<Record<DimensionId, string>> }) {
  return (
    <dl className="space-y-2.5">
      {DIMENSIONS.map((d) => {
        const s = scores[d.id];
        return (
          <div key={d.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.25rem] items-center gap-x-3 gap-y-0.5">
            <dt className="text-xs text-ink-2">
              {d.label} <span className="text-micro text-ink-muted tnum">{Math.round(d.weight * 100)}%</span>
            </dt>
            <dd className="flex gap-0.5" aria-label={s === null ? 'not stated' : `${s} out of 5`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: s !== null && i <= s ? scoreTone(s) : 'var(--grid)' }} />
              ))}
            </dd>
            <dd className="text-right text-xs font-medium text-ink-2 tnum">{s === null ? '—' : `${s}/5`}</dd>
            {notes?.[d.id] ? <dd className="col-span-3 text-micro leading-snug text-ink-muted sm:col-start-2 sm:col-span-2">{notes[d.id]}</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Time and follow-ups
// ---------------------------------------------------------------------------

/** "today", "yesterday", "5d ago", "3w ago", then a date. */
export function ago(day: DayKey | null, today: DayKey): string {
  if (!day) return '';
  const d = daysBetween(day, today);
  if (d < 0) return `in ${-d}d`;
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return formatKey(day, 'd MMM yyyy');
}

export function followUpLabel(f: FollowUp): string {
  if (f.kind === 'due') return f.days === 0 ? 'Follow up today' : `Follow-up ${f.days}d overdue`;
  if (f.kind === 'stale') return `${f.days}d silent — ghosted?`;
  return `${f.days}d, no reply`;
}

export function FollowUpBadge({ followUp }: { followUp: FollowUp | null }) {
  if (!followUp) return null;
  const due = followUp.kind === 'due';
  return (
    <span
      className={cn(
        'skin-pill inline-flex items-center gap-1 px-2 py-0.5 text-micro font-medium',
        due ? 'bg-accent text-accent-ink' : 'border border-hairline bg-surface text-ink-2',
      )}
    >
      {due ? null : <Dot color={followUp.kind === 'stale' ? 'var(--critical)' : 'var(--warning)'} />}
      {followUpLabel(followUp)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/** A form's answer, announced: politely when it worked, assertively when it did not. */
export function FormMessage({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state?.message) return null;
  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={cn('flex items-start gap-1.5 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-xs', state.ok ? 'text-ink-2' : 'text-critical')}
    >
      {state.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-good-text" aria-hidden /> : <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />}
      <span>{state.message}</span>
    </p>
  );
}

export const inputClass =
  'w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted/70 hover:border-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

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
      <textarea id={name} name={name} rows={rows} defaultValue={defaultValue ?? ''} placeholder={placeholder} className={cn(inputClass, 'resize-y leading-relaxed')} />
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

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Only http(s) links are ever rendered as hrefs — a row edited by hand in Notion could hold anything. */
export const safeHref = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

const URL_IN_TEXT = /(https?:\/\/[^\s)]{1,2048})/g;

/** A link named by its site — "visa.wd5.myworkdayjobs.com" — rather than its whole path. */
function linkLabel(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, '') + (url.pathname.length > 1 ? '/…' : '');
  } catch {
    return u.slice(0, 40);
  }
}

/** Plain text with its links made clickable, and nothing else interpreted. */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_IN_TEXT);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 && safeHref(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener" title={p} className="inline-flex items-baseline gap-0.5 font-medium text-accent underline-offset-2 hover:underline">
            {linkLabel(p)}
            <ExternalLink className="size-2.5 self-center" aria-hidden />
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Steps written as "1. … 2. …" rendered as a real ordered list, bullets as a
 * list, and everything else as paragraphs. AI tools write how-to-apply steps
 * this way, and a wall of pre-wrapped text hid the order that mattered.
 */
export function RichSteps({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: { kind: 'ol' | 'ul' | 'p'; items: string[] }[] = [];
  for (const l of lines) {
    const numbered = /^(\d{1,2})[.)]\s+(.*)$/.exec(l);
    const bullet = /^[-•*]\s+(.*)$/.exec(l);
    const kind = numbered ? 'ol' : bullet ? 'ul' : 'p';
    const body = numbered ? numbered[2] : bullet ? bullet[1] : l;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind && kind !== 'p') last.items.push(body);
    else blocks.push({ kind, items: [body] });
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed text-ink-2">
      {blocks.map((b, i) =>
        b.kind === 'ol' ? (
          <ol key={i} className="space-y-2">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-micro font-semibold text-ink tnum" aria-hidden>
                  {j + 1}
                </span>
                <span className="min-w-0 pt-px">
                  <Linkified text={it} />
                </span>
              </li>
            ))}
          </ol>
        ) : b.kind === 'ul' ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>
                <Linkified text={it} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Linkified text={b.items[0]} />
          </p>
        ),
      )}
    </div>
  );
}
