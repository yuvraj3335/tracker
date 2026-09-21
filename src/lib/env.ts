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
