import { currentUser } from '@/lib/tenant';
import { boundedJSON, cloudRequest, cloudFailure, CloudError, sameOrigin } from '@/lib/cloud-ai';
import { createRateLimiter } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const maxDuration = 30;
const take = createRateLimiter(120, 5 * 60000);
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new CloudError('Sign in to speak with Miso.', 401);
    if (!sameOrigin(req)) throw new CloudError('Open Miso inside your tracker.', 403);
    if (!take(user.id).allowed) throw new CloudError('Please pause before using the microphone again.', 429);
    const input = await boundedJSON(req, 4000000) as Record<string, unknown> | null;
    if (!input || Object.keys(input).some(k => k !== 'audio') || typeof input.audio !== 'string' || input.audio.length > 3900000) throw new CloudError('Invalid audio recording.', 400);
    const response = await cloudRequest('/api/miso/transcribe', input, AbortSignal.any([req.signal, AbortSignal.timeout(25000)]));
    return new Response(response.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (e) { return cloudFailure(e); }
}
