# VOXBRIDGE — Voice translation through a private link

VOXBRIDGE is a mobile-first web app for two people who speak different languages. Each person records or types in their own language; the other sees an AI translation and can listen using the device's speech synthesis. No accounts or app installation required.

**Status:** working MVP source code. Seven mocked server tests plus static policy checks are verified in GitHub Actions. Real OpenAI voice translation and Cloudflare deployment have **not** yet been verified. This repository is currently **public**; never commit real secrets.

## Features
- 13 supported languages; English-first interface with Ukrainian toggle
- Up to 25-second voice messages, plus text fallback
- Separate private invitation links for creator and guest
- OpenAI speech transcription and translation on the server
- Cloudflare Workers + D1 for conversations and rate limits
- Consent required before sending voice/text to AI
- Conversation deletion by creator and automatic expiry after seven days

## Developer quick start
Requires Node.js 20+, a Cloudflare account and a separate funded OpenAI API key for real translations. ChatGPT subscription does not include OpenAI API usage.

```sh
npm install
npx wrangler login
npx wrangler d1 create voxbridge-db
```

Copy the returned D1 database ID into `wrangler.jsonc`, then copy `.dev.vars.example` to `.dev.vars` and fill in `OPENAI_API_KEY`, `RATE_LIMIT_SALT`, and `LINK_SECRET`. **Never push `.dev.vars`.**

```sh
npm run db:local
npm run check
npm run dev
```

For remote deployment, set the three secrets with `npx wrangler secret put <SECRET_NAME>`, then run `npm run db:remote` and `npm run deploy`. Review the privacy policy, testing and abuse limits first.

**For an owner who does not want to use the terminal:** follow the [Ukrainian one-time Cloudflare setup](DEPLOY-UK.md), then run [Deploy VOXBRIDGE (manual)](../../actions/workflows/deploy.yml). Deployment never runs automatically on a push.

See [Ukrainian developer setup and limitations](README-UK.md) and [coding/deployment checklist](CODER-BRIEF-EN.md).

## Important
Private links are **not** end-to-end encryption. Text messages remain in D1 until deletion/expiry (up to seven days); audio is processed by OpenAI, not stored by this app. Do not use it for emergencies or highly sensitive information.
