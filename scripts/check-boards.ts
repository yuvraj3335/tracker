/**
 * Live check of every job board, end to end, against Crawl4AI on this machine:
 * plan the pages, crawl them exactly as the connector does, and read them.
 *
 *   npm run check:boards -- "Software Engineer" Bengaluru
 *
 * It spends nothing and writes nothing — it is how you find out a board has
 * redesigned before a search quietly starts returning fewer jobs.
 */
import { planBoardSearch, parseCrawl, type CrawledPage, type PagePlan } from '../src/lib/job-search';
// The connector's own crawl, so this measures the code path searches use.
import { crawl, crawlerHealth, pool } from '../connector/job-hunt.mjs';

async function main() {
  const role = process.argv[2] ?? 'Software Engineer';
  const location = process.argv[3] ?? 'Bengaluru';
  const health = await crawlerHealth();
  if (!health.ok) {
    console.error('Crawl4AI is not reachable on this machine. Start Docker Desktop and run: docker start crawl4ai');
    process.exit(1);
  }
  console.log(`Crawl4AI ${health.version} — searching "${role}" in ${location}\n`);
  const pages = planBoardSearch({ role, location, postedWithinDays: 14, minYears: 0 });
  const started = Date.now();
  const crawled: CrawledPage[] = await pool(pages, 3, (p: PagePlan) => crawl(p));
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const { listings, boards } = parseCrawl(crawled, { seniority: 'any', postedWithinDays: 14, location }, []);
  for (const b of boards) {
    const page = crawled.find((c) => c.board === b.board);
    console.log(`${b.status.padEnd(8)} ${b.board.padEnd(10)} ${String(b.found).padStart(3)} jobs  (cards ${page?.items?.length ?? '-'}, md ${page?.markdown?.length ?? 0})${b.note ? '  — ' + b.note : ''}`);
  }
  console.log(`\n${listings.length} listings in ${secs}s. A few:`);
  for (const l of listings.filter((_, i) => i % Math.max(1, Math.floor(listings.length / 12)) === 0).slice(0, 12)) {
    console.log(`  [${l.source}] ${l.role} — ${l.company || '?'} · ${l.location || '?'} · exp ${l.experience || '?'} · ${l.salary || 'no salary'} · posted ${l.postedOn ?? '?'} · ${l.seniority}\n     ${l.url}`);
  }
  if (boards.some((b) => b.status !== 'ok')) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
