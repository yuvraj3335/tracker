/**
 * Central env access. Everything is read lazily so that `next build` succeeds
 * on a machine without secrets (pages that need Notion degrade to a setup
 * notice rather than crashing the build).
 */
function opt(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  get notionToken() { return opt('NOTION_TOKEN'); },
  get areasDs() { return opt('NOTION_AREAS_DS'); },
  get topicsDs() { return opt('NOTION_TOPICS_DS'); },
  get tasksDs() { return opt('NOTION_TASKS_DS'); },
  get dailyDs() { return opt('NOTION_DAILY_DS'); },
  get appPassword() { return opt('APP_PASSWORD'); },
  /** IANA zone that defines when "a day" starts and ends for streaks + heatmap. */
  get timezone() { return opt('APP_TIMEZONE') ?? 'Asia/Kolkata'; },
};

/** True when the Notion side is wired up enough to read data. */
export function isConfigured() {
  if (process.env.DEMO_MODE === '1') return true;
  return Boolean(env.notionToken && env.tasksDs && env.areasDs && env.topicsDs);
}

export function missingEnv(): string[] {
  const need: Array<[string, string | undefined]> = [
    ['NOTION_TOKEN', env.notionToken],
    ['NOTION_AREAS_DS', env.areasDs],
    ['NOTION_TOPICS_DS', env.topicsDs],
    ['NOTION_TASKS_DS', env.tasksDs],
  ];
  return need.filter(([, v]) => !v).map(([k]) => k);
}
