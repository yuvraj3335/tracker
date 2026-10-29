# Free cloud Miso

The signed-in `/api/companion/live` route reads only that user’s tracker and mints
a 60-second, origin-bound WebSocket connection ticket. The browser never receives
the shared API key or signing credential. HTTP chat/voice/transcribe routes remain
available for typed replies and older clients.

- Live replies: `@cf/meta/llama-3.1-8b-instruct-fp8`.
- HTTP conversation compatibility: `@cf/zai-org/glm-4.7-flash`.
- Live transcription and turn detection: `@cf/deepgram/nova-3`.
- Uncertain final words and recorded audio: `@cf/openai/whisper-large-v3-turbo`.
- Natural speech: `@cf/deepgram/aura-2-en`, Luna.
- Optional longer-session speech: `@cf/myshell-ai/melotts`.

Keep the account on **Workers Free**. Its shared 10,000 neurons/day reset at
00:00 UTC (05:30 India time). Exhaustion fails requests rather than billing.
Aura-2 consumes 2,727.27 neurons per 1,000 characters: at most about 3,666
characters of speech if no other model uses the allowance. This is a short
natural-voice session, not unlimited free voice. There is no paid fallback.

1. Keep a 32-byte base64url key in a private file outside Git.
2. Run `node cloudflare/build.mjs /absolute/path/to/private-key-file`.
3. Deploy `build/tutor-worker.mjs` with a Workers AI binding named `AI`.
   Historical filenames are retained. The private bundle includes a key verifier
   and a separate derived session-signing credential. Never publish or print it.
4. Keep Vercel secret variables `TUTOR_API_KEY` and `TUTOR_API_URL` configured.
   The URL must use HTTPS on this Worker; the app chooses each operation path.
5. Test Talk while signed in. Unauthenticated Worker calls return 401 and
   browser-origin HTTP calls return 403. The WebSocket also requires its
   short-lived ticket and the exact issuing Origin. Never publish credentials.

The existing `cloud-dictation` Worker is reused. Its root now redirects to the
DSA sheet. Prior versions are retained by Cloudflare for rollback. Logs remain
disabled. Audio and chat are processed by Cloudflare; the app does not persist
audio recordings. User question content is read server-side from their own
Notion workspace. It is never placed in the public repository.

`npm run test:miso` checks access control, tickets, fixed providers, streaming,
barge-in races, capture resampling, late microphone permissions, tab visibility,
question retrieval, and wake parsing. Hardware permissions and echo cancellation
also need a browser/device check.

The first visible visit requests microphone permission. A browser may additionally
require an initial gesture for audio playback. Thereafter the mic stays active in
the selected tab, including while Miso speaks. Speaking interrupts playback and
pending inference; echo cancellation and sustained audio-level detection reduce
false interruptions. Hiding the tab stops its tracks and closes its connection;
returning resumes automatically. Stop persists an explicit Off choice.

Only the browser socket stays open during quiet periods. Nova-3 is opened lazily
with a 240ms pre-roll and closed at a finalized speech endpoint, or after noise without speech.
This avoids a continuously billed transcription stream while idle. Ten-minute
browser sessions renew automatically. Audio and chat are not stored. Public
lookup is still an explicit command, handled by the authenticated lookup route.
The session retains the catalog; each LLM request contains selected/relevant
questions rather than every title. Context refreshes each minute and on navigation.

[Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
· [Aura-2](https://developers.cloudflare.com/workers-ai/models/aura-2-en/)
· [Nova-3](https://developers.cloudflare.com/workers-ai/models/flux/)
· [Whisper](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)
