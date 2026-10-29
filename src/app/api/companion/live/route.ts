import { currentUser, tenantStatus } from '@/lib/tenant';
import { getEverything } from '@/lib/notion';
import { liveStudy } from '@/lib/miso-live-study';
import { boundedJSON, cloudRequest, cloudFailure, CloudError, sameOrigin } from '@/lib/cloud-ai';
import { createRateLimiter } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const maxDuration = 30;
const take = createRateLimiter(45, 5 * 60000);

export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new CloudError('Sign in to talk with Miso.', 401);
    if (!sameOrigin(req)) throw new CloudError('Open Miso inside your tracker.', 403);
    if (!take(user.id).allowed) throw new CloudError('Please pause before reconnecting Miso.', 429);
    const input = await boundedJSON(req, 2000) as Record<string, unknown> | null;
    if (!input || Object.keys(input).some(key => !['questionId', 'connect'].includes(key)) || typeof input.connect !== 'boolean' || (input.questionId !== undefined && (typeof input.questionId !== 'string' || input.questionId.length > 80))) throw new CloudError('Invalid voice session.', 400);
    // Start the short-lived connection ticket while tracker data is being read.
    const ticket = input.connect ? cloudRequest('/api/miso/session', { origin: new URL(req.url).origin }, req.signal).then(response => response.json()).then(value => ({ value }), error => ({ error })) : null;
    let study = { snapshot: 'Tracker unavailable. Do not guess progress or claim to see their questions.', totalQuestions: 0, truncated: false, questions: [], selectedId: null, guide: '' } as ReturnType<typeof liveStudy>;
    try {
      const status = await tenantStatus();
      if (status.kind === 'ready') {
        const { areas, topics, tasks } = await getEverything(status.tenant);
        const selectedId = typeof input.questionId === 'string' ? input.questionId : undefined;
        if (selectedId && !tasks.some(task => task.id === selectedId)) throw new CloudError('That question is not in your tracker.', 404);
        study = liveStudy(areas, topics, tasks, selectedId);
      }
    } catch (error) { if (error instanceof CloudError) throw error; console.error('[miso-live] tracker read failed for user', user.id); }
    const result = await ticket;
    if (result && 'error' in result) throw result.error;
    return Response.json({ study, ...(result && 'value' in result ? result.value : {}) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return cloudFailure(error); }
}
