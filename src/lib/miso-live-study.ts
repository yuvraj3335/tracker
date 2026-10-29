import type { Area, Task, Topic } from './notion';
import { buildSnapshot } from './companion-context';
import { guideFor } from './question-guides';

/** The full catalog stays in session memory; only relevant matches enter each prompt. */
export function liveStudy(areas: Area[], topics: Topic[], tasks: Task[], selectedId?: string) {
  const sections = new Map(topics.map(topic => [topic.id, topic.name]));
  const selected = tasks.find(task => task.id === selectedId);
  const guide = selected ? guideFor(selected) : null;
  const ordered = selected ? [selected, ...tasks.filter(task => task.id !== selected.id)] : tasks;
  let bytes = 0;
  const questions = [];
  for (const task of ordered) {
    const row = { id: task.id, title: task.name.slice(0, 160), section: task.topicIds.map(id => sections.get(id)).filter(Boolean).join(' / ').slice(0, 180), heading: task.heading.slice(0, 120), notes: task.notes.slice(0, 240), done: task.done };
    bytes += new TextEncoder().encode(JSON.stringify(row)).length;
    if (bytes > 420000) break;
    questions.push(row);
  }
  return {
    snapshot: buildSnapshot(areas, topics, tasks).slice(0, 3500),
    totalQuestions: tasks.length, truncated: questions.length < tasks.length, questions,
    selectedId: selected?.id ?? null,
    guide: guide ? JSON.stringify({ problem: guide.problem, assumptions: guide.assumptions, example: guide.example, approach: guide.approach, steps: guide.steps, time: guide.time, space: guide.space, pitfalls: guide.pitfalls, codeShortened: guide.java.length > 2800, java: guide.java.slice(0, 2800) }).slice(0, 6000) : '',
  };
}
export type LiveStudy = ReturnType<typeof liveStudy>;
