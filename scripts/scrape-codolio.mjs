#!/usr/bin/env node
/** Freeze the public Codolio Striver A2Z sheet for provisioning and migration. */
import fs from 'node:fs';
import path from 'node:path';

const PAGE = 'https://codolio.com/question-tracker/sheet/strivers-a2z-dsa-sheet';
const API = 'https://node.codolio.com/api/question-tracker/v2/sheet/get-sheet-data-by-slug/strivers-a2z-dsa-sheet';
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'data/a2z-seed.json';
const LEGACY = JSON.parse(fs.readFileSync(new URL('../data/a2z-legacy-seed.json', import.meta.url), 'utf8'));
const EXPECTED = { questions: 455, sections: 18, headings: 61 };

function link(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

async function main() {
  let cursor = '';
  let sheet;
  const mappings = [];
  for (let page = 0; page < 12; page++) {
    const url = new URL(API);
    url.searchParams.set('limit', '50');
    if (cursor) url.searchParams.set('after', cursor);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = await response.json();
    if (!response.ok || body.status?.success !== true) {
      throw new Error(`Codolio returned ${response.status}: ${body.status?.message ?? 'unknown error'}`);
    }
    sheet ??= body.data.sheet;
    mappings.push(...body.data.mappings);
    cursor = body.data.pagination?.nextCursor ?? '';
    if (!body.data.pagination?.hasNextPage) break;
    if (!cursor) throw new Error('Codolio says more pages exist but gave no cursor');
  }

  const topicOrder = sheet?.config?.topicOrder;
  const subTopicOrder = sheet?.config?.subTopicOrder;
  const questionOrder = sheet?.config?.questionOrder;
  if (!Array.isArray(topicOrder) || !subTopicOrder || !Array.isArray(questionOrder)) {
    throw new Error('Codolio did not return the sheet order');
  }
  if (mappings.length !== EXPECTED.questions || topicOrder.length !== EXPECTED.sections) {
    throw new Error(`Codolio changed: ${mappings.length} questions and ${topicOrder.length} sections`);
  }

  const byId = new Map(mappings.map((row) => [row._id, row]));
  if (byId.size !== mappings.length) throw new Error('Duplicate Codolio mapping ids');
  const missingIds = questionOrder.filter((id) => !byId.has(id));
  if (missingIds.length !== 1 || missingIds[0] !== '68cdd0a875f6e73b0375db6e') {
    throw new Error(`Codolio's saved order changed: ${JSON.stringify(missingIds)}`);
  }
  const ordered = questionOrder.filter((id) => byId.has(id)).map((id) => byId.get(id));
  if (ordered.length !== mappings.length || new Set(ordered).size !== mappings.length) {
    throw new Error('Question order does not cover the 455 public records exactly once');
  }

  let globalOrder = 0;
  const sections = topicOrder.map((name, sectionOrder) => {
    const headingNames = subTopicOrder[name];
    if (!Array.isArray(headingNames)) throw new Error(`No lessons for ${name}`);
    const headings = headingNames.map((headingName, headingOrder) => {
      const questions = ordered.filter((row) => row.topic === name && row.subTopic === headingName)
        .map((row, order) => {
          const title = row.title || row.questionId?.name;
          const difficulty = row.questionId?.difficulty;
          if (!title?.trim() || !['Basic', 'Easy', 'Medium', 'Hard'].includes(difficulty)) {
            throw new Error(`Invalid title or difficulty on ${row._id}`);
          }
          return {
            order,
            name: title.trim(),
            problemLink: link(row.questionId?.problemUrl),
            resourceLink: link(row.resource),
            difficulty,
            sourceId: row._id,
            globalOrder: globalOrder++,
          };
        });
      return { order: headingOrder, name: headingName, declaredTotal: questions.length, questions };
    });
    return {
      order: sectionOrder,
      name,
      // Internal paths remain stable for users whose 18 Topic pages already exist.
      path: LEGACY.sections[sectionOrder].path,
      declaredTotal: headings.reduce((sum, h) => sum + h.questions.length, 0),
      headings,
    };
  });

  if (globalOrder !== EXPECTED.questions ||
      sections.reduce((sum, s) => sum + s.headings.length, 0) !== EXPECTED.headings ||
      ordered.some((row) => !topicOrder.includes(row.topic) || !subTopicOrder[row.topic].includes(row.subTopic))) {
    throw new Error('Codolio rows do not match the 18 steps and 61 lessons');
  }

  const out = {
    source: PAGE,
    sourceApi: API,
    sheetId: sheet._id,
    scrapedAt: new Date().toISOString(),
    siteDeclaredTotal: EXPECTED.questions,
    totals: {
      sections: sections.length,
      headings: EXPECTED.headings,
      questions: globalOrder,
      questionsWithNoUrl: sections.flatMap((s) => s.headings.flatMap((h) => h.questions))
        .filter((q) => !q.problemLink && !q.resourceLink).length,
    },
    hasDifficulty: true,
    staleOrderId: missingIds[0],
    sections,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`[codolio] ${out.totals.sections} sections, ${out.totals.headings} lessons, ${out.totals.questions} questions`);
  console.log(`[codolio] ${out.totals.questionsWithNoUrl} rows without a usable link; skipped stale order id ${missingIds[0]}`);
  console.log(`[codolio] wrote ${OUT}`);
}

main().catch((error) => { console.error(`[codolio] ${error.message}`); process.exitCode = 1; });
