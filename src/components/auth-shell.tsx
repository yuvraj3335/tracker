import Link from 'next/link';
import { SkinPicker } from './skin-picker';

/** Shared frame for the sign-in and sign-up screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-xs font-semibold text-accent-ink">
          JS
        </span>
        <span className="text-sm font-semibold tracking-tight">Job Switch Tracker</span>
        {/* The nav is hidden on these screens, and setup takes a few minutes —
            so the theme picker has to be reachable here too. */}
        <span className="ml-auto">
          <SkinPicker />
        </span>
      </div>

      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}

      <div className="mt-5">{children}</div>

      {footer ? <div className="mt-5 text-sm text-ink-muted">{footer}</div> : null}
    </div>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  autoComplete,
  autoFocus,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-xs font-medium text-ink-2">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      {hint ? <p className="mt-1 text-[11px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-xs text-critical"
    >
      {message}
    </p>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
