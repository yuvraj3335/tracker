import { currentUser } from '@/lib/tenant';
import { boundedJSON, cloudRequest, cloudFailure, cloudConfigured, CloudError, sameOrigin } from '@/lib/cloud-ai';
import { createRateLimiter } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const maxDuration = 30;
const take = createRateLimiter(120, 5 * 60000);
export async function GET() {
  if (!await currentUser()) return Response.json({ configured: false }, { status: 401 });
  return Response.json({ configured: cloudConfigured(), cloudOnly: true }, { headers: { 'cache-control': 'no-store' } });
}
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new CloudError('Sign in to hear Miso.', 401);
    if (!sameOrigin(req)) throw new CloudError('Open Miso inside your tracker.', 403);
    if (!take(user.id).allowed) throw new CloudError('Please pause before requesting more speech.', 429);
    const input = await boundedJSON(req, 8000) as Record<string, unknown> | null;
    if (!input || Object.keys(input).some(k => !['text', 'voice', 'format'].includes(k)) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1200 || !['natural', 'longer'].includes(String(input.voice)) || (input.format !== undefined && (input.format !== 'pcm' || input.voice !== 'natural'))) throw new CloudError('Invalid speech request.', 400);
    const response = await cloudRequest('/api/miso/voice', input, AbortSignal.any([req.signal, AbortSignal.timeout(25000)]));
    return new Response(response.body, { headers: { 'content-type': response.headers.get('content-type') ?? 'audio/mpeg', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  } catch (e) { return cloudFailure(e); }
}
