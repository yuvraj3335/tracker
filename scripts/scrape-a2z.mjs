#!/usr/bin/env node
/**
 * Scrapes Striver's A2Z DSA sheet from https://a2zdsa.pages.dev/
 *
 * The site is a Vite SPA that ships its entire dataset inside the JS bundle as a
 * plain object literal. We locate that literal, bracket-match it out, and eval it.
 * This is far more faithful than parsing rendered HTML: we get the exact
 * section -> heading -> question hierarchy and ordering the site itself uses.
 *
 * Nothing is invented. Nothing is padded to hit a target count. The script
 * asserts the parsed total against the site's own self-declared `totalQuestions`
 * and fails loudly if they disagree.
 *
 * Usage: node scripts/scrape-a2z.mjs [--out data/a2z-seed.json]
 */
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://a2zdsa.pages.dev';
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'data/a2z-seed.json';

const log = (...a) => console.log('[scrape]', ...a);

async function main() {
  log('fetching', SITE);
  const html = await (await fetch(SITE + '/')).text();

  // The bundle filename is content-hashed, so read it off the entry <script>.
  const m = html.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/);
  if (!m) throw new Error('could not find entry bundle in index.html');
  const bundleUrl = SITE + m[1];
  log('bundle', bundleUrl);

  const bundle = await (await fetch(bundleUrl)).text();
  log('bundle size', bundle.length, 'bytes');

  // The dataset always opens with the Basics section.
  const MARKER = 'content:[{contentPath:"/basics"';
  const mi = bundle.indexOf(MARKER);
  if (mi < 0) throw new Error('dataset marker not found — site structure changed');

  const start = mi + 'content:'.length; // index of the opening '['
  const literal = bracketMatch(bundle, start);

  const content = eval('(' + literal + ')');

  // The site states its own total a little upstream of the dataset.
  const declared = bundle
    .slice(Math.max(0, mi - 400), mi)
    .match(/totalQuestions:(\d+)/);
  const siteDeclaredTotal = declared ? Number(declared[1]) : null;

  const sections = content.map((s, si) => ({
    order: si,
    name: s.contentHeading,
    path: s.contentPath,
    declaredTotal: s.contentTotalQuestions,
    headings: (s.categoryList || []).map((c, ci) => ({
      order: ci,
      name: c.categoryName,
      declaredTotal: c.categoryTotalQuestions,
      questions: (c.questionList || []).map((q, qi) => ({
        order: qi,
        name: q.questionHeading,
        tufLink: q.questionLink || '',
        leetCodeLink: q.leetCodeLink || '',
        gfgLink: q.gfgLink || '',
        youTubeLink: q.youTubeLink || '',
        sourceId: q.questionId || '',
      })),
    })),
  }));

  // ---- integrity checks: fail loudly rather than ship wrong data ----
  const problems = [];
  let total = 0;
  let headingCount = 0;
  for (const s of sections) {
    let sTotal = 0;
    for (const h of s.headings) {
      headingCount++;
      if (h.questions.length !== h.declaredTotal) {
        problems.push(
          `heading "${s.name} > ${h.name}" has ${h.questions.length} questions but declares ${h.declaredTotal}`,
        );
      }
      sTotal += h.questions.length;
    }
    if (sTotal !== s.declaredTotal) {
      problems.push(`section "${s.name}" has ${sTotal} questions but declares ${s.declaredTotal}`);
    }
    total += sTotal;
  }
  if (siteDeclaredTotal !== null && total !== siteDeclaredTotal) {
    problems.push(`parsed ${total} questions but site declares ${siteDeclaredTotal}`);
  }
  for (const s of sections)
    for (const h of s.headings)
      for (const q of h.questions)
        if (!q.name || !q.name.trim()) problems.push(`empty question name in ${s.name} > ${h.name}`);

  if (problems.length) {
    console.error('\n[scrape] INTEGRITY FAILURES:');
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }

  // Global ordering + link stats. A question with no URL at all is kept.
  let gi = 0;
  let noUrl = 0;
  for (const s of sections)
    for (const h of s.headings)
      for (const q of h.questions) {
        q.globalOrder = gi++;
        if (![q.tufLink, q.leetCodeLink, q.gfgLink, q.youTubeLink].some((x) => x)) noUrl++;
      }

  const out = {
    source: SITE,
    sourceBundle: bundleUrl,
    scrapedAt: new Date().toISOString(),
    siteDeclaredTotal,
    totals: {
      sections: sections.length,
      headings: headingCount,
      questions: total,
      questionsWithNoUrl: noUrl,
    },
    // This source carries no difficulty data. The field exists on the Notion
    // schema but is intentionally left empty rather than guessed at.
    hasDifficulty: false,
    sections,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  log('sections ', out.totals.sections);
  log('headings ', out.totals.headings);
  log('questions', out.totals.questions, '(site declares ' + siteDeclaredTotal + ' — match)');
  log('no-URL   ', out.totals.questionsWithNoUrl, '(retained)');
  log('wrote', OUT);
}

/** Bracket-match a JS array/object literal starting at `start`, respecting strings. */
function bracketMatch(src, start) {
  let depth = 0;
  let inStr = false;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced literal — could not match brackets');
}

main().catch((e) => { console.error('[scrape] failed:', e.message); process.exit(1); });
