/**
 * Server configuration.
 *
 * Notion credentials are deliberately absent: they are per-user now, stored
 * encrypted in Postgres and resolved through `tenant.ts`. Nothing here is
 * user-specific.
 */
function opt(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  /** IANA zone that defines when "a day" starts and ends for streaks + heatmap. */
  get timezone() {
    return opt('APP_TIMEZONE') ?? 'Asia/Kolkata';
  },
};

/** Everything the server needs before it can host accounts. */
export function missingServerConfig(): string[] {
  const needed: Array<[string, string | undefined]> = [
    ['DATABASE_URL', opt('DATABASE_URL')],
    ['SESSION_SECRET', opt('SESSION_SECRET')],
    ['ENCRYPTION_KEY', opt('ENCRYPTION_KEY')],
  ];
  return needed.filter(([, v]) => !v).map(([k]) => k);
}
