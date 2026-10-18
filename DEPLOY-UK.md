# VOXBRIDGE — публікація з Cloudflare без оплати й без API-токенів

**Стан:** код на GitHub і перевірений автоматичними тестами. Cloudflare D1 `voxbridge-db` уже створена, її ID вказано в `wrangler.jsonc`. Публічний сайт ще не підтверджено.

## Найпростіший спосіб: вбудоване підключення GitHub у Cloudflare

Цей спосіб **не вимагає шукати Account ID**, створювати API-токени вручну чи вставляти SQL у базу. Cloudflare Workers Builds сам створює службовий токен під час підключення GitHub; у Cloudflare Free це можливо без платної підписки.

1. Відкрийте https://dash.cloudflare.com/ і зайдіть у **Workers & Pages**.
2. Натисніть **Create application**.
3. Виберіть **GitHub** / **Import a repository** (залежно від вигляду кабінету).
4. Якщо з'явиться запит, дозвольте Cloudflare доступ **лише до репозиторію `my-first-app`** свого GitHub-акаунта.
5. Виберіть **`sirookorovi-creator/my-first-app`**, гілку **`main`**. Назва Worker має відповідати `voxbridge-mvp` із `wrangler.jsonc`.
6. У налаштуваннях збірки: **Build command** = `npm run build` (або залиште автоматично визначений), **Deploy command** = `npx wrangler deploy`, **Root directory** = корінь репозиторію.
7. Оберіть безкоштовний Workers Free і **Save and Deploy**. Якщо сервіс просить оплату або перехід на Paid — зупиніться і надішліть скриншот; платний план не потрібний для тесту.

Після цього Cloudflare опублікує сайт на адресі `*.workers.dev` і налаштує дві прив'язки з конфігурації: **D1 DB** та **Workers AI**.

**База даних:** Worker автоматично створить відсутні таблиці за першого API-запиту (використовує `CREATE TABLE IF NOT EXISTS`, без видалення даних). Окремі міграції вручну для початкового запуску більше не потрібні. Папка `migrations/` зберігається для майбутніх версій.

## Після першого розгортання: два секрети Cloudflare

Перейдіть у **Workers & Pages → voxbridge-mvp → Settings → Variables and Secrets**. Додайте як **Secrets**:
- `RATE_LIMIT_SALT` — випадковий рядок щонайменше 20 символів.
- `LINK_SECRET` — інший випадковий рядок щонайменше 24 символи.

На Mac можна двічі виконати `openssl rand -hex 32`; значення мають бути **різними**. Нікому їх не показуйте й не вставляйте у публічний GitHub. **Не змінюйте LINK_SECRET** для чинної бази без плану міграції: власники вже створених розмов можуть утратити доступ до відновлення запрошень.

**OpenAI API-ключ не потрібний і не використовується.**

## Перевірка після запуску

1. Відкрийте `https://voxbridge-mvp.<ваш-піддомен>.workers.dev/api/health`. Очікується `{"ok":true,"aiConfigured":true,"aiProvider":"cloudflare-workers-ai"}`.
2. Створіть розмову (українська ⇄ англійська), перевірте текстовий переклад.
3. Відкрийте гостьове посилання на другому пристрої, надішліть відповідь.
4. Перевірте голос із реального iPhone/Android. Моделі та формат аудіо треба перевірити вживу; автоматичні тести використовують імітацію AI.
5. У Cloudflare Workers AI Dashboard перевірте витрачання безкоштовних Neurons.

Cloudflare Workers AI на **Free** дає 10 000 Neurons на добу. Після вичерпання звернення до AI повертають помилку, без автоматичного переходу на платний тариф. У Workers, D1 і Cloudflare Builds є окремі безкоштовні ліміти.

## Альтернатива для розробника

У репозиторії залишено ручну GitHub Action `Deploy VOXBRIDGE (manual)`. Вона потребує двох GitHub Secrets: `CLOUDFLARE_ACCOUNT_ID` та `CLOUDFLARE_API_TOKEN`. **Для нового користувача рекомендуємо спосіб вище**, де Cloudflare сам підключає GitHub.

## Перед публічним поширенням
- Справжні голосові переклади на різних телефонах **ще не перевірені**.
- Потрібні контроль зловживань, юридична перевірка повідомлення про приватність і реальне тестування якості перекладів.
- Посилання — секретні, але це не E2EE і не підтвердження особи.
- Репозиторій зараз публічний. Ніколи не додавати в код паролі, токени чи секрети.

Документація:
- https://developers.cloudflare.com/workers/get-started/dashboard/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
