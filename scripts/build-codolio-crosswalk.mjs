#!/usr/bin/env node
/** A reviewed, one-to-one migration map from the old 456 rows to Codolio. */
import fs from 'node:fs';

const old = JSON.parse(fs.readFileSync(new URL('../data/a2z-legacy-seed.json', import.meta.url), 'utf8'));
const next = JSON.parse(fs.readFileSync(new URL('../data/a2z-seed.json', import.meta.url), 'utf8'));
const oldRows = old.sections.flatMap((section, sectionOrder) => section.headings.flatMap((heading) =>
  heading.questions.map((question) => ({
    ...question,
    sectionOrder,
    key: `${section.path}|${heading.order}|${question.order}|${question.sourceId}`,
  }))));
const newRows = next.sections.flatMap((section, sectionOrder) => section.headings.flatMap((heading) =>
  heading.questions.map((question) => ({ ...question, sectionOrder }))));
const normal = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const urlKey = (value) => {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.toLowerCase().replace(/\/$/, '')}`;
  } catch {
    return '';
  }
};
const oldLinks = (q) => [q.tufLink, q.leetCodeLink, q.gfgLink, q.youTubeLink].map(urlKey).filter(Boolean);
const newLinks = (q) => [q.problemLink, q.resourceLink].map(urlKey).filter(Boolean);

const usedOld = new Set();
const usedNew = new Set();
const primary = new Map();
const aliases = new Map();
function pass(predicate) {
  for (const newer of newRows) {
    if (usedNew.has(newer.globalOrder)) continue;
    const candidates = oldRows.filter((older) => !usedOld.has(older.globalOrder) && predicate(newer, older));
    if (candidates.length !== 1) continue;
    const older = candidates[0];
    if (newRows.filter((row) => !usedNew.has(row.globalOrder) && predicate(row, older)).length !== 1) continue;
    primary.set(newer.sourceId, older.key);
    usedNew.add(newer.globalOrder);
    usedOld.add(older.globalOrder);
  }
}

pass((n, o) => n.sectionOrder === o.sectionOrder && normal(n.name) === normal(o.name));
pass((n, o) => newLinks(n).some((url) => oldLinks(o).includes(url)));
pass((n, o) => normal(n.name) === normal(o.name));

// Same exercise under changed wording or links. Each pair was checked against
// the old and Codolio rows in its section, not inferred from its shifted index.
const manualPrimary = [
  [7, 7],     // Functions
  [17, 17],   // Print all Divisors
  [25, 25],   // Reverse an array
  [28, 29],   // Counting frequencies
  [45, 46],   // Union of sorted arrays
  [48, 65],   // Count subarrays with sum (same LeetCode problem)
  [128, 129], // Search linked list
  [225, 225], // Stock Span in the implementation lesson
  [261, 260], // Minimum coins
];
for (const [oldIndex, newIndex] of manualPrimary) {
  const older = oldRows[oldIndex], newer = newRows[newIndex];
  if (!older || !newer || usedOld.has(oldIndex) || usedNew.has(newIndex)) {
    throw new Error(`Manual primary match is no longer valid: ${oldIndex} → ${newIndex}`);
  }
  primary.set(newer.sourceId, older.key);
  usedOld.add(oldIndex);
  usedNew.add(newIndex);
}

// These old rows repeat a problem already represented in Codolio. Keep the
// duplicate Notion page as legacy, and merge its completion into the active row.
const duplicateAliases = [
  [49, 47],   // Missing Number
  [51, 106],  // Search in a 2D matrix
  [82, 40],   // Array sorted check
  [90, 104],  // Kth element of sorted arrays
  [101, 103], // Median of sorted arrays
  [218, 225], // Stock Span, earlier lesson
  [227, 337], // Rotten Oranges, also in Graphs
];
for (const [oldIndex, newIndex] of duplicateAliases) {
  const older = oldRows[oldIndex], newer = newRows[newIndex];
  if (!older || !newer || usedOld.has(oldIndex) || !usedNew.has(newIndex)) {
    throw new Error(`Duplicate alias is no longer valid: ${oldIndex} → ${newIndex}`);
  }
  aliases.set(newer.sourceId, [...(aliases.get(newer.sourceId) ?? []), older.key]);
  usedOld.add(oldIndex);
}

const oldOnly = oldRows.filter((row) => !usedOld.has(row.globalOrder));
const newOnly = newRows.filter((row) => !usedNew.has(row.globalOrder));
if (primary.size !== 448 || oldOnly.length !== 1 || oldOnly[0].globalOrder !== 402 ||
    newOnly.length !== 7 || [...aliases.values()].flat().length !== 7) {
  throw new Error(`Crosswalk changed: ${primary.size} matches, ${oldOnly.length} old-only, ${newOnly.length} new-only`);
}
const out = {
  source: 'a2zdsa.pages.dev → codolio.com/question-tracker/sheet/strivers-a2z-dsa-sheet',
  primaryMatches: primary.size,
  duplicateAliases: [...aliases.values()].flat().length,
  newQuestions: newOnly.map((row) => row.sourceId),
  legacyQuestions: oldOnly.map((row) => row.key),
  byCodolioId: Object.fromEntries(newRows.map((row) => [row.sourceId, {
    primaryLegacyKey: primary.get(row.sourceId) ?? null,
    duplicateLegacyKeys: aliases.get(row.sourceId) ?? [],
  }])),
};
fs.writeFileSync(new URL('../data/a2z-crosswalk.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`[crosswalk] ${primary.size} matched, ${out.duplicateAliases} duplicate aliases, ${newOnly.length} new, ${oldOnly.length} legacy`);
