import guides from '../../data/guides/index.json';
import seed from '../../data/a2z-seed.json';
import type { Task } from './notion';
export type Guide = {
  problem: string;
  assumptions: string;
  example: { input: string; output: string; explanation: string };
  baseline: string;
  approach: string;
  steps: string[];
  java: string;
  time: string;
  space: string;
  pitfalls: string[];
  tests: string[];
};
const bySource = new Map(seed.sections.flatMap(s => s.headings.flatMap(h => h.questions.map(q => [q.sourceId, String(q.globalOrder + 1)] as const))));
export function guideFor(task: Pick<Task, 'sourceId'>): Guide | null {
  const order = bySource.get(task.sourceId.replace(/^codolio:/, ''));
  return order ? (guides as Record<string, Guide>)[order] ?? null : null;
}
export const guideCoverage = { complete: Object.keys(guides).length, total: seed.totals.questions };
