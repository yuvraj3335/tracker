# Free cloud Miso

The signed-in tracker routes `/api/companion/chat`, `/voice`, and `/transcribe`
proxy to this private Worker. The browser never receives its shared key.

- Conversation: `@cf/zai-org/glm-4.7-flash`.
- Transcription: `@cf/openai/whisper-large-v3-turbo`.
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
   Historical filenames are retained; the bundle contains only a SHA-256 hash.
4. Keep Vercel secret variables `TUTOR_API_KEY` and `TUTOR_API_URL` configured.
   The URL must use HTTPS on this Worker; the app chooses each operation path.
5. Test Talk while signed in. Unauthenticated Worker calls return 401 and
   browser-origin calls return 403. Never publish the raw shared key.

The existing `cloud-dictation` Worker is reused. Its root now redirects to the
DSA sheet. Prior versions are retained by Cloudflare for rollback. Logs remain
disabled. Audio and chat are processed by Cloudflare; the app does not persist
audio recordings. User question content is read server-side from their own
Notion workspace. It is never placed in the public repository.

`npm run test:miso` checks access control, limits, fixed providers, streams,
question selection, and wake-phrase parsing. Actual microphone permission,
recording and playback also need a browser check. Wake mode requires a visible
page and a per-session user gesture. It sends spoken segments to cloud Whisper;
there is no local wake-word model. Closing/locking/hiding cannot keep it active.

[Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
· [Aura-2](https://developers.cloudflare.com/workers-ai/models/aura-2-en/)
· [Whisper](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)
