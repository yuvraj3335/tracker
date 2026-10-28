import { currentUser, tenantStatus } from '@/lib/tenant';
import { getEverything } from '@/lib/notion';
import { buildSnapshot } from '@/lib/companion-context';
import { sanitiseHistory } from '@/lib/companion-prompt';
import { guideFor } from '@/lib/question-guides';
import { composeMisoContext, publicSearchQuery, questionContext, withPublicLookup } from '@/lib/miso-context';
import { searchReferences } from '@/lib/tutor-search';
import { boundedJSON, cloudRequest, cloudFailure, CloudError, sameOrigin } from '@/lib/cloud-ai';
import { createRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;
const take = createRateLimiter(40, 5 * 60000);
const referenceCache = new Map<string, { until: number; value: Awaited<ReturnType<typeof searchReferences>> }>();

export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new CloudError('Sign in to talk with Miso.', 401);
    if (!sameOrigin(req)) throw new CloudError('Open Miso inside your tracker.', 403);
    if (!take(user.id).allowed) throw new CloudError('Please give Miso a moment before asking again.', 429);
    const input = await boundedJSON(req) as Record<string, unknown> | null;
    if (!input || Object.keys(input).some(k => !['messages', 'questionId'].includes(k)) || (input.questionId !== undefined && (typeof input.questionId !== 'string' || input.questionId.length > 80))) throw new CloudError('Invalid conversation.', 400);
    const messages = sanitiseHistory(input.messages);
    if (!messages) throw new CloudError('Please send a message to Miso.', 400);
    let context = 'Tracker unavailable. Never guess progress or claim to see their questions.';
    try {
      const status = await tenantStatus();
      if (status.kind === 'ready') {
        const { areas, topics, tasks } = await getEverything(status.tenant);
        const selectedId = typeof input.questionId === 'string' ? input.questionId : undefined;
        if (selectedId && !tasks.some(t => t.id === selectedId)) throw new CloudError('That question is not in your tracker.', 404);
        const task = tasks.find(t => t.id === selectedId);
        const guide = task ? guideFor(task) : null;
        context = composeMisoContext(buildSnapshot(areas, topics, tasks), questionContext(tasks, topics, messages.slice(-4).map(m => m.content).join(' '), selectedId), guide ? JSON.stringify({ ...guide, tests: undefined }) : undefined);
      }
    } catch (e) { if (e instanceof CloudError) throw e; console.error('[miso] tracker read failed for user', user.id); }
    const query = publicSearchQuery(messages.at(-1)!.content);
    let sources: Awaited<ReturnType<typeof searchReferences>> = { references: [], warning: null };
    if (query) {
      const cached = referenceCache.get(query);
      sources = cached && cached.until > Date.now() ? cached.value : await searchReferences(query, AbortSignal.any([req.signal, AbortSignal.timeout(5000)]));
      if (!cached || cached.until <= Date.now()) {
        if (referenceCache.size >= 100) referenceCache.delete(referenceCache.keys().next().value!);
        referenceCache.set(query, { until: Date.now() + (sources.references.length ? 300000 : 60000), value: sources });
      }
    }
    const providerMessages = messages.map((message, i) => query && i === messages.length - 1 ? { ...message, content: withPublicLookup(message.content, sources.references) } : message);
    const response = await cloudRequest('/api/miso/chat', { messages: providerMessages, context }, AbortSignal.any([req.signal, AbortSignal.timeout(50000)]));
    const stream = response.body!.pipeThrough(new TransformStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'sources', ...sources }) + '\n')); },
      transform(chunk, controller) { controller.enqueue(chunk); },
    }));
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  } catch (e) { return cloudFailure(e); }
}
