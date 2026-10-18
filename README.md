# VOXBRIDGE — voice translation through a private link

**Zero-payment pilot:** Cloudflare Workers, D1 and Workers AI on the **Free** plan. No paid OpenAI API key, OpenAI API billing, subscription or card is needed for the AI models used here. The free Workers AI allowance is **10,000 neurons per day**; beyond it requests fail on the Free plan rather than incur a charge. Workers and D1 have separate Free limits.

**Status:** Code compiled and mocked tests passed in GitHub Actions, including Wrangler dry-run and local D1 migrations. Real Cloudflare production deployment and actual audio translation on iPhone/Android **are not yet confirmed**. No guarantee of uptime, every language pair or translation quality.

## What it does

- Two people speaking different languages can exchange translated voice or typed messages via separate secret links, with no accounts.
- Server-side audio transcription: Cloudflare-hosted `@cf/openai/whisper-large-v3-turbo` (not the billable OpenAI API).
- Server-side multilingual text translation: Cloudflare-hosted `@cf/meta/m2m100-1.2b`.
- Spoken playback via the recipient's device Speech Synthesis API, subject to language voices installed.
- Cloudflare D1 retains text/translations for up to seven days; audio is processed but not stored by this application.
- Up to 25-second clips; conservative daily request limits and consent before sending.
- First version supports 13 selectable languages; actual recognition/translation support must be tested per browser and pair.

## Launch

**For the owner:** [Zero-payment setup in Ukrainian](DEPLOY-UK.md).

For local development:

```sh
npm install
cp .dev.vars.example .dev.vars
# Fill RATE_LIMIT_SALT and LINK_SECRET with two independent long random values.
npm run db:local
npm run check
npm run dev
```

The D1 database is configured in `wrangler.jsonc`; Wrangler local AI binding may connect to Cloudflare-hosted inference and requires correct development authentication. Never commit `.dev.vars`.

[GitHub CI](../../actions/workflows/ci.yml) runs syntax checks, mocked AI tests, local D1 migrations and a Wrangler deployment dry-run. [Cloudflare deployment](../../actions/workflows/deploy.yml) runs for `main` updates and can also be started manually after the single required repository secret, `CLOUDFLARE_API_TOKEN`, is configured.

## Key limits and privacy

- **No end-to-end encryption** and no identity verification: anyone with a private link can read the respective room.
- AI processes text/voice through Cloudflare Workers AI; it does not guarantee correct translations or availability.
- Code tests mock the models; real speech recordings in WebM/MP4 require live verification. If speech processing fails, typed text remains an alternative.
- No payments, user accounts, CAPTCHA, external pentest or legally finalized privacy notice yet. Do not announce a commercial release.

For full details see [README-UK.md](README-UK.md).
