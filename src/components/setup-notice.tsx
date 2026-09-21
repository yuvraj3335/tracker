import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

/** Shown instead of a crash when the Notion side is not wired up yet. */
export function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Not connected to Notion yet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-ink-2">
        <p>
          These environment variables are missing:{' '}
          {missing.map((m) => (
            <code key={m} className="mx-0.5 rounded bg-surface-2 px-1 py-0.5 text-xs">
              {m}
            </code>
          ))}
        </p>
        <ol className="list-decimal space-y-1.5 pl-5 text-ink-muted">
          <li>
            Create an internal integration at{' '}
            <a
              className="text-accent underline underline-offset-2"
              href="https://www.notion.so/my-integrations"
              target="_blank"
              rel="noreferrer noopener"
            >
              notion.so/my-integrations
            </a>{' '}
            and copy the secret into <code>.env.local</code> as <code>NOTION_TOKEN</code>.
          </li>
          <li>
            Make a blank Notion page, then <strong>… → Connections</strong> and add the
            integration.
          </li>
          <li>
            Run <code className="rounded bg-surface-2 px-1">npx tsx scripts/seed-notion.ts --parent &lt;page-url&gt;</code>
          </li>
          <li>Restart the dev server, or redeploy with the same vars set on Vercel.</li>
        </ol>
      </CardContent>
    </Card>
  );
}
