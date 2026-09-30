/**
 * The full evaluation as a Notion page, and back again. No I/O.
 *
 * The report is a page of its own, a child of the job's page. It reads like a
 * document in Notion, and a re-evaluation replaces it whole — one trash and one
 * create — instead of deleting forty blocks one at a time. The judgment itself
 * (verdict, match, scores, flags) lives in the job's properties, where lists,
 * filters and Notion views can see it; this page carries the reasoning.
 */
import {
  DIMENSIONS,
  REQUIREMENT_MATCHES,
  REQUIREMENT_WEIGHTS,
  type Requirement,
  type RequirementMatch,
  type RequirementWeight,
} from './evaluation';
import { textRuns, type DimensionId, type DimensionScores } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EvaluationReport = {
  summary: string;
  /** "Rubric v1 · Full evaluation · 2026-09-30 · by Claude Code" */
  byline: string;
  scores: DimensionScores;
  notes: Partial<Record<DimensionId, string>>;
  requirements: Requirement[];
  levelStrategy: string;
  payNotes: string[];
  legitimacySignals: string[];
  resumeEdits: string[];
  keywords: string[];
  posting: string;
};

export const REPORT_SECTIONS = {
  scores: 'Scores',
  requirements: 'Requirements',
  strategy: 'Level and strategy',
  pay: 'Pay',
  legitimacy: 'Legitimacy',
  edits: 'Resume edits',
  keywords: 'Keywords',
  posting: 'The posting',
} as const;

/** Notion takes at most 100 blocks in one create. */
const MAX_BLOCKS = 100;
/** Short paragraphs are packed into blocks of about this size. */
const CHUNK = 1800;
/** Says the posting was cut, in a form parseReport knows is not part of it. */
export const CUT_NOTE = '[The rest of the posting did not fit on one Notion page.]';

const runs = (s: string) => textRuns(s).map((content) => ({ type: 'text' as const, text: { content } }));
const block = (type: string, text: string) => ({ object: 'block', type, [type]: { rich_text: runs(text) } });
const h2 = (text: string) => block('heading_2', text);
const para = (text: string) => block('paragraph', text);
const bullet = (text: string) => block('bulleted_list_item', text);
const numbered = (text: string) => block('numbered_list_item', text);

function table(header: string[], rows: string[][]) {
  const row = (cells: string[]) => ({ object: 'block', type: 'table_row', table_row: { cells: cells.map((c) => runs(c)) } });
  return {
    object: 'block',
    type: 'table',
    table: { table_width: header.length, has_column_header: true, has_row_header: false, children: [row(header), ...rows.map(row)] },
  };
}

/**
 * Packs paragraphs into blocks: short ones share a block up to `size`
 * characters, and a long one keeps a block to itself, whole. A paragraph is
 * never cut — a block's text is split into Notion's 2,000-character runs when
 * written and joined back with nothing between them when read, so the posting
 * comes back exactly as it went in.
 */
