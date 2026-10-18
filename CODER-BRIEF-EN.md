# Task for a coding agent — finish VOXBRIDGE MVP deployment

You have a full-stack Cloudflare Worker + D1 voice translation prototype in this directory. Do not rebuild a landing page; the backend and frontend already exist.

## Objective
Publish a real working English-first mobile web app allowing two strangers to communicate with audio messages across language barriers, through a private invitation link, without accounts or installing an app.

## Already implemented
- Cloudflare Worker endpoints `/api/rooms`, `/api/session/:token`, `/api/session/:token/messages`, `DELETE /api/session/:token`
- Two role-specific high-entropy tokens; guest token is AES-GCM encrypted at rest and returned only to room owner
- D1 persistence and daily expired-record deletion
- Browser MediaRecorder captures up to 25s audio; Worker sends to OpenAI transcription and translation APIs
- Text fallback, translated speech via Web Speech API, chat UI, limits on rooms/messages/daily AI requests
- Automated mocked Worker tests; see README-UK.md and run `npm run check`

## Do next, in this order
1. Install Wrangler and verify local D1 binding/migrations. Set local secrets as documented; do not commit any keys.
2. Test real `gpt-4o-mini-transcribe` with WebM (Chrome) and MP4 (iOS Safari). Verify supported MIME types with OpenAI; fix format issues if needed.
3. Run browser E2E tests for owner/guest share flows, refresh, voice recording and error states. Test on actual iPhone Safari and Android Chrome.
4. Review and finalize the included privacy page and consent wording explaining audio is sent to an external provider, is not stored by the app, and text is stored at most seven days. Set access-control, no-index and referrer-policy headers for private pages.
5. Add CAPTCHA or equivalent abuse control before broad public rollout, configure a strict AI usage budget and abuse alerts, and add durable audit/error instrumentation without logging tokens or voice contents.
6. Evaluate whether 25 seconds is adequate; add audio duration verification server-side if costs require it. Add backend-side request body protections.
7. Do not claim end-to-end encryption; these are shared secret links, not identity verified accounts. Add privacy-safe consent before recording.
8. Deploy on a test `workers.dev` domain, run a real bidirectional voice conversation and document the exact results.

## Release criteria
No hardcoded provider secrets. No invented results or fake translations. Accurate supported language playback or text fallback. Separate owner/guest links. Expiration works. No uncontrolled billable AI traffic. Five external testers complete the two-way path. Collect conversion data only with consent and without storing identifiable contents unnecessarily.
