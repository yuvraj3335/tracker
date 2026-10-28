import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireReady } from '@/lib/tenant';
import { getEverything } from '@/lib/notion';
import { guideFor } from '@/lib/question-guides';
import { QuestionGuide, TalkAboutQuestion } from '@/components/question-guide';
import { PageHeader } from '@/components/page-header';
export const dynamic = 'force-dynamic';
export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireReady();
  const { areas, topics, tasks } = await getEverything(tenant);
  const task = tasks.find(t => t.id === id); if (!task) notFound();
  const area = areas.find(a => task.areaIds.includes(a.id));
  const siblings = tasks.filter(t => t.areaIds.some(a => task.areaIds.includes(a)));
  const index = siblings.findIndex(t => t.id === id);
  const guide = guideFor(task);
  const links = Object.entries(task.links).filter(([, value]) => /^https?:\/\//.test(value));
  return <div className="mx-auto max-w-3xl space-y-6 pb-28">
    <Link href={`/areas/${area?.slug || 'dsa'}`} className="text-sm text-accent">← Back to {area?.name || 'your sheet'}</Link>
    <PageHeader title={task.name} sub={`${topics.filter(t => task.topicIds.includes(t.id)).map(t => t.name).join(' · ')}${task.done ? ' · Completed' : ''}`} />
    <div className="flex flex-wrap items-center gap-3"><TalkAboutQuestion /><span className="text-xs text-ink-muted">Miso knows which question you’re reading.</span></div>
    <nav aria-label="Question sections" className="flex flex-wrap gap-4 border-y border-hairline py-3 text-xs text-accent">{['Problem', 'Example', 'Approaches', 'Java', 'Complexity', 'Pitfalls'].map(t => <a href={`#${t.toLowerCase()}`} key={t}>{t}</a>)}</nav>
    {guide ? <>{guide.reference ? <div className="text-xs leading-5 text-ink-muted"><p>Following <a className="text-accent underline" href={guide.reference.url} target="_blank" rel="noopener noreferrer">Striver’s {guide.reference.title} lesson</a>: {guide.reference.approach}.</p>{guide.reference.adaptation ? <p>{guide.reference.adaptation}</p> : null}</div> : null}<QuestionGuide guide={guide} /></> : <section className="rounded-xl border border-hairline p-5"><h2 className="font-semibold">Written explanation in preparation</h2><p className="mt-2 text-sm leading-6 text-ink-muted">This question’s checked article has not been published yet. The original problem and resources are available below, and you can discuss it with Miso.</p></section>}
    {task.notes ? <section><h2 className="mb-2 text-lg font-semibold">Your notes</h2><p className="whitespace-pre-wrap text-sm leading-7">{task.notes}</p></section> : null}
    <section className="border-t border-hairline pt-4"><h2 className="mb-2 font-semibold">Original sources</h2><p className="mb-3 text-xs text-ink-muted">These are the links already saved in your tracker. Source platforms may use different constraints or require an account.</p><div className="flex flex-wrap gap-4">{links.map(([label, url]) => <a key={label} href={url} rel="noreferrer noopener" target="_blank" className="text-sm text-accent underline">{label === 'tuf' ? 'TUF article' : label === 'resource' ? 'Learning resource' : label === 'problem' ? 'Original problem' : label}</a>)}</div></section>
    <nav aria-label="Adjacent questions" className="flex justify-between gap-4 border-t border-hairline pt-4 text-sm text-accent">{index > 0 ? <Link prefetch={false} href={`/questions/${siblings[index - 1].id}`}>← {siblings[index - 1].name}</Link> : <span />}{index + 1 < siblings.length ? <Link prefetch={false} href={`/questions/${siblings[index + 1].id}`} className="text-right">{siblings[index + 1].name} →</Link> : null}</nav>
  </div>;
}