export function chunkText(text: string, size = CHUNK): string[] {
  const out: string[] = [];
  let cur = '';
  for (const p of text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    if (cur && cur.length + 2 + p.length > size) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

const scoreLine = (label: string, s: number | null, note?: string) =>
  `${label} ${s === null ? 'not stated' : `${s}/5`}${note ? ` — ${note}` : ''}`;

/** The report's blocks, in reading order. Empty sections are left out, heading and all. */
export function reportBlocks(r: EvaluationReport): any[] {
  const out: any[] = [];
  if (r.summary) out.push(para(r.summary));
  if (r.byline) out.push(para(r.byline));

  out.push(h2(REPORT_SECTIONS.scores));
  for (const d of DIMENSIONS) out.push(bullet(scoreLine(d.label, r.scores[d.id], r.notes[d.id])));

  if (r.requirements.length) {
    out.push(h2(REPORT_SECTIONS.requirements));
    out.push(table(['Requirement', 'Weight', 'Match', 'Evidence'], r.requirements.map((q) => [q.requirement, q.weight, q.match, q.evidence])));
  }
  if (r.levelStrategy) {
    out.push(h2(REPORT_SECTIONS.strategy));
    for (const p of chunkText(r.levelStrategy).slice(0, 3)) out.push(para(p));
  }
  const lists: [string, string[], (t: string) => any][] = [
    [REPORT_SECTIONS.pay, r.payNotes, bullet],
    [REPORT_SECTIONS.legitimacy, r.legitimacySignals, bullet],
    [REPORT_SECTIONS.edits, r.resumeEdits, numbered],
  ];
  for (const [title, items, make] of lists) {
    if (!items.length) continue;
    out.push(h2(title));
    for (const i of items) out.push(make(i));
  }
  if (r.keywords.length) {
    out.push(h2(REPORT_SECTIONS.keywords));
    out.push(para(r.keywords.join(', ')));
  }
  if (r.posting) {
    const room = MAX_BLOCKS - out.length - 2;
    const chunks = chunkText(r.posting);
    if (room > 0) {
      out.push(h2(REPORT_SECTIONS.posting));
      for (const c of chunks.slice(0, room)) out.push(para(c));
      if (chunks.length > room) out.push(para(CUT_NOTE));
    }
  }
  return out.slice(0, MAX_BLOCKS);
}

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

const plain = (rich: any[] | undefined): string => (rich ?? []).map((t: any) => t?.plain_text ?? t?.text?.content ?? '').join('');
const blockText = (b: any): string => plain(b?.[b?.type]?.rich_text).trim();

const SECTION_BY_TITLE = new Map(Object.entries(REPORT_SECTIONS).map(([k, v]) => [v.toLowerCase(), k as keyof typeof REPORT_SECTIONS]));

const SCORE_LINE = new RegExp(
  `^(${DIMENSIONS.map((d) => d.label).join('|')})\\s+(?:([1-5])\\/5|not stated)(?:\\s+—\\s+([\\s\\S]*))?$`,
  'i',
);

/** The byline's whole shape, so a summary that happens to start "Rubric v1" stays a summary. */
const BYLINE = /^Rubric v\d+ · (Full evaluation|Quick look) · \d{4}-\d{2}-\d{2}\b/;

const pick = <T extends string>(values: readonly T[], raw: string, fallback: T): T =>
  values.find((v) => v.toLowerCase() === raw.trim().toLowerCase()) ?? fallback;

export const EMPTY_REPORT: EvaluationReport = {
  summary: '',
  byline: '',
  scores: { skills: null, level: null, location: null, pay: null, role: null },
  notes: {},
  requirements: [],
  levelStrategy: '',
  payNotes: [],
  legitimacySignals: [],
  resumeEdits: [],
  keywords: [],
  posting: '',
};

/**
 * Reads a report page's blocks. `rowsOf` gives a table block's rows, which
 * Notion returns as the table's own children rather than inline.
 *
 * Forgiving on purpose: the page is a normal Notion page, and someone may have
 * edited it. A section it does not recognise is ignored, not fatal.
 */
export function parseReport(blocks: readonly any[], rowsOf: (tableId: string) => readonly any[] | undefined): EvaluationReport {
  const r: EvaluationReport = { ...EMPTY_REPORT, scores: { ...EMPTY_REPORT.scores }, notes: {}, requirements: [], payNotes: [], legitimacySignals: [], resumeEdits: [], keywords: [] };
  const strategy: string[] = [];
  const posting: string[] = [];
  let section: keyof typeof REPORT_SECTIONS | null = null;
  let seenHeading = false;

  for (const b of blocks) {
    const type = b?.type;
    if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      seenHeading = true;
      section = SECTION_BY_TITLE.get(blockText(b).toLowerCase()) ?? null;
      continue;
    }
    if (type === 'table') {
      if (section !== 'requirements') continue;
      const rows = rowsOf(b.id) ?? [];
      for (const row of rows.slice(b?.table?.has_column_header === false ? 0 : 1)) {
        const cells: string[] = (row?.table_row?.cells ?? []).map((c: any[]) => plain(c).trim());
        if (!cells[0]) continue;
        r.requirements.push({
          requirement: cells[0],
          weight: pick<RequirementWeight>(REQUIREMENT_WEIGHTS, cells[1] ?? '', 'Core'),
          match: pick<RequirementMatch>(REQUIREMENT_MATCHES, cells[2] ?? '', 'Partial'),
          evidence: cells[3] ?? '',
        });
      }
      continue;
    }
    const text = blockText(b);
    if (!text) continue;
    if (!seenHeading) {
      if (BYLINE.test(text)) r.byline = text;
      else if (!r.summary) r.summary = text;
      continue;
    }
    switch (section) {
      case 'scores': {
        const m = SCORE_LINE.exec(text);
        const d = m && DIMENSIONS.find((x) => x.label.toLowerCase() === m[1].toLowerCase());
        if (m && d) {
          r.scores[d.id] = m[2] ? Number(m[2]) : null;
          if (m[3]) r.notes[d.id] = m[3].trim();
        }
        break;
      }
      case 'strategy':
        strategy.push(text);
        break;
      case 'pay':
        r.payNotes.push(text);
        break;
      case 'legitimacy':
        r.legitimacySignals.push(text);
        break;
      case 'edits':
        r.resumeEdits.push(text);
        break;
      case 'keywords':
        r.keywords.push(...text.split(/,\s*/).map((k) => k.trim()).filter(Boolean));
        break;
      case 'posting':
        if (text !== CUT_NOTE) posting.push(text);
        break;
      default:
        break;
    }
  }
  r.levelStrategy = strategy.join('\n\n');
  r.posting = posting.join('\n\n');
  return r;
}
