'use client';
import { useState } from 'react';
import { MessageCircle, Copy } from 'lucide-react';
import type { Guide } from '@/lib/question-guides';
export function TalkAboutQuestion() {
  return <button onClick={() => window.dispatchEvent(new Event('miso:talk'))} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink"><MessageCircle size={16} />Talk about this with Miso</button>;
}
export function QuestionGuide({ guide }: { guide: Guide }) {
  const [copy, setCopy] = useState('Copy Java');
  return <article className="space-y-6 text-sm leading-7">
    <section id="problem"><h2 className="mb-2 text-lg font-semibold">Problem</h2><p>{guide.problem}</p><p className="mt-2 text-xs text-ink-muted">Variant covered: {guide.assumptions}</p></section>
    <section id="example" className="rounded-xl border border-hairline bg-surface-2 p-4"><h2 className="font-semibold">Worked example</h2><p><strong>Input: </strong><code>{guide.example.input}</code></p><p><strong>Output: </strong><code>{guide.example.output}</code></p><p>{guide.example.explanation}</p></section>
    <section id="approaches"><h2 className="mb-2 text-lg font-semibold">Approaches</h2><h3 className="font-semibold">Starting point</h3><p>{guide.baseline}</p><h3 className="mt-4 font-semibold">The key idea</h3><p>{guide.approach}</p><ol className="mt-3 list-decimal space-y-2 pl-6">{guide.steps.map((step, i) => <li key={i}>{step}</li>)}</ol></section>
    <section id="java"><div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">Java implementation</h2><button className="inline-flex items-center gap-1 text-xs text-accent" onClick={async () => { try { await navigator.clipboard.writeText(guide.java); setCopy('Copied'); } catch { setCopy('Select code to copy'); } }}><Copy size={13} />{copy}</button></div><pre className="overflow-x-auto rounded-xl border border-hairline bg-surface-2 p-4 text-xs leading-6"><code>{guide.java}</code></pre><p className="mt-2 text-xs text-ink-muted">Methods belong inside a Java class. Collection examples use java.util.*. Adapt the signature to your practice platform.</p></section>
    <section id="complexity"><h2 className="mb-2 text-lg font-semibold">Complexity</h2><p><strong>Time: </strong>{guide.time}</p><p><strong>Extra space: </strong>{guide.space}</p></section>
    <section id="pitfalls"><h2 className="mb-2 text-lg font-semibold">Edge cases and common mistakes</h2><ul className="list-disc space-y-2 pl-5">{guide.pitfalls.map((p, i) => <li key={i}>{p}</li>)}</ul></section>
  </article>;
}
