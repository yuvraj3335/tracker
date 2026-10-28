# Free study tutor deployment

The tracker calls this Worker from its authenticated `/api/tutor` route. The
browser receives neither the shared access key nor any Cloudflare credentials.
The only inference provider is Workers AI, model `@cf/zai-org/glm-4.7-flash`.
Keep the account on **Workers Free**, with no paid fallback. Its 10,000 neurons
per day reset at 00:00 UTC; exhausting them returns an error instead of a bill.
Model availability, capacity and free allowances can change.

1. Use a 32-byte base64url key kept in a private file, outside the repository.
2. Run `node cloudflare/build.mjs /absolute/path/to/private-key-file`.
3. Deploy `build/tutor-worker.mjs` to a Cloudflare Worker with a Workers AI
   binding named `AI`. The generated bundle contains only the SHA-256 key hash.
4. Set Vercel **secret** environment variables `TUTOR_API_KEY` to that key and
   `TUTOR_API_URL` to `https://<worker-host>/api/tutor`. Redeploy the tracker.
5. Open `/tutor` while signed in. Test a question and a follow-up. Requests to
   the Worker without the key must return 401; browser-origin requests return 403.

The current deployment reuses the `cloud-dictation` Worker created earlier for
this account. Its root redirects to the tracker's tutor. Its former speech UI
and transcription endpoint are replaced by this tutor service. Existing
Cloudflare versions retain the prior implementation for rollback.

`npm run test:tutor` tests access control, bounded requests, stream parsing,
quota failure, study prompts and reference search. The tracker also has its
normal `test`, `typecheck`, `lint` and `build` commands.

Chat lives in the current tab's memory, and a reload/new chat clears it. The
client shows a Stop control and preserves partial responses after failure.
Conversations are bounded to 24 messages and 36,000 characters. User messages
are limited to 8,000 characters. The model cannot run code, change tracker
progress, or read external accounts. The study page does not mount the voice
companion and starts no local speech/model inference.

Reference search uses Wikipedia and Stack Overflow's public APIs without a key.
Only the separate, explicit search phrase is sent to those sites. Retrieved
titles, URLs and short excerpts are shared with Cloudflare alongside the chat.
Repeated phrases reuse results for five minutes per server instance, and Stack
Overflow backoff instructions are respected for that instance.
The interface identifies sources and reports failures. This is limited reference
search, not a Google results API or unrestricted browsing. A separate Google
link opens the query in the user's browser. Code and queries are not logged by
the tutor code. Leave Cloudflare request logging disabled on this personal app.

Sources checked October 28, 2026:

- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [GLM-4.7-Flash model and schema](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [Google Custom Search availability](https://developers.google.com/custom-search/v1/overview)
- [MediaWiki search API](https://www.mediawiki.org/wiki/API:Search)
- [Stack Exchange advanced search](https://api.stackexchange.com/docs/advanced-search)
