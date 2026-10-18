# Coding brief — finish VOXBRIDGE with $0 hosting and AI spend

## Current architecture
- Cloudflare Worker + Static Assets + D1. Worker, D1 and Workers AI must stay on the **Cloudflare Free** plan for now.
- Server-side speech model: `@cf/openai/whisper-large-v3-turbo` through `env.AI.run`. Cloudflare-hosted — **not paid OpenAI API**.
- Server-side text translation: `@cf/meta/m2m100-1.2b` through `env.AI.run`.
- Browser speech synthesis for audio playback; two separate 64-character secret room links, AES-GCM encryption of guest link at rest.
- Message text in D1, delete rooms after 7 days, input validation and conservative daily AI usage limits.
- 13 selectable languages, English/Ukraine UI toggle.
- D1 database ID already set in `wrangler.jsonc`. Never replace this with dummy production IDs.

## Verification already performed
GitHub Actions: mocked unit tests, local D1 migration, Wrangler dry-run build. They are NOT live speech or real inference tests.

## Next steps
1. User authorizes Cloudflare access via two GitHub Actions secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Do not ask user to paste token into chat or commit it.
2. Deploy via explicit manual GitHub Action only. Do not subscribe to paid Cloudflare or other hosting or activate billing.
3. Add runtime secrets `RATE_LIMIT_SALT` and `LINK_SECRET` in Cloudflare Worker settings. Do not rotate LINK_SECRET for live rooms without migration.
4. Verify real M2M100 language pairs and Whisper WebM/MP4 browser recordings on iOS Safari and Android Chrome; handle unsupported formats without fake transcript.
5. Check that Workers AI free 10,000 neuron daily allowance handles test workload. Beyond limits calls should fail without charges.
6. Review user-facing privacy wording, add CAPTCHA/abuse protection before public invitation.
7. Ensure legitimate consent before processing audio/text; do not promise E2EE.

## Release criteria
No credit card or OpenAI API keys required for the free pilot. No fake translations. Working two-way session on two real devices and manual test of deletion/expiry. If real audio/translations fail, report exact limitation and do not claim a working product.

See `DEPLOY-UK.md` and `README-UK.md`.
