import { currentUser } from '@/lib/tenant';
import { searchReferences } from '@/lib/tutor-search';
import { boundedJSON, cloudFailure, CloudError, sameOrigin } from '@/lib/cloud-ai';
import { createRateLimiter } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const maxDuration = 10;
const take = createRateLimiter(20, 5 * 60000);
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new CloudError('Sign in to search with Miso.', 401);
    if (!sameOrigin(req)) throw new CloudError('Open Miso inside your tracker.', 403);
    if (!take(user.id).allowed) throw new CloudError('Please pause before searching again.', 429);
    const input = await boundedJSON(req, 2000) as Record<string, unknown> | null;
    if (!input || Object.keys(input).some(key => key !== 'query') || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 180 || /[\n{}]|```/.test(input.query)) throw new CloudError('Invalid search.', 400);
    return Response.json(await searchReferences(input.query, AbortSignal.any([req.signal, AbortSignal.timeout(5000)])), { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return cloudFailure(error); }
}
