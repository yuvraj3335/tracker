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

type Env = Record<string, string | undefined>;

/**
 * The Postgres connection string, from whichever variable holds it.
 *
 * `DATABASE_URL` is the documented name and always wins. But Vercel's Neon
 * integration names its variables after the prefix picked when the store is
 * connected to the project: prefix `STORAGE` gives `STORAGE_DATABASE_URL`, and
 * prefix `DATABASE_URL` gives `DATABASE_URL_DATABASE_URL` — with no plain
 * `DATABASE_URL` at all. That is how production came to report "no database"
 * while a working store sat attached to it.
 *
 * So after the two unprefixed names, any `<PREFIX>_DATABASE_URL` or
 * `<PREFIX>_POSTGRES_URL` is accepted. Keys are sorted so the choice is stable
 * if more than one store is attached. The pooled URL is preferred; the
 * `_UNPOOLED` / `_NON_POOLING` / `_NO_SSL` / `_PRISMA_URL` variants never match.
 */
export function resolveDatabaseUrl(source: Env = process.env): string | undefined {
  const get = (key: string) => {
    const v = source[key];
    return v && v.trim() ? v.trim() : undefined;
  };

  const direct = get('DATABASE_URL') ?? get('POSTGRES_URL');
  if (direct) return direct;

  const keys = Object.keys(source).sort();
  for (const suffix of ['_DATABASE_URL', '_POSTGRES_URL']) {
    for (const key of keys) {
      if (key.length > suffix.length && key.endsWith(suffix)) {
        const v = get(key);
        if (v) return v;
      }
    }
  }
  return undefined;
}

export const env = {
  /** Postgres connection string; see resolveDatabaseUrl for where it comes from. */
  get databaseUrl() {
    return resolveDatabaseUrl();
  },

  /** IANA zone that defines when "a day" starts and ends for streaks + heatmap. */
  get timezone() {
    return opt('APP_TIMEZONE') ?? 'Asia/Kolkata';
  },
};
